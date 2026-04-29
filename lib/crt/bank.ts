// ─────────────────────────────────────────────────────────────────────────────
// lib/crt/bank.ts
//
// Local "bank" of finalized, signed Cognitive Reasoning Traces.
//
// What this is
// ────────────
// A tiny, bounded `localStorage` ring of signed `CognitiveReasoningTrace`
// envelopes. Whenever an EkeChat session ends (problem change, surface
// unmount, or explicit teacher-style "end session"), the per-session
// `CRTLogger` is finalised and the proof-of-work-hashed trace is signed
// via `lib/crypto/signing.ts` and appended here.
//
// Why a bank
// ──────────
// The signing primitive proves *integrity* (the trace has not been
// tampered with) and *authorship* (binds to the session ECDSA-P256 key
// or, when v1.5.4 follow-up wires it, a passkey). Persistence makes the
// trace surviveable across reloads so the `/teacher` Integrity Ledger
// and `/compliance` audit surfaces have a verifiable record to point at.
//
// Privacy
// ───────
// The trace contains no learner free-form text. `CRTLogger` records
// per-event metadata (timestamp, eventType, duration, derived hashes)
// and at submit time hashes the answer text — never the text itself.
// Bus events emitted from this module carry envelope summary fields only
// (digest + signature prefix + counts).
// ─────────────────────────────────────────────────────────────────────────────

import type { CognitiveReasoningTrace } from "@/lib/types";
import {
  signPayloadWithAutoPasskey,
  verifyEnvelope,
  type SignedEnvelope,
} from "@/lib/crypto/signing";
import { publish } from "@/lib/data-bus";

const STORAGE_KEY = "evenkeel.crt.bank";

/**
 * Hard cap on retained CRTs. The size of a single CRT scales with
 * keystroke-event count, so 100 is a defensive ceiling rather than a
 * routine number. Real sessions average <20 events.
 */
export const MAX_CRT_ENTRIES = 100;

/**
 * Public envelope persisted in the bank. The `payload` is the trace
 * itself; the rest is the standard `SignedEnvelope` shape.
 */
export type CRTEnvelope = SignedEnvelope<CognitiveReasoningTrace>;

/** SSR-safe read; returns `[]` if unparseable. Filters obviously-malformed
 *  entries instead of throwing on them. */
export function listCRTs(): CRTEnvelope[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEnvelope);
  } catch {
    return [];
  }
}

/**
 * Sign `trace` with auto-detected passkey (if enrolled) or session key and
 * append the resulting envelope to the bank. Returns the appended envelope
 * so callers can publish a summary.
 *
 * The bus event `student.crt.session.finalized` is fired on success with
 * envelope summary fields only — no full payload, no signatures-in-bus.
 *
 * Bounded write: oldest entries are dropped first when the cap is hit.
 */
export async function appendCRT(
  trace: CognitiveReasoningTrace,
  signer?: (
    p: CognitiveReasoningTrace,
  ) => Promise<CRTEnvelope>,
): Promise<CRTEnvelope> {
  const env = await (signer ?? signPayloadWithAutoPasskey)(trace);
  if (typeof window !== "undefined") {
    try {
      const current = listCRTs();
      const next = [...current, env];
      while (next.length > MAX_CRT_ENTRIES) next.shift();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota / private mode — best-effort. The envelope is still
      // returned so an in-memory consumer can use it.
    }
  }
  try {
    publish(
      "student.crt.session.finalized",
      {
        studentId: trace.studentId,
        problemId: trace.problemId,
        sessionId: trace.sessionId,
        eventCount: trace.events.length,
        deletionCount: trace.deletionCount,
        pivotCount: trace.pivotCount,
        durationMs:
          trace.endTime != null ? trace.endTime - trace.startTime : null,
        contentDigestB64url: env.contentDigestB64url,
        signaturePrefix: env.signatureB64url.slice(0, 16),
        publicKeyPrefix: env.publicKeyB64url.slice(0, 16),
        algorithm: env.algorithm,
        keyType: env.keyType,
      },
      "student",
    );
  } catch {
    /* bus may be unavailable in tests; persistence already succeeded */
  }
  return env;
}

/** Wipe the bank. Used by GDPR Art. 17 erasure (via the namespace prefix
 *  walk in `lib/safety/erasure.ts`) and by tests. */
export function clearCRTs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Verify every envelope in the bank. Returns the list of envelopes for
 *  which `verifyEnvelope` returned `true`. */
export async function listVerifiedCRTs(): Promise<CRTEnvelope[]> {
  const all = listCRTs();
  const checks = await Promise.all(all.map((e) => verifyEnvelope(e)));
  return all.filter((_, i) => checks[i]);
}

function isValidEnvelope(x: unknown): x is CRTEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  if (typeof e.signatureB64url !== "string") return false;
  if (typeof e.publicKeyB64url !== "string") return false;
  if (typeof e.contentDigestB64url !== "string") return false;
  if (!e.payload || typeof e.payload !== "object") return false;
  const p = e.payload as Record<string, unknown>;
  if (typeof p.studentId !== "string") return false;
  if (typeof p.sessionId !== "string") return false;
  if (typeof p.problemId !== "string") return false;
  if (!Array.isArray(p.events)) return false;
  return true;
}
