// ─────────────────────────────────────────────────────────────────────────────
// lib/teacher/attestation-bank.ts
//
// v1.6.7 — Local persistence for teacher-signed attestation envelopes.
// Mirrors the design of `lib/crt/bank.ts` (the student-CRT bank), but
// stored at a separate localStorage key so the two artefact streams
// remain independently inspectable / clearable.
//
// Why a separate bank?
// ────────────────────
//   • Different lifecycle: a CRT is finalised once per student session.
//     An attestation is created later, by a teacher, possibly long after.
//   • Different access patterns: teachers want to list ATTESTATIONS by
//     verdict / by student / unattested-CRTs-pending-review. Mixing
//     them with raw CRTs would mean filtering on every read.
//   • Independent erasure: a teacher leaving a school can have their
//     attestations cleared without nuking the underlying CRT bank.
//
// PRIVACY POSTURE
// ───────────────
// Like the CRT bank, the storage envelope contains the SIGNED payload
// in cleartext (so the teacher can re-verify locally). The payload
// itself contains no learner free-text — only digests, problem IDs,
// external IDs (school's own), verdict, and the bounded reviewer note.
// Bus emissions report counts + verdict + envelope-summary fields only.
// ─────────────────────────────────────────────────────────────────────────────

import {
  signAttestation,
  type SignAttestationInput,
  type TeacherAttestationEnvelope,
} from "./attestation";
import { publish } from "@/lib/data-bus";

const STORAGE_KEY = "evenkeel.teacher.attestations";
export const MAX_ATTESTATION_ENTRIES = 200;

/** Bare envelope shape check before trusting a deserialised entry. */
function isValidEnvelope(x: unknown): x is TeacherAttestationEnvelope {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.payload === "object" &&
    typeof o.contentDigestB64url === "string" &&
    typeof o.signatureB64url === "string" &&
    typeof o.publicKeyB64url === "string" &&
    typeof o.algorithm === "string" &&
    typeof o.keyType === "string"
  );
}

/**
 * Read all stored attestations, oldest-first. SSR-safe; returns []
 * when window is unavailable. Filters obviously-malformed records
 * rather than throwing.
 */
export function listAttestations(): TeacherAttestationEnvelope[] {
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

/** Convenience: filter by the CRT they pin to. Useful for "has this
 *  student-signed CRT been attested yet?" queries. */
export function listAttestationsForCrt(
  crtContentDigestB64url: string,
): TeacherAttestationEnvelope[] {
  return listAttestations().filter(
    (a) => a.payload.crtContentDigestB64url === crtContentDigestB64url,
  );
}

/** Convenience: filter by student external ID. */
export function listAttestationsForStudent(
  studentExternalId: string,
): TeacherAttestationEnvelope[] {
  return listAttestations().filter(
    (a) => a.payload.studentExternalId === studentExternalId,
  );
}

/**
 * Sign a new attestation and append it to the bank. Returns the appended
 * envelope. Bounded write — oldest entries roll off when the cap is hit.
 *
 * Throws (does not silently swallow) when:
 *   • the input payload fails validation;
 *   • no passkey is enrolled (PasskeyRequiredError, propagated from
 *     `signPayloadWithAutoPasskey`);
 *   • the passkey ceremony fails.
 *
 * Bus event `teacher.attestation.signed` is emitted on success with
 * envelope-summary fields and verdict — no full payload, no signature
 * bytes (beyond a 16-char prefix), no PII.
 */
export async function appendAttestation(
  input: SignAttestationInput,
): Promise<TeacherAttestationEnvelope> {
  const env = await signAttestation(input);
  if (typeof window !== "undefined") {
    try {
      const current = listAttestations();
      const next = [...current, env];
      while (next.length > MAX_ATTESTATION_ENTRIES) next.shift();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota / private mode — best-effort. The envelope is still
      // returned so an in-memory consumer can use it.
    }
  }
  try {
    publish(
      "teacher.attestation.signed",
      {
        crtContentDigestPrefix: env.payload.crtContentDigestB64url.slice(0, 16),
        problemId: env.payload.problemId,
        studentExternalIdPrefix: env.payload.studentExternalId.slice(0, 8),
        verdict: env.payload.verdict,
        attestedAtIso: env.payload.attestedAtIso,
        specPointCount: env.payload.specPoints.length,
        signaturePrefix: env.signatureB64url.slice(0, 16),
        publicKeyPrefix: env.publicKeyB64url.slice(0, 16),
        keyType: env.keyType,
        algorithm: env.algorithm,
      },
      "teacher",
    );
  } catch {
    /* bus may be unavailable in tests; persistence already succeeded */
  }
  return env;
}

/**
 * Remove every stored attestation. Idempotent. Used by the parent-
 * erasure flow and by tests.
 */
export function clearAttestationBank(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
