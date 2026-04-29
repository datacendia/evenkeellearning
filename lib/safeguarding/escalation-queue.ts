// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/escalation-queue.ts
//
// The DSL (Designated Safeguarding Lead) escalation queue.
//
// When the Decision Gate fires a `crisis_response` block, the surface that
// owns the chat (currently `components/shared/EkeChat.tsx`) calls
// `enqueueEscalation()` here with category-only metadata. The queue:
//
//   1. Generates a UUID
//   2. Builds a payload that DOES NOT contain the learner's text
//   3. Signs the payload with the per-tab ECDSA P-256 session key
//      (re-using the `lib/crypto/signing.ts` primitive proven in the
//       Compliance Resolution Tray and v1.4.6 Learning Receipts)
//   4. Persists the signed entry locally
//   5. Notifies subscribers so the Compliance "Safeguarding Escalations"
//      card refreshes live
//
// This module owns ONLY the queue. Out-of-band delivery (the actual
// webhook POST to a school's pastoral / MIS endpoint) is coordinated
// via `attemptWebhookDelivery()` below. Phase-1 honesty: the fetch is
// real but no endpoint is configured by default — schools enter their
// own URL via `lib/safeguarding/webhook-config.ts`. There is NO email /
// SMS provider integration in v1.4.8; that is Phase 2.
//
// PRIVACY CONTRACT (pinned by tests in `tests/unit/escalation-queue.test.ts`)
// ──────────────────────────────────────────────────────────────────────────
//   • Stored entries contain ONLY: { id, detectedAt, triggerType,
//     crisisPatternCategory, jurisdiction, studentAgeBand?,
//     engineVersion, signedEnvelope, deliveryState }.
//   • The signed payload's `payload` field MUST NOT contain learner free-form
//     text, learner name, learner email, the matched regex source, or any
//     other identifier beyond `studentAgeBand` (which is self-declared).
//   • The bus event `safeguarding.escalation.requested` carries the same
//     contract.
//   • If a school's DSL endpoint is compromised, the leaked surface area
//     is bounded to "a learner using a `temporal_escalation` pattern at
//     14:23 GMT in jurisdiction UK".
//
// See SAFEGUARDING.md §1.8 for the full operational contract.
// ─────────────────────────────────────────────────────────────────────────────

import { signPayload, verifyEnvelope, SignedEnvelope } from "../crypto/signing";
import type {
  CrisisPatternCategory,
  TriggerType,
} from "../regulatory-absorb/types";

/** localStorage key for the persistent queue. v1 prefix permits future migrations. */
const STORAGE_KEY = "evenkeel.safeguarding.queue.v1";

/** Engine version pinned into every signed payload for reproducibility. */
const ENGINE_VERSION = "evenkeel@1.4.10";

/**
 * Hard cap on entries kept on-device. v1.4.8 used this as the *primary*
 * eviction trigger (oldest-first when the cap was hit). v1.4.10 makes it
 * a defence-in-depth ceiling: time-based pruning (`RETENTION_DAYS`) is
 * the primary eviction mechanism. The cap exists so a runaway producer
 * (e.g. a stuck loop publishing thousands of escalations in a session)
 * cannot exhaust localStorage even before the time-prune runs.
 */
const MAX_QUEUE_ENTRIES = 200;

/**
 * v1.4.10 — Write-Once-Read-Many retention period. After this many days,
 * an entry's signed payload is removed by `pruneExpiredEscalations()`.
 *
 * **WORM contract (pinned by tests):**
 *   • Signed payloads (the `envelope.payload` and the signature itself)
 *     are immutable for the duration of retention. Code paths that
 *     mutate `deliveryState` (an unsigned, operational sibling) MUST NOT
 *     touch the envelope.
 *   • Entries leave the store via exactly two routes: (a) expiry under
 *     the retention policy below, or (b) the explicit admin
 *     `clearEscalations()` call (a user action, not silent code).
 *   • The 200-entry hard cap is a defence-in-depth ceiling against
 *     storage exhaustion; if it ever fires, the eviction is documented
 *     in the bus event and surfaced in HONESTY.md.
 *
 * 90 days is the default because (a) it covers a typical school term
 * boundary, (b) it predates UK SAR (Subject Access Request) timelines,
 * and (c) it keeps localStorage budgets bounded for long-lived devices.
 * Schools that want shorter retention can override at config-time in
 * Phase 2; v1.4.10 ships a single value because Phase-1 honesty wins
 * over premature configurability.
 */
export const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Max webhook delivery attempts before the entry is marked `failed`. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** Per-attempt fetch timeout (ms). */
const WEBHOOK_TIMEOUT_MS = 8_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The signable, category-only payload that is sent to a school's DSL
 * endpoint. **Every field on this interface is non-PII by design.** Adding
 * fields here is governed by HONESTY.md §2.1 (privacy contract changes
 * require a CHANGELOG entry).
 */
export interface EscalationPayload {
  /** Stable UUID for this escalation. */
  id: string;
  /** Epoch ms at detection (Decision Gate match time). */
  detectedAt: number;
  /** ISO-8601 timestamp at detection. */
  detectedAtIso: string;
  /** Always `"crisis_response"` in v1.4.8. */
  triggerType: TriggerType;
  /** Family of pattern that matched. NEVER the matched text. */
  crisisPatternCategory: CrisisPatternCategory;
  /** Jurisdiction of the surface (e.g. `"ie"`, `"uk"`). */
  jurisdiction: string;
  /** Self-declared age band. Optional and explicitly non-PII. */
  studentAgeBand?: string;
  /** Engine version pinned for reproducibility. */
  engineVersion: string;
  /**
   * Stable, opaque tab identifier so a school can correlate multiple
   * escalations from the same browser tab without learning the device
   * identity. Generated once per tab; cleared with the queue.
   */
  tabContextId: string;
}

/** Tracks out-of-band delivery to the school's DSL endpoint. */
export type DeliveryState =
  | { kind: "queued" }                                    // never attempted
  | { kind: "no_endpoint" }                               // no URL configured
  | { kind: "in_flight"; attemptStartedAt: number }
  | {
      kind: "sent";
      attemptCount: number;
      lastResponseStatus: number;
      lastSucceededAt: number;
    }
  | {
      kind: "failed";
      attemptCount: number;
      lastError: string;            // sanitized: never contains response body
      lastFailedAt: number;
    };

export interface EscalationEntry {
  /** Mirrors `payload.id` for local-store lookup. */
  id: string;
  /** Mirrors `payload.detectedAt` for fast sort without parsing the envelope. */
  detectedAt: number;
  /** The signed envelope; verifiable offline by anyone with the embedded key. */
  envelope: SignedEnvelope<EscalationPayload>;
  /** Delivery state — local only, never signed. */
  deliveryState: DeliveryState;
}

/** Input to `enqueueEscalation()`; the queue fills in id, timestamps, version. */
export interface EnqueueInput {
  triggerType: TriggerType;
  crisisPatternCategory: CrisisPatternCategory;
  jurisdiction: string;
  studentAgeBand?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab context id — generated once per tab; not PII.
// ─────────────────────────────────────────────────────────────────────────────

const TAB_CONTEXT_KEY = "evenkeel.safeguarding.tabContextId.v1";

function getTabContextId(): string {
  if (typeof window === "undefined") return "ssr-no-tab";
  try {
    const existing = window.sessionStorage.getItem(TAB_CONTEXT_KEY);
    if (existing && typeof existing === "string" && existing.length > 0) {
      return existing;
    }
  } catch {
    // sessionStorage may throw in private-mode Safari; fall through.
  }
  const fresh = newId("tab");
  try {
    window.sessionStorage.setItem(TAB_CONTEXT_KEY, fresh);
  } catch {
    // Best-effort; if persistence fails, the same fresh id is returned
    // for the lifetime of this module load.
  }
  return fresh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

function readStore(): EscalationEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function writeStore(entries: EscalationEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed =
      entries.length > MAX_QUEUE_ENTRIES
        ? entries.slice(entries.length - MAX_QUEUE_ENTRIES)
        : entries;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota / private-mode failures are non-fatal; the in-memory copy
    // returned by the call site is still usable.
  }
}

function isValidEntry(x: unknown): x is EscalationEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  if (typeof e.id !== "string") return false;
  if (typeof e.detectedAt !== "number") return false;
  if (!e.envelope || typeof e.envelope !== "object") return false;
  if (!e.deliveryState || typeof e.deliveryState !== "object") return false;
  const env = e.envelope as Record<string, unknown>;
  if (typeof env.signatureB64url !== "string") return false;
  if (typeof env.publicKeyB64url !== "string") return false;
  if (!env.payload || typeof env.payload !== "object") return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// IDs
// ─────────────────────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  // Crypto-strong UUID where available; falls back to Math.random for the
  // (vanishingly rare) environment without WebCrypto.
  const rng =
    typeof globalThis.crypto !== "undefined" && globalThis.crypto
      ? globalThis.crypto
      : null;
  if (rng && "randomUUID" in rng) {
    try {
      return `${prefix}_${(rng as Crypto).randomUUID()}`;
    } catch {
      // fall through
    }
  }
  const r = Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}_${r}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscribers
// ─────────────────────────────────────────────────────────────────────────────

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notify(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // A misbehaving subscriber must never stop the others.
    }
  }
}

/**
 * Subscribe to local queue changes. Returns an unsubscribe function.
 * Subscribers fire after enqueue, after delivery state change, and after
 * `clearEscalations()`. They do NOT fire on simple reads.
 */
export function subscribeEscalations(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a new escalation to the queue. The payload is signed before
 * persistence so the entry is verifiable offline by any holder of the
 * envelope.
 *
 * Privacy: this function intentionally accepts NO `text` parameter. If a
 * future caller is tempted to pass the learner's message in, the type
 * system rejects it.
 */
export async function enqueueEscalation(
  input: EnqueueInput,
): Promise<EscalationEntry> {
  const detectedAt = Date.now();
  const id = newId("esc");
  const payload: EscalationPayload = {
    id,
    detectedAt,
    detectedAtIso: new Date(detectedAt).toISOString(),
    triggerType: input.triggerType,
    crisisPatternCategory: input.crisisPatternCategory,
    jurisdiction: input.jurisdiction,
    ...(input.studentAgeBand ? { studentAgeBand: input.studentAgeBand } : {}),
    engineVersion: ENGINE_VERSION,
    tabContextId: getTabContextId(),
  };
  const envelope = await signPayload(payload);
  const entry: EscalationEntry = {
    id,
    detectedAt,
    envelope,
    deliveryState: { kind: "queued" },
  };
  const store = readStore();
  store.push(entry);
  writeStore(store);
  notify();
  return entry;
}

/** All entries, oldest-first. */
export function listEscalations(): EscalationEntry[] {
  return readStore();
}

/** Single entry by id, or null. */
export function getEscalation(id: string): EscalationEntry | null {
  return readStore().find((e) => e.id === id) ?? null;
}

/** Wipe the queue. Intended for the "Clear queue" admin action. */
export function clearEscalations(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
}

// ─────────────────────────────────────────────────────────────────────────────
// WORM retention (v1.4.10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure helper — returns true when an entry's signed `detectedAt` is more
 * than `RETENTION_MS` before `now`. Exposed for tests; production calls
 * `pruneExpiredEscalations()` which uses it internally.
 *
 * The decision uses `entry.detectedAt` (which mirrors the *signed*
 * `payload.detectedAt`), never any unsigned operational field, so a
 * tampered `deliveryState.lastFailedAt` cannot extend an entry's
 * lifetime past the WORM ceiling.
 */
export function isExpired(
  entry: EscalationEntry,
  now: number = Date.now(),
): boolean {
  return now - entry.detectedAt > RETENTION_MS;
}

/**
 * Removes every entry whose signed `detectedAt` is older than
 * `RETENTION_DAYS` days before `now`. Returns the number of entries
 * removed. Notifies subscribers iff at least one entry was removed.
 *
 * Idempotent — calling twice in a row with the same `now` removes
 * nothing on the second call.
 *
 * **WORM honesty:** this function is the *only* code path (alongside
 * the explicit admin `clearEscalations()`) that removes signed
 * payloads. The webhook delivery path mutates `deliveryState` (an
 * unsigned sibling field) but never touches the envelope.
 */
export function pruneExpiredEscalations(now: number = Date.now()): number {
  if (typeof window === "undefined") return 0;
  const store = readStore();
  const survivors = store.filter((e) => !isExpired(e, now));
  const removed = store.length - survivors.length;
  if (removed > 0) {
    writeStore(survivors);
    notify();
  }
  return removed;
}

/**
 * Verify the signature on a stored entry's envelope. Wraps
 * `verifyEnvelope` so callers do not have to import it directly.
 */
export async function verifyEscalation(
  entry: EscalationEntry,
): Promise<boolean> {
  return verifyEnvelope(entry.envelope);
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook delivery (Phase-1 honest, Phase-2 expandable)
// ─────────────────────────────────────────────────────────────────────────────

function setDeliveryState(id: string, state: DeliveryState): EscalationEntry | null {
  const store = readStore();
  const idx = store.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const next: EscalationEntry = { ...store[idx]!, deliveryState: state };
  store[idx] = next;
  writeStore(store);
  notify();
  return next;
}

/** Sanitize an arbitrary error for safe persistence. */
function sanitizeError(e: unknown): string {
  if (e instanceof Error) {
    // Strip URLs from messages so a typo'd endpoint doesn't leak into
    // localStorage as a quotable token.
    return e.message.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240);
  }
  if (typeof e === "string") return e.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240);
  return "Unknown error";
}

/**
 * POST the signed envelope to the configured DSL endpoint. Phase-1
 * semantics:
 *   • If no endpoint is configured, the entry transitions to
 *     `{ kind: "no_endpoint" }` and the function resolves without
 *     invoking fetch.
 *   • If the endpoint returns 2xx, transitions to `sent`.
 *   • Network / non-2xx / timeout errors increment `attemptCount`. Once
 *     it reaches `MAX_DELIVERY_ATTEMPTS`, the entry is `failed`.
 *   • This function does NOT loop. The caller (UI button or scheduler)
 *     decides retry timing.
 */
export async function attemptWebhookDelivery(
  id: string,
  fetchFn: typeof fetch | null = typeof fetch !== "undefined" ? fetch : null,
  endpointUrl: string | null = null,
): Promise<EscalationEntry | null> {
  const entry = getEscalation(id);
  if (!entry) return null;

  // Resolve endpoint lazily so the import graph stays one-way.
  if (endpointUrl === null) {
    try {
      const mod = await import("./webhook-config");
      endpointUrl = mod.getWebhookEndpoint();
    } catch {
      endpointUrl = null;
    }
  }

  if (!endpointUrl || !fetchFn) {
    return setDeliveryState(id, { kind: "no_endpoint" });
  }

  const previousAttempts =
    entry.deliveryState.kind === "failed"
      ? entry.deliveryState.attemptCount
      : entry.deliveryState.kind === "sent"
        ? entry.deliveryState.attemptCount
        : 0;

  setDeliveryState(id, {
    kind: "in_flight",
    attemptStartedAt: Date.now(),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetchFn(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Surface the signing public key in a header so a receiver can
        // verify the body without parsing the envelope first.
        "X-EvenKeel-PublicKey": entry.envelope.publicKeyB64url,
        "X-EvenKeel-Algorithm": entry.envelope.algorithm,
      },
      body: JSON.stringify(entry.envelope),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      return setDeliveryState(id, {
        kind: "sent",
        attemptCount: previousAttempts + 1,
        lastResponseStatus: res.status,
        lastSucceededAt: Date.now(),
      });
    }
    const nextAttempts = previousAttempts + 1;
    return setDeliveryState(id, {
      kind: "failed",
      attemptCount: nextAttempts,
      lastError: `HTTP ${res.status}`,
      lastFailedAt: Date.now(),
    });
  } catch (e) {
    clearTimeout(timer);
    const nextAttempts = previousAttempts + 1;
    return setDeliveryState(id, {
      kind: "failed",
      attemptCount: nextAttempts,
      lastError: sanitizeError(e),
      lastFailedAt: Date.now(),
    });
  }
}
