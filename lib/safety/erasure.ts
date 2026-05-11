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
import { tombstoneEscalations } from "@/lib/safeguarding/escalation-queue";

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

/**
 * v1.5.5 — keys that need *structured* erasure rather than a raw
 * `removeItem`. The signed escalation queue is the canonical example:
 * the queue contract pins a 90-day WORM retention on signed payloads,
 * so Art. 17 erasure replaces every live entry with a hash-only
 * tombstone instead of silently wiping the localStorage key.
 *
 * The handler MUST leave behind no signed payload, no learner-data
 * field, and only persist what an external auditor needs to verify
 * "an erasure happened at time T over an envelope with digest D".
 */
const STRUCTURED_ERASURE_HANDLERS: ReadonlyArray<{
  /** Storage key the handler owns. Skipped by the generic remove loop. */
  readonly key: string;
  /** Returns the number of records that were tombstoned (>=0). */
  readonly run: (now: Date) => number;
}> = [
  {
    key: "evenkeel.safeguarding.queue.v1",
    run: (now) => tombstoneEscalations("art17_erasure", now.getTime()),
  },
];

export interface ErasureReport {
  /** ISO 8601 timestamp of when erasure ran. */
  at: string;
  /** Storage keys that were removed. */
  removed: string[];
  /** Storage keys that matched a project prefix but were intentionally kept. */
  kept: string[];
  /**
   * Storage keys handled by a structured erasure handler (e.g. the
   * signed escalation queue, which is converted to hash-only tombstones
   * rather than a raw removeItem). Empty when no such handlers fired.
   */
  tombstoned: string[];
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
  const report: ErasureReport = {
    at: now.toISOString(),
    removed: [],
    kept: [],
    tombstoned: [],
  };
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
  // v1.5.5 — keys with a structured erasure handler are diverted from
  // the generic remove loop. They are still "in scope for Art. 17" but
  // the handler decides how (e.g. signed escalation queue → hash-only
  // tombstones). Skipping them here ensures the generic removeItem
  // can't silently violate a domain contract (WORM, immutable receipts).
  const structuredKeys = new Set(STRUCTURED_ERASURE_HANDLERS.map((h) => h.key));

  const toRemove: string[] = [];
  const toKeep: string[] = [];
  for (const k of allKeys) {
    if (!isProjectKey(k)) continue;
    if (structuredKeys.has(k)) continue; // handled below
    if (isParentPolicyKey(k)) toKeep.push(k);
    else toRemove.push(k);
  }
  report.kept = toKeep;

  // v1.5.5 — only publish + sweep bus.log when there's actually
  // learner data to remove. Two reasons:
  //   (a) preserves idempotency — a second erasure on an already-clean
  //       store does nothing observable;
  //   (b) preserves the "empty report when no project keys exist"
  //       contract — `publish()` writes to localStorage as a side-
  //       effect, which would otherwise surface as a phantom removal.
  if (toRemove.length > 0) {
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

  // v1.5.5 — run structured erasure handlers. Each handler is responsible
  // for replacing its key's contents with audit-only tombstones rather
  // than a raw removeItem. Reports the handled key under `tombstoned`
  // when at least one record was converted; otherwise (empty queue, no
  // live entries) cleans up the key under `removed` so the report still
  // reflects what the audit surface sees in localStorage.
  for (const handler of STRUCTURED_ERASURE_HANDLERS) {
    // Was the key present before the handler ran? Influences which
    // bucket of the report we end up reporting it under.
    const wasPresent = window.localStorage.getItem(handler.key) !== null;
    try {
      const n = handler.run(now);
      if (n > 0) {
        report.tombstoned.push(handler.key);
      } else if (wasPresent) {
        // No live entries to tombstone, but the key existed (e.g. `[]`).
        // Treat it as a normal removal so it shows up in the report.
        try {
          window.localStorage.removeItem(handler.key);
          report.removed.push(handler.key);
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* never let a handler fault stop the rest of the erase */
    }
  }

  // v1.5.5 — silent sweep of `evenkeel.bus.log` as the last step, in
  // case `publish()` above created the key after our snapshot.
  // Performed AFTER the main loop so it can't interleave with the
  // documented `report.removed` list. Not added to the report — it is
  // an implementation artefact, not a user-visible piece of learner data.
  //
  // This closes the audit C-3 defect: previously, immediately after a
  // "wipe my child's data" action, localStorage still contained one
  // bus.log entry saying that erasure happened.
  if (toRemove.length > 0) {
    try {
      window.localStorage.removeItem("evenkeel.bus.log");
    } catch {
      /* best-effort */
    }
  }

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.5.5 — audit M-9: learner-id rotation.
//
// The EkeChat component generates a stable per-device `evenkeel.student.id`
// in localStorage on first visit and reuses it across all subsequent
// session traces, CRT bank entries, and signed receipts. That's a feature
// (intra-device continuity is what makes the spacing scheduler and the
// "coming back today" card work) but it's also a stable identifier the
// learner can never see or rotate without nuking everything.
//
// This helper lets a parent / learner mint a fresh id without touching
// safety policy. After rotation:
//   • Any CRT logger / IPA analyser instance still running with the old
//     id will keep using it for the lifetime of the current mount —
//     React state is not in our control here.
//   • Future mounts pick up the new id (EkeChat reads localStorage at
//     mount time).
//   • Existing signed envelopes in the CRT bank are NOT rewritten. They
//     remain valid evidence of past sessions under the old id; the new
//     id only affects events from this point forward.
// ─────────────────────────────────────────────────────────────────────────────

const LEARNER_ID_KEY = "evenkeel.student.id";

export interface LearnerIdRotation {
  /** Truthy if a previous id existed and was replaced. */
  previousExisted: boolean;
  /** Short, base36-encoded prefix of the newly-minted id (audit display only). */
  newIdPrefix: string;
}

export function rotateLearnerId(): LearnerIdRotation {
  if (typeof window === "undefined") {
    return { previousExisted: false, newIdPrefix: "" };
  }
  let prevExisted = false;
  try {
    prevExisted = window.localStorage.getItem(LEARNER_ID_KEY) !== null;
  } catch {
    /* private mode — treat as non-existent */
  }
  const rng = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const fresh = `s_${rng}`;
  try {
    window.localStorage.setItem(LEARNER_ID_KEY, fresh);
  } catch {
    /* quota / private mode — best-effort */
  }
  try {
    publish(
      "parent.erasure.completed",
      { removedCount: prevExisted ? 1 : 0, keptCount: 0, learnerIdRotated: true },
      "parent",
    );
  } catch {
    /* bus may be unavailable in tests */
  }
  return {
    previousExisted: prevExisted,
    newIdPrefix: fresh.slice(0, 10),
  };
}
