// ─────────────────────────────────────────────────────────────────────────────
// lib/receipts/learning-receipt.ts
//
// Signed Learning Receipts. The artefact a learner can hand a teacher
// (or, eventually, an exam board / FE college / employer) that says
// *this work was done by this learner, here's how, and the cryptography
// proves the receipt has not been tampered with*.
//
// Phase-1 design choice (per the consolidated review pushback):
//   • Designed against the **single-teacher coursework-acceptance** use
//     case, NOT the university-admissions use case. The rung-1 destination
//     is one teacher in one school accepting one signed receipt as
//     evidence for one coursework grade. The path teacher → school →
//     exam board → university is shorter than zero → university; we
//     build for rung 1, not rung 3.
//   • Re-uses the existing `signPayload` / `verifyEnvelope` primitives
//     in `lib/crypto/signing.ts` — the same battle-tested ECDSA P-256
//     code that backs the Compliance Resolution Tray's signed envelopes.
//
// Privacy contract
// ────────────────
//   • The payload contains AGGREGATE signals only — never learner free-
//     form text, never the expected value of the problem. Specifically:
//     learner initials (already shown on the surface), problem id and
//     sanitised title, attempt counts grouped by `AnswerCategory`, the
//     max hint tier reached, the current Leitner box, gate-cleared
//     boolean, paste-attempt count, last trust score, count of practice
//     sessions, and jurisdiction. Each one of these is already public
//     to the learner and the teacher in some form; the receipt is the
//     act of signing the bundle.
//   • The payload deliberately does NOT include practice-mode session
//     contents — only the count. The v1.4.3 contract still applies.
//
// Cross-device verification
// ─────────────────────────
// Receipts are stored locally under `evenkeel.receipts.bank`. A teacher
// on a different device verifies by importing the self-verifying JSON
// envelope (which carries `payload`, `signatureB64url`, `publicKeyB64url`
// and `contentDigestB64url`) into the verifier route at `/receipt/[id]`.
// No server is contacted. See HONESTY.md for the explicit limitation
// that the per-tab session key is not yet tied to a persistent identity
// — Phase 2 swaps it for a passkey-bound key.
// ─────────────────────────────────────────────────────────────────────────────

import {
  signPayload,
  verifyEnvelope,
  type SignedEnvelope,
  type SignKeySource,
} from "@/lib/crypto/signing";
import type { TrackedCategory } from "@/lib/eke/error-bank";

const STORAGE_KEY = "evenkeel.receipts.bank";
const LEGACY_STORAGE_KEY = "keellearn.receipts.bank";
const MAX_RECEIPTS = 100;

/**
 * Aggregate counts of validated-answer categories across the session(s)
 * being attested. `correct` and the five tracked-error categories from
 * `lib/eke/error-bank.ts` are the keys; values are non-negative integers.
 */
export interface CategoryCounts {
  correct: number;
  sign_flipped: number;
  off_by_one: number;
  doubled: number;
  halved: number;
  wrong: number;
}

export const EMPTY_CATEGORY_COUNTS: Readonly<CategoryCounts> = Object.freeze({
  correct: 0,
  sign_flipped: 0,
  off_by_one: 0,
  doubled: 0,
  halved: 0,
  wrong: 0,
});

/**
 * The data that gets signed. **Privacy-bounded by contract:** never any
 * learner free-form text and never an expected value. See the module
 * header.
 */
export interface LearningReceiptPayload {
  /** Opaque id; used as the URL key on `/receipt/[id]`. */
  receiptId: string;
  /** ISO-8601 timestamp the receipt was signed. */
  issuedAtIso: string;
  /** Schema version to allow forward migration. */
  schemaVersion: 1;
  /** Surface label / device-local pseudonym. Never full name, never email. */
  learnerInitials: string;
  /** Opaque problem id supplied by the surface. */
  problemId: string;
  /** Short sanitised title used for display. */
  problemTitle: string;
  /** Optional skill family the problem belongs to. */
  skillFamily?: string;
  /** Total recorded validated attempts on this problem during the session. */
  attemptsTotal: number;
  /**
   * The 1-indexed attempt at which the learner first hit `correct`, or
   * `null` if mastery was not reached during the attested session.
   */
  correctOnAttempt: number | null;
  /** Maximum hint tier reached. 0..4 (0 = no hints, 4 = worked-parallel). */
  hintTierMax: 0 | 1 | 2 | 3 | 4;
  /** Aggregate counts of `AnswerCategory` results. */
  categoryCounts: CategoryCounts;
  /** Current Leitner box (1..5) at issue time. */
  leitnerBox: number;
  /** Whether the comprehension gate was cleared on this problem. */
  gateCleared: boolean;
  /** Number of times paste was blocked during the attested session. */
  pasteAttempts: number;
  /** Last live trust score (0..100) from the IPA at issue time. */
  trustScore: number;
  /** Count of v1.4.3 practice sessions during the attested window. */
  practiceSessionsCount: number;
  /** Jurisdiction the surface was running for (e.g. "IE"). */
  jurisdiction: string;
}

/**
 * The on-disk + on-the-wire shape. The signed envelope wraps the
 * payload; the `id` and `issuedAtIso` are mirrored at the top level so
 * verifiers can list / route on them without first parsing the payload.
 */
export interface SignedLearningReceipt {
  id: string;
  issuedAtIso: string;
  envelope: SignedEnvelope<LearningReceiptPayload>;
}

type Listener = (entries: SignedLearningReceipt[]) => void;
const listeners = new Set<Listener>();

let migrated = false;

function migrateLegacy(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && !window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
    }
    if (legacy !== null) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // privacy mode / quota — proceed without migration
  }
}

function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  migrateLegacy();
}

function isReceipt(value: unknown): value is SignedLearningReceipt {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SignedLearningReceipt>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.issuedAtIso === "string" &&
    v.envelope !== undefined &&
    typeof v.envelope === "object"
  );
}

function readRaw(): SignedLearningReceipt[] {
  ensureMigrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReceipt);
  } catch {
    return [];
  }
}

function writeRaw(entries: SignedLearningReceipt[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota — ignore; in-memory notify still fires
  }
}

function notify(entries: SignedLearningReceipt[]): void {
  listeners.forEach((fn) => {
    try {
      fn(entries);
    } catch {
      // a bad subscriber must not poison the rest
    }
  });
}

function makeReceiptId(): string {
  // Opaque, not seeded with anything identifying. Same shape as the
  // ids the data bus generates for events.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns every locally-stored receipt, newest first. */
export function listReceipts(): SignedLearningReceipt[] {
  return readRaw().slice().sort((a, b) => b.issuedAtIso.localeCompare(a.issuedAtIso));
}

/** Returns one receipt by id, or `undefined`. */
export function getReceipt(id: string): SignedLearningReceipt | undefined {
  return readRaw().find((r) => r.id === id);
}

/**
 * Issues — i.e. signs and persists — a Learning Receipt for the supplied
 * pre-built payload. The caller is responsible for populating the payload
 * fields from the surface state; `issueReceipt` only signs and persists.
 *
 * `receiptId` and `issuedAtIso` and `schemaVersion` are filled in here so
 * the caller cannot forget them (and so the call site is easier to read).
 *
 * Bounded at MAX_RECEIPTS entries; the oldest is evicted first.
 */
export async function issueReceipt(
  partial: Omit<LearningReceiptPayload, "receiptId" | "issuedAtIso" | "schemaVersion">,
  opts?: SignKeySource,
): Promise<SignedLearningReceipt> {
  const receiptId = makeReceiptId();
  const issuedAtIso = new Date().toISOString();
  const payload: LearningReceiptPayload = {
    ...partial,
    receiptId,
    issuedAtIso,
    schemaVersion: 1,
  };
  const envelope = await signPayload(payload, opts);
  const receipt: SignedLearningReceipt = {
    id: receiptId,
    issuedAtIso,
    envelope,
  };
  const next = [...readRaw(), receipt];
  while (next.length > MAX_RECEIPTS) next.shift();
  writeRaw(next);
  notify(next);
  return receipt;
}

/**
 * Adds a foreign-issued receipt to the local store. Used by the
 * verifier route when a teacher pastes a JSON envelope to verify and
 * (optionally) keep a copy.
 *
 * Returns the imported receipt on success, or `null` if the JSON
 * doesn't parse to a valid `SignedLearningReceipt`. Verification is the
 * caller's responsibility — `importReceiptJson` does not silently bin a
 * receipt that fails verification, so the verifier UI can surface
 * "imported but signature invalid" honestly.
 */
export function importReceiptJson(json: string): SignedLearningReceipt | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isReceipt(parsed)) return null;
    const next = readRaw().filter((r) => r.id !== parsed.id);
    next.push(parsed);
    while (next.length > MAX_RECEIPTS) next.shift();
    writeRaw(next);
    notify(next);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verifies a stored or freshly-imported receipt end-to-end via the
 * existing `verifyEnvelope` primitive (digest re-derivation, public-key
 * import, ECDSA verify). Pure pass-through; exposed here so callers
 * don't need to import `lib/crypto/signing.ts` separately.
 */
export async function verifyReceipt(
  receipt: SignedLearningReceipt,
): Promise<boolean> {
  return verifyEnvelope(receipt.envelope);
}

/** Subscribes to bank updates. Returns an unsubscribe function. */
export function subscribeReceipts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clears every locally-stored receipt. Tests + future learner control. */
export function clearReceipts(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  notify([]);
}

/**
 * Helper: maps a `TrackedCategory` (from `lib/eke/error-bank.ts`) onto
 * a `CategoryCounts` field name. Exposed so the surface aggregator
 * doesn't repeat the mapping. `correct` is handled separately by the
 * caller because it isn't a `TrackedCategory`.
 */
export function categoryCountsKey(c: TrackedCategory): keyof CategoryCounts {
  return c;
}

/** Test-only: re-arm legacy migration so it can be re-exercised. */
export const __resetMigrationFlagForTests = (): void => {
  migrated = false;
};
