// ─────────────────────────────────────────────────────────────────────────────
// lib/parent/report.ts
//
// v1.6.10 — Printable parent report. Aggregates a learner's
// signed CRTs and teacher attestations into a single auditable bundle,
// then signs the bundle with a teacher passkey so the printed report
// itself becomes a third-party-verifiable artefact.
//
// THE THREE LAYERS OF EVIDENCE THE PARENT GETS
// ────────────────────────────────────────────
//   (1) Student-signed CRTs           — proof of authorship by the learner
//   (2) Teacher-signed attestations   — proof of professional judgement
//   (3) Teacher-signed REPORT envelope — proof this exact bundle was the
//                                        one the teacher chose to print
//
// All three are pinned by digest. Tampering with any line of the printed
// report invalidates layer (3); tampering with a session record
// invalidates layer (1) or (2).
//
// WHY THIS LIVES IN A PURE MODULE
// ───────────────────────────────
// The aggregator takes its inputs as plain arguments (CRTs, attestations,
// learner) rather than reaching into localStorage itself. This lets tests
// drive every branch without mocking storage, and lets the eventual
// district-tier backend feed the same function from a Postgres query.
//
// PRIVACY POSTURE
// ───────────────
// • The report payload contains the learner's display name (parents
//   need to see it) but NEVER free-form student text — only digests,
//   problem IDs, durations, verdicts, and prefixes of signatures /
//   public keys for visual fingerprinting.
// • Reviewer notes from attestations are INCLUDED verbatim because they
//   are bounded to 280 chars and are the teacher's own words (and the
//   teacher is the publisher of this report).
// • The bus event `parent.report.signed` carries counts + digest prefix
//   only — never the learner's name.
// ─────────────────────────────────────────────────────────────────────────────

import {
  signPayloadWithAutoPasskey,
  verifyEnvelope,
  type SignedEnvelope,
} from "@/lib/crypto/signing";
import type { CRTEnvelope } from "@/lib/crt/bank";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";
import type { LearnerRecord } from "@/lib/roster/schema";

/** Stable schema version; bump on breaking shape changes. */
export const PARENT_REPORT_VERSION = 1 as const;

/** One row in the per-session table on the printed report. */
export interface ReportSessionSummary {
  /** SHA-256 digest of the signed CRT envelope payload. */
  crtContentDigestB64url: string;
  /** Stable problem identifier (e.g. "alg-quad-01"). */
  problemId: string;
  /** Logical session identifier (groups multiple CRT events). */
  sessionId: string;
  /** ISO timestamp the trace started. */
  startedAtIso: string;
  /** Session duration in ms (null if the trace did not finalize cleanly). */
  durationMs: number | null;
  /** Keystroke / edit event count. Bounded — not a transcript. */
  eventCount: number;
  /** Times the learner deleted previously-written text. */
  deletionCount: number;
  /** Times the learner pivoted reasoning direction. */
  pivotCount: number;
  /** Was this trace counter-signed by a teacher? */
  attested: boolean;
  /** First-16 chars of the CRT signature (visual fingerprint for parents). */
  signaturePrefix: string;
  /** "session" | "passkey" — key tier the learner used to sign. */
  keyType: string;
}

/** One row in the attestation receipts table. */
export interface ReportAttestationSummary {
  /** CRT digest this attestation pins to. */
  crtContentDigestB64url: string;
  /** Problem identifier (matches CRT). */
  problemId: string;
  /** ISO timestamp of the attestation moment. */
  attestedAtIso: string;
  /** Teacher's verdict. */
  verdict: string;
  /** Optional short note in the teacher's own words (≤280 chars). */
  reviewerNote?: string;
  /** Spec-point claims; verbatim from the attestation payload. */
  specPoints: Array<{ framework: string; code: string; label?: string }>;
  /** First-16 chars of the attestation signature. */
  signaturePrefix: string;
  /** First-16 chars of the teacher's public key. */
  publicKeyPrefix: string;
  /** "session" | "passkey" — teacher key tier (should always be passkey). */
  keyType: string;
}

/** Top-of-report tile counts. Computed in `buildParentReportPayload`. */
export interface ParentReportTotals {
  sessions: number;
  attestations: number;
  verdictCounts: Record<string, number>;
  /** Number of sessions that have at least one teacher attestation. */
  attestedSessions: number;
}

/** Subset of `LearnerRecord` actually printed on the report. We avoid
 *  re-printing the DOB or email — parents already know those, and
 *  excluding them keeps the printable artefact safer if a copy is mis-
 *  handled. */
export interface ReportLearnerDisplay {
  externalId: string;
  givenName: string;
  familyName: string;
  yearGroup: number;
  classGroup?: string;
}

/**
 * The plaintext payload that the teacher signs. The digest of this
 * payload (computed automatically by `signPayloadWithAutoPasskey`) is
 * the "report fingerprint" printed on the page.
 */
export interface ParentReportPayload {
  version: typeof PARENT_REPORT_VERSION;
  /** ISO timestamp of generation. */
  generatedAtIso: string;
  /** ISO start of the period covered (inclusive). */
  periodFromIso: string;
  /** ISO end of the period covered (inclusive). */
  periodToIso: string;
  /** Learner identity strictly as needed to address the report. */
  learner: ReportLearnerDisplay;
  /** Optional school identifier — useful for institutional VC issuers. */
  institutionId?: string;
  /** Per-session rows. */
  sessions: ReportSessionSummary[];
  /** Per-attestation rows. */
  attestations: ReportAttestationSummary[];
  /** Pre-computed tile totals. */
  totals: ParentReportTotals;
}

/** Convenience alias. */
export type ParentReportEnvelope = SignedEnvelope<ParentReportPayload>;

// ─── Aggregator ────────────────────────────────────────────────────────────

/**
 * Inputs to `buildParentReportPayload`. Caller is responsible for
 * supplying ONLY the records that belong to this learner — the
 * aggregator does not re-filter by externalId. (Callers that read from
 * the bank should use `selectLearnerArtefacts` below.)
 */
export interface BuildParentReportInput {
  learner: ReportLearnerDisplay;
  crts: CRTEnvelope[];
  attestations: TeacherAttestationEnvelope[];
  periodFromIso: string;
  periodToIso: string;
  generatedAtIso?: string;
  institutionId?: string;
}

/**
 * Filter the local CRT bank and attestation bank down to the records
 * that belong to a given learner external ID. Pure — caller passes the
 * bank arrays in, so tests can drive every code path without window /
 * localStorage.
 *
 * The CRT bank uses `payload.studentId` (which the student surface sets
 * to the roster externalId when a roster is in scope). The attestation
 * bank uses `payload.studentExternalId`. We accept both spellings to be
 * robust against the historical naming drift.
 */
export function selectLearnerArtefacts(args: {
  learnerExternalId: string;
  crts: CRTEnvelope[];
  attestations: TeacherAttestationEnvelope[];
}): { crts: CRTEnvelope[]; attestations: TeacherAttestationEnvelope[] } {
  const id = args.learnerExternalId;
  return {
    crts: args.crts.filter((e) => e.payload.studentId === id),
    attestations: args.attestations.filter(
      (e) => e.payload.studentExternalId === id,
    ),
  };
}

/** Build the plaintext payload that will be signed. Pure. */
export function buildParentReportPayload(
  input: BuildParentReportInput,
): ParentReportPayload {
  const from = Date.parse(input.periodFromIso);
  const to = Date.parse(input.periodToIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error("invalid_period");
  }
  if (from > to) {
    throw new Error("period_inverted");
  }

  // Index attestations by the CRT digest they pin to, so each session
  // can be flagged `attested`.
  const attestationsByCrt = new Map<string, TeacherAttestationEnvelope[]>();
  for (const a of input.attestations) {
    const k = a.payload.crtContentDigestB64url;
    const bucket = attestationsByCrt.get(k);
    if (bucket) bucket.push(a);
    else attestationsByCrt.set(k, [a]);
  }

  const sessions: ReportSessionSummary[] = [];
  for (const env of input.crts) {
    const p = env.payload;
    const startedMs = p.startTime;
    if (!Number.isFinite(startedMs)) continue;
    if (startedMs < from || startedMs > to) continue;
    sessions.push({
      crtContentDigestB64url: env.contentDigestB64url,
      problemId: p.problemId,
      sessionId: p.sessionId,
      startedAtIso: new Date(startedMs).toISOString(),
      durationMs:
        p.endTime != null && Number.isFinite(p.endTime)
          ? p.endTime - p.startTime
          : null,
      eventCount: Array.isArray(p.events) ? p.events.length : 0,
      deletionCount: p.deletionCount ?? 0,
      pivotCount: p.pivotCount ?? 0,
      attested: attestationsByCrt.has(env.contentDigestB64url),
      signaturePrefix: env.signatureB64url.slice(0, 16),
      keyType: env.keyType ?? "unknown",
    });
  }
  // Oldest first — reads more naturally as a chronological story.
  sessions.sort((a, b) => a.startedAtIso.localeCompare(b.startedAtIso));

  const attestations: ReportAttestationSummary[] = [];
  for (const env of input.attestations) {
    const a = env.payload;
    const atMs = Date.parse(a.attestedAtIso);
    if (!Number.isFinite(atMs)) continue;
    if (atMs < from || atMs > to) continue;
    const row: ReportAttestationSummary = {
      crtContentDigestB64url: a.crtContentDigestB64url,
      problemId: a.problemId,
      attestedAtIso: a.attestedAtIso,
      verdict: a.verdict,
      specPoints: a.specPoints.map((sp) => {
        const out: { framework: string; code: string; label?: string } = {
          framework: sp.framework,
          code: sp.code,
        };
        if (sp.label) out.label = sp.label;
        return out;
      }),
      signaturePrefix: env.signatureB64url.slice(0, 16),
      publicKeyPrefix: env.publicKeyB64url.slice(0, 16),
      keyType: env.keyType ?? "unknown",
    };
    if (a.reviewerNote) row.reviewerNote = a.reviewerNote;
    attestations.push(row);
  }
  attestations.sort((a, b) => a.attestedAtIso.localeCompare(b.attestedAtIso));

  // Verdict histogram.
  const verdictCounts: Record<string, number> = {};
  for (const a of attestations) {
    verdictCounts[a.verdict] = (verdictCounts[a.verdict] ?? 0) + 1;
  }
  const attestedDigests = new Set(
    attestations.map((a) => a.crtContentDigestB64url),
  );
  const attestedSessions = sessions.filter((s) =>
    attestedDigests.has(s.crtContentDigestB64url),
  ).length;

  return {
    version: PARENT_REPORT_VERSION,
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    periodFromIso: input.periodFromIso,
    periodToIso: input.periodToIso,
    learner: input.learner,
    ...(input.institutionId ? { institutionId: input.institutionId } : {}),
    sessions,
    attestations,
    totals: {
      sessions: sessions.length,
      attestations: attestations.length,
      verdictCounts,
      attestedSessions,
    },
  };
}

// ─── Signer / verifier ─────────────────────────────────────────────────────

/**
 * Sign a parent report payload with the teacher's passkey.
 *
 * Passkey is REQUIRED (no session-key fallback). A parent report signed
 * with a session-only key would be confusing evidence: parents need to
 * know a real teacher pressed a real authenticator to publish it. If no
 * passkey is enrolled, this throws `PasskeyRequiredError` (propagated
 * from `signPayloadWithAutoPasskey`).
 */
export async function signParentReport(
  payload: ParentReportPayload,
): Promise<ParentReportEnvelope> {
  return signPayloadWithAutoPasskey<ParentReportPayload>(payload, {
    requirePasskey: true,
  });
}

/** Verify a signed parent report envelope. Re-exported for symmetry. */
export async function verifyParentReportEnvelope(
  envelope: ParentReportEnvelope,
): Promise<boolean> {
  return verifyEnvelope(envelope);
}

/** Map a `LearnerRecord` to the printable subset. */
export function learnerDisplayFromRecord(
  rec: LearnerRecord,
): ReportLearnerDisplay {
  const out: ReportLearnerDisplay = {
    externalId: rec.externalId,
    givenName: rec.givenName,
    familyName: rec.familyName,
    yearGroup: rec.yearGroup,
  };
  if (rec.classGroup) out.classGroup = rec.classGroup;
  return out;
}

/** Build a privacy-safe bus payload summarising the signed report.
 *  Caller is expected to `publish("parent.report.signed", …)` with this. */
export function buildBusSummary(env: ParentReportEnvelope): {
  learnerExternalIdPrefix: string;
  periodFromIso: string;
  periodToIso: string;
  sessionCount: number;
  attestationCount: number;
  contentDigestB64url: string;
  signaturePrefix: string;
  publicKeyPrefix: string;
  keyType: string;
  algorithm: string;
} {
  const p = env.payload;
  return {
    learnerExternalIdPrefix: p.learner.externalId.slice(0, 8),
    periodFromIso: p.periodFromIso,
    periodToIso: p.periodToIso,
    sessionCount: p.totals.sessions,
    attestationCount: p.totals.attestations,
    contentDigestB64url: env.contentDigestB64url,
    signaturePrefix: env.signatureB64url.slice(0, 16),
    publicKeyPrefix: env.publicKeyB64url.slice(0, 16),
    keyType: env.keyType ?? "unknown",
    algorithm: env.algorithm,
  };
}
