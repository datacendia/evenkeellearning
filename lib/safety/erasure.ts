// ─────────────────────────────────────────────────────────────────────────────
// lib/safety/erasure.ts
//
// GDPR Article 17 — Right to Erasure.
//
// What this module does
// ─────────────────────
// Removes every storage entry that contains learner-generated or
// learner-traceable data. It is callable from the Parent Safety Centre
// button.
//
// Design decisions
// ────────────────
// 1. Allowlist-of-namespaces, denylist-of-policy-keys, not a hardcoded list.
//    The codebase has dozens of `evenkeel.*` / `keellearn.*` localStorage
//    keys today and gains more every release. A hardcoded list would silently
//    fall behind the next time someone adds a new key. So `eraseLearnerData`
//    walks every `localStorage` key, takes anything in the project namespace,
//    and *excludes* a small allowlist of parent-set policy keys (which are
//    parent's data, not child's). New learner keys are erased by default.
//
// 2. The parent's *policy* settings are intentionally NOT erased. Erasing
//    Art. 17 data does not mean tearing down the bedtime window the parent
//    configured. Those keys are listed in `PARENT_POLICY_KEYS_KEEP`.
//
// 3. Returns a structured report (`ErasureReport`). Useful for the UI
//    confirmation toast, useful for the bus event, and trivially testable.
//
// 4. Emits a `parent.erasure.completed` bus event so other open tabs can
//    react (e.g. close the student session if it's still open).
//
// 5. SSR-safe: returns an empty report on the server.
//
// What this is NOT
// ────────────────
// • Not a server-side erasure path. Even Keel does not store learner data on
//   any server, so there is nothing to delete remotely. If a future release
//   adds a server (e.g. shared classroom mode), Art. 17 will need a network
//   call here too.
// • Not a confirmation dialog. The UI must double-confirm before calling
//   `eraseLearnerData()`. This module deliberately has no `confirm()` of its
//   own so it is safe to unit-test without a window prompt.
// ─────────────────────────────────────────────────────────────────────────────

import { publish } from "@/lib/data-bus";

/**
 * Storage prefixes the app uses. Anything in these namespaces is in scope for
 * erasure unless it is on the keep-list.
 */
export const PROJECT_KEY_PREFIXES = ["evenkeel", "keellearn"] as const;

/**
 * Parent-set policy keys that are *not* erased by Art. 17.
 *
 * Rationale: Article 17 covers the data subject's data. Parent-configured
 * safety policy is the parent's data, configured with the parent's intent.
 * Erasing it would be a side-effect, not the intended outcome of "erase my
 * child's record". A parent who wants to also wipe their own settings can
 * use the device-level "clear site data" button.
 */
export const PARENT_POLICY_KEYS_KEEP: readonly string[] = [
  // Parent Safety Centre settings (cap, bedtime window, tone, crisis on/off).
  "evenkeel/safety/v1",
  // Parent-configured safeguarding webhook URL/secret.
  "evenkeel.safeguarding.webhook.v1",
  // Per-role demo passphrase hashes — not learner data.
  // Match by prefix below; this entry is illustrative.
  // (`evenkeel/role-guard/*` is handled by the prefix branch.)
];

/** Prefixes whose contents are kept (parent-set, not learner-data). */
export const PARENT_POLICY_PREFIXES_KEEP: readonly string[] = [
  "evenkeel/role-guard/",
];

export interface ErasureReport {
  /** ISO 8601 timestamp of when erasure ran. */
  at: string;
  /** Storage keys that were removed. */
  removed: string[];
  /** Storage keys that matched a project prefix but were intentionally kept. */
  kept: string[];
}

/**
 * True iff `key` belongs to one of this project's storage namespaces.
 * Exported for tests.
 */
export function isProjectKey(key: string): boolean {
  for (const p of PROJECT_KEY_PREFIXES) {
    if (key === p) return true;
    if (key.startsWith(p + ".") || key.startsWith(p + "/")) return true;
  }
  return false;
}

/**
 * True iff `key` is on the parent-policy keep-list and must NOT be erased.
 * Exported for tests.
 */
export function isParentPolicyKey(key: string): boolean {
  if (PARENT_POLICY_KEYS_KEEP.includes(key)) return true;
  for (const p of PARENT_POLICY_PREFIXES_KEEP) {
    if (key.startsWith(p)) return true;
  }
  return false;
}

/**
 * Erase every learner-data localStorage key in the project namespace.
 * Returns a report of what was removed and what was kept.
 *
 * Caller is responsible for getting an explicit user confirmation. This
 * function does NOT prompt.
 *
 * @param now Optional clock injection for tests.
 */
export function eraseLearnerData(now: Date = new Date()): ErasureReport {
  const report: ErasureReport = { at: now.toISOString(), removed: [], kept: [] };
  if (typeof window === "undefined") return report;

  // Collect first, then delete — never iterate-and-delete the live store, as
  // localStorage indices shift on every removal in some implementations.
  const allKeys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k != null) allKeys.push(k);
  }

  // Pre-classify so the bus event we publish below carries accurate counts
  // *before* the erase loop runs. This matters because `publish()` writes
  // to `evenkeel.bus.log` in localStorage, which is itself a learner-data
  // key. We want post-erasure storage state to be genuinely clean — so the
  // ordering is: classify → publish (records the action in the ring buffer
  // and via BroadcastChannel) → erase (which wipes bus.log along with
  // everything else, but other tabs already received the message in real
  // time via BroadcastChannel). Idempotent: a second call after this one
  // finds nothing to remove.
  const toRemove: string[] = [];
  const toKeep: string[] = [];
  for (const k of allKeys) {
    if (!isProjectKey(k)) continue;
    if (isParentPolicyKey(k)) toKeep.push(k);
    else toRemove.push(k);
  }
  report.kept = toKeep;

  // Notify the rest of the app first; a SafetyGate in another tab can react.
  try {
    publish(
      "parent.erasure.completed",
      { removedCount: toRemove.length, keptCount: toKeep.length },
      "parent",
    );
  } catch {
    // Bus may be unavailable in tests; the erasure itself proceeds.
  }

  // Now do the actual removals.
  for (const k of toRemove) {
    try {
      window.localStorage.removeItem(k);
      report.removed.push(k);
    } catch {
      // Quota / privacy mode — best-effort; don't throw mid-erasure.
    }
  }

  return report;
}
