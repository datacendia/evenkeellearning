import { describe, it, expect } from "vitest";
import {
  buildParentReportPayload,
  selectLearnerArtefacts,
  buildBusSummary,
  learnerDisplayFromRecord,
  PARENT_REPORT_VERSION,
  type ReportLearnerDisplay,
  type ParentReportEnvelope,
} from "@/lib/parent/report";
import type { CRTEnvelope } from "@/lib/crt/bank";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";
import type { LearnerRecord } from "@/lib/roster/schema";
import type { CognitiveReasoningTrace } from "@/lib/types";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const LEARNER: ReportLearnerDisplay = {
  externalId: "alex-01",
  givenName: "Alex",
  familyName: "Doe",
  yearGroup: 10,
  classGroup: "10A",
};

function trace(over: Partial<CognitiveReasoningTrace> = {}): CognitiveReasoningTrace {
  return {
    studentId: "alex-01",
    sessionId: "sess-1",
    problemId: "alg-quad-01",
    events: [],
    startTime: Date.parse("2026-05-01T10:00:00Z"),
    endTime: Date.parse("2026-05-01T10:15:00Z"),
    totalThinkTime: 0,
    deletionCount: 2,
    pivotCount: 1,
    proofOfWorkHash: "pow",
    ...over,
  };
}

function crt(over: {
  trace?: Partial<CognitiveReasoningTrace>;
  contentDigest?: string;
  signature?: string;
  pubkey?: string;
  keyType?: "session-demo" | "passkey-derived";
} = {}): CRTEnvelope {
  return {
    payload: trace(over.trace),
    contentDigestB64url: over.contentDigest ?? "digest-aaaaaaaaaaaaaaaa",
    signatureB64url: over.signature ?? "sig-bbbbbbbbbbbbbbbbcccc",
    publicKeyB64url: over.pubkey ?? "pk-ddddddddddddddddeeee",
    signedAtIso: "2026-05-01T10:15:00Z",
    algorithm: "ECDSA-P256-SHA256",
    keyType: over.keyType ?? "session-demo",
  };
}

function attestation(over: {
  crtDigest?: string;
  studentExternalId?: string;
  problemId?: string;
  attestedAtIso?: string;
  verdict?: "verified-mastery" | "verified-with-support" | "needs-revisit" | "anomaly-rejected";
  reviewerNote?: string;
  specPoints?: Array<{ framework: string; code: string; label?: string }>;
} = {}): TeacherAttestationEnvelope {
  const sp = over.specPoints ?? [{ framework: "AQA-GCSE-9-1-Maths", code: "A18" }];
  return {
    payload: {
      version: 1,
      crtContentDigestB64url: over.crtDigest ?? "digest-aaaaaaaaaaaaaaaa",
      studentExternalId: over.studentExternalId ?? "alex-01",
      problemId: over.problemId ?? "alg-quad-01",
      attestedAtIso: over.attestedAtIso ?? "2026-05-02T09:00:00Z",
      verdict: over.verdict ?? "verified-mastery",
      ...(over.reviewerNote ? { reviewerNote: over.reviewerNote } : {}),
      specPoints: sp.map((p) => ({ ...p, claimVocabularyVersion: 1 as const })),
    },
    contentDigestB64url: "att-digest-xxxxxxxxxxxx",
    signatureB64url: "att-sig-yyyyyyyyyyyyyyyy",
    publicKeyB64url: "teacher-pk-zzzzzzzzzzzz",
    signedAtIso: "2026-05-02T09:00:00Z",
    algorithm: "ECDSA-P256-SHA256",
    keyType: "passkey-derived",
  };
}

// ─── selectLearnerArtefacts ────────────────────────────────────────────────

describe("selectLearnerArtefacts", () => {
  it("filters CRTs and attestations by learner external id", () => {
    const result = selectLearnerArtefacts({
      learnerExternalId: "alex-01",
      crts: [
        crt({ trace: { studentId: "alex-01" } }),
        crt({ trace: { studentId: "other-99" } }),
      ],
      attestations: [
        attestation({ studentExternalId: "alex-01" }),
        attestation({ studentExternalId: "other-99" }),
      ],
    });
    expect(result.crts).toHaveLength(1);
    expect(result.attestations).toHaveLength(1);
    expect(result.crts[0].payload.studentId).toBe("alex-01");
    expect(result.attestations[0].payload.studentExternalId).toBe("alex-01");
  });

  it("returns empty when no records match", () => {
    const result = selectLearnerArtefacts({
      learnerExternalId: "nobody",
      crts: [crt()],
      attestations: [attestation()],
    });
    expect(result.crts).toHaveLength(0);
    expect(result.attestations).toHaveLength(0);
  });
});

// ─── buildParentReportPayload ──────────────────────────────────────────────

describe("buildParentReportPayload", () => {
  const period = {
    periodFromIso: "2026-05-01T00:00:00Z",
    periodToIso: "2026-05-31T23:59:59Z",
    generatedAtIso: "2026-06-01T08:00:00Z",
  };

  it("builds a complete payload with totals", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [crt()],
      attestations: [attestation()],
      ...period,
    });
    expect(payload.version).toBe(PARENT_REPORT_VERSION);
    expect(payload.learner).toEqual(LEARNER);
    expect(payload.sessions).toHaveLength(1);
    expect(payload.attestations).toHaveLength(1);
    expect(payload.totals.sessions).toBe(1);
    expect(payload.totals.attestations).toBe(1);
    expect(payload.totals.verdictCounts).toEqual({ "verified-mastery": 1 });
    expect(payload.totals.attestedSessions).toBe(1);
    expect(payload.sessions[0].attested).toBe(true);
  });

  it("flags un-attested sessions correctly", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [crt({ contentDigest: "digest-unique-yyyyyy" })],
      attestations: [],
      ...period,
    });
    expect(payload.sessions[0].attested).toBe(false);
    expect(payload.totals.attestedSessions).toBe(0);
  });

  it("excludes CRTs outside the period", () => {
    const outside = crt({
      trace: { startTime: Date.parse("2026-04-01T10:00:00Z") },
      contentDigest: "old-digest",
    });
    const inside = crt({ contentDigest: "new-digest" });
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [outside, inside],
      attestations: [],
      ...period,
    });
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0].crtContentDigestB64url).toBe("new-digest");
  });

  it("excludes attestations outside the period", () => {
    const old = attestation({ attestedAtIso: "2026-04-15T09:00:00Z" });
    const recent = attestation();
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [old, recent],
      ...period,
    });
    expect(payload.attestations).toHaveLength(1);
    expect(payload.attestations[0].attestedAtIso).toBe("2026-05-02T09:00:00Z");
  });

  it("sorts sessions and attestations chronologically (oldest first)", () => {
    const c1 = crt({
      trace: { startTime: Date.parse("2026-05-15T10:00:00Z") },
      contentDigest: "digest-mid",
    });
    const c2 = crt({
      trace: { startTime: Date.parse("2026-05-03T10:00:00Z") },
      contentDigest: "digest-early",
    });
    const c3 = crt({
      trace: { startTime: Date.parse("2026-05-20T10:00:00Z") },
      contentDigest: "digest-late",
    });
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [c1, c2, c3],
      attestations: [],
      ...period,
    });
    expect(payload.sessions.map((s) => s.crtContentDigestB64url)).toEqual([
      "digest-early",
      "digest-mid",
      "digest-late",
    ]);
  });

  it("aggregates a verdict histogram", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [
        attestation({ verdict: "verified-mastery", crtDigest: "d1" }),
        attestation({ verdict: "verified-mastery", crtDigest: "d2" }),
        attestation({ verdict: "needs-revisit", crtDigest: "d3" }),
      ],
      ...period,
    });
    expect(payload.totals.verdictCounts).toEqual({
      "verified-mastery": 2,
      "needs-revisit": 1,
    });
  });

  it("preserves reviewer note verbatim", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [attestation({ reviewerNote: "Excellent reasoning chain." })],
      ...period,
    });
    expect(payload.attestations[0].reviewerNote).toBe("Excellent reasoning chain.");
  });

  it("omits reviewerNote when absent", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [attestation()],
      ...period,
    });
    expect(payload.attestations[0].reviewerNote).toBeUndefined();
  });

  it("includes session signature prefix for visual fingerprinting", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [crt({ signature: "abcdefghijklmnopqrstuvwxyz" })],
      attestations: [],
      ...period,
    });
    expect(payload.sessions[0].signaturePrefix).toBe("abcdefghijklmnop");
    expect(payload.sessions[0].signaturePrefix).toHaveLength(16);
  });

  it("throws on invalid period iso", () => {
    expect(() =>
      buildParentReportPayload({
        learner: LEARNER,
        crts: [],
        attestations: [],
        periodFromIso: "not-a-date",
        periodToIso: "2026-05-31T23:59:59Z",
      }),
    ).toThrow(/invalid_period/);
  });

  it("throws when period is inverted (from > to)", () => {
    expect(() =>
      buildParentReportPayload({
        learner: LEARNER,
        crts: [],
        attestations: [],
        periodFromIso: "2026-06-01T00:00:00Z",
        periodToIso: "2026-05-01T00:00:00Z",
      }),
    ).toThrow(/period_inverted/);
  });

  it("handles a learner with no CRTs and no attestations", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [],
      ...period,
    });
    expect(payload.sessions).toEqual([]);
    expect(payload.attestations).toEqual([]);
    expect(payload.totals).toEqual({
      sessions: 0,
      attestations: 0,
      verdictCounts: {},
      attestedSessions: 0,
    });
  });

  it("propagates institutionId when supplied", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [],
      institutionId: "URN:12345",
      ...period,
    });
    expect(payload.institutionId).toBe("URN:12345");
  });

  it("omits institutionId when not supplied", () => {
    const payload = buildParentReportPayload({
      learner: LEARNER,
      crts: [],
      attestations: [],
      ...period,
    });
    expect(payload.institutionId).toBeUndefined();
  });
});

// ─── learnerDisplayFromRecord ──────────────────────────────────────────────

describe("learnerDisplayFromRecord", () => {
  const rec: LearnerRecord = {
    externalId: "alex-01",
    givenName: "Alex",
    familyName: "Doe",
    yearGroup: 10,
    jurisdiction: "UK-EN",
    consentStatus: "parental_consent_on_file",
    dateOfBirth: "2010-04-01",
    email: "alex@school.test",
    classGroup: "10A",
  };

  it("strips DOB and email for printable safety", () => {
    const out = learnerDisplayFromRecord(rec);
    expect(out).toEqual({
      externalId: "alex-01",
      givenName: "Alex",
      familyName: "Doe",
      yearGroup: 10,
      classGroup: "10A",
    });
    expect(out).not.toHaveProperty("dateOfBirth");
    expect(out).not.toHaveProperty("email");
  });

  it("omits classGroup when absent on the record", () => {
    const { classGroup: _unused, ...withoutClass } = rec;
    void _unused;
    const out = learnerDisplayFromRecord(withoutClass as LearnerRecord);
    expect(out).not.toHaveProperty("classGroup");
  });
});

// ─── buildBusSummary ───────────────────────────────────────────────────────

describe("buildBusSummary", () => {
  it("emits PII-free summary fields only", () => {
    const env: ParentReportEnvelope = {
      payload: {
        version: 1,
        generatedAtIso: "2026-06-01T08:00:00Z",
        periodFromIso: "2026-05-01T00:00:00Z",
        periodToIso: "2026-05-31T23:59:59Z",
        learner: LEARNER,
        sessions: [],
        attestations: [],
        totals: { sessions: 3, attestations: 2, verdictCounts: {}, attestedSessions: 2 },
      },
      contentDigestB64url: "report-digest-abc",
      signatureB64url: "report-sig-1234567890abcdef",
      publicKeyB64url: "teacher-pk-fedcba0987654321",
      signedAtIso: "2026-06-01T08:00:01Z",
      algorithm: "ECDSA-P256-SHA256",
      keyType: "passkey-derived",
    };
    const sum = buildBusSummary(env);
    expect(sum).toEqual({
      learnerExternalIdPrefix: "alex-01",
      periodFromIso: "2026-05-01T00:00:00Z",
      periodToIso: "2026-05-31T23:59:59Z",
      sessionCount: 3,
      attestationCount: 2,
      contentDigestB64url: "report-digest-abc",
      signaturePrefix: "report-sig-12345",
      publicKeyPrefix: "teacher-pk-fedcb",
      keyType: "passkey-derived",
      algorithm: "ECDSA-P256-SHA256",
    });
    // PII guard: the learner's family name must not appear anywhere in
    // the summary.
    const json = JSON.stringify(sum);
    expect(json).not.toContain("Doe");
    expect(json).not.toContain("Alex");
  });
});
