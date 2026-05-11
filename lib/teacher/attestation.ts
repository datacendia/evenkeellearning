// ─────────────────────────────────────────────────────────────────────────────
// lib/teacher/attestation.ts
//
// v1.6.7 — Teacher attestation envelope. A *counter-credential* over a
// student-signed CRT: the teacher reviews the trace, picks a verdict,
// optionally writes a short note, and signs the whole bundle with
// their passkey. The result is a doubly-signed artefact:
//
//   student-signed CRT  →  pinned-by-digest in  →  teacher-signed attestation
//
// This is the SINGLE most important pilot primitive for the VC platform
// downstream. A W3C VC issued later will wrap a teacher attestation as
// the proof-of-claim payload — the VC's `credentialSubject` says
// "teacher T attested that learner L demonstrated skill S on trace
// digest D", and the VC's value depends entirely on the teacher's
// signature being passkey-derived and verifiable.
//
// VC FORWARD-COMPATIBILITY (cf. the vc-design-caveat todo)
// ────────────────────────────────────────────────────────
// `TeacherAttestationSpecPoint` carries:
//   • framework + code        (factual identifiers, always present)
//   • claimVocabularyVersion  (integer, starts at 1)
//   • skillUri                (explicitly optional in v1; populated when
//                              the curriculum registry lands without
//                              re-signing the attestation, because the
//                              `framework + code` form is canonical)
//
// PASSKEY REQUIREMENT
// ───────────────────
// Attestation signing uses `signPayloadWithAutoPasskey(..., { requirePasskey: true })`.
// This throws `PasskeyRequiredError` rather than silently falling back
// to a session-demo key. A teacher who has not enrolled a passkey
// CANNOT produce an attestation, by design — a session-key receipt
// over a counter-credential would be misleading evidence in a VC
// context.
//
// PRIVACY
// ───────
// • The attestation references the CRT by its content digest, not by
//   embedding the CRT itself.
// • The `studentExternalId` is the school's own ID; never the learner's
//   real name. (Names live only in the encrypted roster store.)
// • The reviewer note is teacher-authored prose and is bounded to 280
//   chars — long enough for a single sentence of professional judgement,
//   short enough that it stays a *note*, not a profile.
// • Bus events carry counts + digest prefixes + verdict only.
// ─────────────────────────────────────────────────────────────────────────────

import {
  signPayloadWithAutoPasskey,
  verifyEnvelope,
  type SignedEnvelope,
} from "@/lib/crypto/signing";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * One spec-point claim inside an attestation. Forward-compatible with the
 * curriculum-registry-backed `skillUri` form, which can be back-filled
 * by a verifier without re-issuing the attestation (since the
 * `framework + code` tuple is the canonical identifier).
 */
export interface TeacherAttestationSpecPoint {
  /** e.g. "AQA-GCSE-9-1-Maths". */
  framework: string;
  /** e.g. "A18". */
  code: string;
  /** Short human-readable label as the teacher saw it at sign-time. */
  label?: string;
  /** Vocabulary version. Starts at 1; bumped only on breaking changes. */
  claimVocabularyVersion: 1;
  /** Resolvable URI; populated by the curriculum registry when available. */
  skillUri?: string;
}

/**
 * The four allowed verdicts. Strict enum so a downstream VC issuer
 * can map each to a credential semantic without parsing free text.
 */
export type AttestationVerdict =
  | "verified-mastery"
  | "verified-with-support"
  | "needs-revisit"
  | "anomaly-rejected";

/**
 * The plaintext payload that gets signed. Versioned so v2 schema bumps
 * are easy to spot in stored artefacts.
 */
export interface TeacherAttestationPayload {
  version: 1;

  /** SHA-256 digest of the student-signed CRT being attested. */
  crtContentDigestB64url: string;

  /** External (school) ID of the learner. Matches the roster store. */
  studentExternalId: string;

  /** Problem the trace was produced against (matches CRT.problemId). */
  problemId: string;

  /** ISO timestamp of the attestation moment. */
  attestedAtIso: string;

  /** Teacher's verdict. */
  verdict: AttestationVerdict;

  /**
   * Optional short note in the teacher's own words. Bounded length so
   * the artefact stays a *credential*, not a profile.
   */
  reviewerNote?: string;

  /** Zero-or-more spec-point claims. Empty array is legal but unusual. */
  specPoints: TeacherAttestationSpecPoint[];

  /**
   * Optional school / institution identifier (e.g. URN, ROE, NCES code).
   * Carried for downstream VC issuers that need to attribute the
   * attestation to an institutional issuer. v1 leaves it free-form.
   */
  institutionId?: string;
}

/** Standard envelope shape after passkey signing. */
export type TeacherAttestationEnvelope = SignedEnvelope<TeacherAttestationPayload>;

// ── Constants / validators ─────────────────────────────────────────────────

export const REVIEWER_NOTE_MAX_CHARS = 280;
export const SPECPOINT_MAX_COUNT = 16;

const VERDICT_VALUES: ReadonlySet<string> = new Set([
  "verified-mastery",
  "verified-with-support",
  "needs-revisit",
  "anomaly-rejected",
]);

/**
 * Type guard + structural validator. Used both before signing (to
 * refuse malformed input early) and inside `verifyAttestation` (to
 * sanity-check a deserialised envelope before trusting it).
 *
 * Returns null on a valid payload, or a short reason string on
 * rejection. Reason strings are stable identifiers safe to surface in
 * the UI or to grep for in tests.
 */
export function validateAttestationPayload(
  p: unknown,
): null | string {
  if (!p || typeof p !== "object") return "payload_not_object";
  const o = p as Record<string, unknown>;
  if (o.version !== 1) return "wrong_version";
  if (typeof o.crtContentDigestB64url !== "string" || o.crtContentDigestB64url.length === 0)
    return "missing_crt_digest";
  if (typeof o.studentExternalId !== "string" || o.studentExternalId.length === 0)
    return "missing_student_external_id";
  if (typeof o.problemId !== "string" || o.problemId.length === 0)
    return "missing_problem_id";
  if (typeof o.attestedAtIso !== "string" || isNaN(Date.parse(o.attestedAtIso)))
    return "bad_attested_at";
  if (typeof o.verdict !== "string" || !VERDICT_VALUES.has(o.verdict))
    return "bad_verdict";
  if (o.reviewerNote !== undefined) {
    if (typeof o.reviewerNote !== "string") return "bad_reviewer_note_type";
    if (o.reviewerNote.length > REVIEWER_NOTE_MAX_CHARS) return "reviewer_note_too_long";
  }
  if (!Array.isArray(o.specPoints)) return "bad_spec_points_type";
  if ((o.specPoints as unknown[]).length > SPECPOINT_MAX_COUNT) return "too_many_spec_points";
  for (const sp of o.specPoints as unknown[]) {
    if (!sp || typeof sp !== "object") return "bad_spec_point_shape";
    const s = sp as Record<string, unknown>;
    if (typeof s.framework !== "string" || s.framework.length === 0) return "bad_spec_point_framework";
    if (typeof s.code !== "string" || s.code.length === 0) return "bad_spec_point_code";
    if (s.claimVocabularyVersion !== 1) return "bad_spec_point_vocab_version";
    if (s.label !== undefined && typeof s.label !== "string") return "bad_spec_point_label";
    if (s.skillUri !== undefined && typeof s.skillUri !== "string") return "bad_spec_point_skill_uri";
  }
  if (o.institutionId !== undefined && typeof o.institutionId !== "string")
    return "bad_institution_id";
  return null;
}

// ── Sign ───────────────────────────────────────────────────────────────────

/**
 * Input the caller supplies to `signAttestation`. The orchestrator
 * adds `version`, `attestedAtIso`, and (optionally) fills in default
 * `claimVocabularyVersion` on each spec point.
 */
export interface SignAttestationInput {
  crtContentDigestB64url: string;
  studentExternalId: string;
  problemId: string;
  verdict: AttestationVerdict;
  reviewerNote?: string;
  specPoints?: Array<Omit<TeacherAttestationSpecPoint, "claimVocabularyVersion"> & {
    claimVocabularyVersion?: 1;
  }>;
  institutionId?: string;
  /** Override for tests; defaults to `new Date()`. */
  now?: () => Date;
  /**
   * Test hook to inject a custom signer (used in unit tests that need
   * to bypass passkey ceremonies). When omitted, the production path
   * is `signPayloadWithAutoPasskey(payload, { requirePasskey: true })`.
   */
  signer?: (
    payload: TeacherAttestationPayload,
  ) => Promise<TeacherAttestationEnvelope>;
}

/**
 * Build, validate, and sign a teacher attestation. Throws
 * `PasskeyRequiredError` (from `signPayloadWithAutoPasskey`) when no
 * passkey is enrolled or the ceremony fails. Throws a generic Error
 * with a stable code when the input payload fails validation.
 */
export async function signAttestation(
  input: SignAttestationInput,
): Promise<TeacherAttestationEnvelope> {
  const now = (input.now ?? (() => new Date()))();
  const payload: TeacherAttestationPayload = {
    version: 1,
    crtContentDigestB64url: input.crtContentDigestB64url,
    studentExternalId: input.studentExternalId,
    problemId: input.problemId,
    attestedAtIso: now.toISOString(),
    verdict: input.verdict,
    reviewerNote: input.reviewerNote,
    specPoints: (input.specPoints ?? []).map((sp) => ({
      framework: sp.framework,
      code: sp.code,
      label: sp.label,
      claimVocabularyVersion: 1 as const,
      skillUri: sp.skillUri,
    })),
    institutionId: input.institutionId,
  };
  const reason = validateAttestationPayload(payload);
  if (reason) {
    throw new Error(`invalid_attestation_payload:${reason}`);
  }
  if (input.signer) {
    return input.signer(payload);
  }
  return signPayloadWithAutoPasskey<TeacherAttestationPayload>(payload, {
    requirePasskey: true,
  });
}

// ── Verify ─────────────────────────────────────────────────────────────────

/**
 * Result of verifying an attestation envelope.
 *
 * `crtMatchesExpectedDigest` is only filled in when the caller passed
 * an `expectedCrtDigest` to `verifyAttestation`; it's the pin-check
 * that proves the attestation refers to the trace the caller has in
 * hand (rather than some other trace the teacher might have signed).
 */
export interface AttestationVerifyResult {
  ok: boolean;
  /** Stable reason string when ok is false; empty when ok. */
  reason: string;
  /** Whether the envelope's signature checks out (independent of pin). */
  signatureValid: boolean;
  /** Whether the payload passes structural validation. */
  payloadValid: boolean;
  /** True when caller-supplied expectedCrtDigest matches the envelope's pin. */
  crtMatchesExpectedDigest?: boolean;
  /** True when the teacher used a passkey (vs session-demo key). */
  passkeyDerived: boolean;
}

export interface VerifyAttestationOptions {
  /** If supplied, the envelope's payload.crtContentDigestB64url must match this. */
  expectedCrtDigest?: string;
  /** If true, refuse attestations that were NOT passkey-signed. Default: true. */
  requirePasskey?: boolean;
}

export async function verifyAttestation(
  env: TeacherAttestationEnvelope,
  options: VerifyAttestationOptions = {},
): Promise<AttestationVerifyResult> {
  const requirePasskey = options.requirePasskey !== false; // default true

  const reason = validateAttestationPayload(env.payload);
  const payloadValid = reason === null;
  if (!payloadValid) {
    return {
      ok: false,
      reason: `payload_invalid:${reason}`,
      signatureValid: false,
      payloadValid: false,
      passkeyDerived: env.keyType === "passkey-derived",
    };
  }

  const passkeyDerived = env.keyType === "passkey-derived";
  if (requirePasskey && !passkeyDerived) {
    return {
      ok: false,
      reason: "not_passkey_derived",
      signatureValid: false,
      payloadValid: true,
      passkeyDerived,
    };
  }

  // Crypto verification.
  let signatureValid = false;
  try {
    signatureValid = await verifyEnvelope(env);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return {
      ok: false,
      reason: "bad_signature",
      signatureValid: false,
      payloadValid: true,
      passkeyDerived,
    };
  }

  // Pin check (optional).
  let crtMatchesExpectedDigest: boolean | undefined;
  if (options.expectedCrtDigest !== undefined) {
    crtMatchesExpectedDigest =
      env.payload.crtContentDigestB64url === options.expectedCrtDigest;
    if (!crtMatchesExpectedDigest) {
      return {
        ok: false,
        reason: "crt_digest_pin_mismatch",
        signatureValid: true,
        payloadValid: true,
        passkeyDerived,
        crtMatchesExpectedDigest: false,
      };
    }
  }

  return {
    ok: true,
    reason: "",
    signatureValid: true,
    payloadValid: true,
    passkeyDerived,
    crtMatchesExpectedDigest,
  };
}
