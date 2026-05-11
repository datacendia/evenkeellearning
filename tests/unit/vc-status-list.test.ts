import { describe, it, expect } from "vitest";
import {
  newBitstring,
  setBit,
  getBit,
  encodeBitstring,
  decodeBitstring,
  createRegistry,
  allocateIndex,
  buildCredentialStatusEntry,
  revokeCredential,
  isRevokedById,
  isRevokedByIndex,
  buildStatusListCredential,
  issueStatusListCredential,
  registryToJson,
  registryFromJson,
  STATUS_LIST_BIT_LENGTH,
  STATUS_LIST_ENCODING_VERSION,
  STATUS_LIST_ENTRY_TYPE,
  STATUS_LIST_SUBJECT_TYPE,
  STATUS_PURPOSE_REVOCATION,
  type StatusListCredential,
} from "@/lib/vc/status-list";
import { issueVerifiableCredential } from "@/lib/vc/issuer";
import { verifyCredential } from "@/lib/vc/verifier";
import { signPayload } from "@/lib/crypto/signing";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";

const testSigner = (p: { canonical: string }) =>
  signPayload(p, { keySource: "session" });

function fakeAttestation(
  over: Partial<TeacherAttestationEnvelope["payload"]> = {},
  digestSuffix = "xyz",
): TeacherAttestationEnvelope {
  return {
    payload: {
      version: 1,
      crtContentDigestB64url: "crt-digest-abc",
      studentExternalId: "alex-01",
      problemId: "alg-quad-01",
      attestedAtIso: "2026-05-02T09:00:00Z",
      verdict: "verified-mastery",
      specPoints: [
        { framework: "AQA", code: "A18", claimVocabularyVersion: 1 },
      ],
      ...over,
    },
    contentDigestB64url: `att-digest-${digestSuffix}`,
    signatureB64url: "sig",
    publicKeyB64url: "pk",
    signedAtIso: "2026-05-02T09:00:00Z",
    algorithm: "ECDSA-P256-SHA256",
    keyType: "passkey-derived",
  };
}

// ─── Bitstring primitives ──────────────────────────────────────────────────

describe("bitstring primitives", () => {
  it("allocates a zeroed bitstring", () => {
    const bits = newBitstring(64);
    expect(bits).toHaveLength(8);
    for (let i = 0; i < 64; i++) expect(getBit(bits, i)).toBe(0);
  });

  it("rejects non-multiple-of-8 lengths", () => {
    expect(() => newBitstring(7)).toThrow();
    expect(() => newBitstring(0)).toThrow();
  });

  it("sets and reads bits", () => {
    const bits = newBitstring(16);
    setBit(bits, 0, 1);
    setBit(bits, 7, 1);
    setBit(bits, 15, 1);
    expect(getBit(bits, 0)).toBe(1);
    expect(getBit(bits, 1)).toBe(0);
    expect(getBit(bits, 7)).toBe(1);
    expect(getBit(bits, 15)).toBe(1);
  });

  it("clears a set bit via setBit(idx, 0)", () => {
    const bits = newBitstring(16);
    setBit(bits, 3, 1);
    setBit(bits, 3, 0);
    expect(getBit(bits, 3)).toBe(0);
  });

  it("throws on out-of-range bit indices", () => {
    const bits = newBitstring(16);
    expect(() => setBit(bits, 16, 1)).toThrow();
    expect(() => getBit(bits, -1)).toThrow();
  });

  it("round-trips through base64url", () => {
    const bits = newBitstring(128);
    setBit(bits, 42, 1);
    setBit(bits, 100, 1);
    const encoded = encodeBitstring(bits);
    const decoded = decodeBitstring(encoded);
    expect(decoded).toEqual(bits);
    expect(getBit(decoded, 42)).toBe(1);
    expect(getBit(decoded, 100)).toBe(1);
  });

  it("uses base64url alphabet (no +, /, =)", () => {
    const bits = newBitstring(64);
    for (let i = 0; i < 64; i++) setBit(bits, i, 1);
    const encoded = encodeBitstring(bits);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

// ─── Registry ──────────────────────────────────────────────────────────────

describe("registry", () => {
  it("allocates sequential indices per credential id", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x", 64);
    expect(allocateIndex(reg, "vc:1")).toBe(0);
    expect(allocateIndex(reg, "vc:2")).toBe(1);
    expect(allocateIndex(reg, "vc:3")).toBe(2);
  });

  it("is idempotent — same id returns the same index", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x", 64);
    const idx1 = allocateIndex(reg, "vc:1");
    const idx2 = allocateIndex(reg, "vc:1");
    expect(idx1).toBe(idx2);
    expect(reg.nextIndex).toBe(1);
  });

  it("throws when the bitstring is exhausted", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x", 8);
    for (let i = 0; i < 8; i++) allocateIndex(reg, `vc:${i}`);
    expect(() => allocateIndex(reg, "vc:overflow")).toThrow(/exhausted/);
  });

  it("builds a spec-shaped credentialStatus entry", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    const entry = buildCredentialStatusEntry(reg, "vc:alex");
    expect(entry.type).toBe(STATUS_LIST_ENTRY_TYPE);
    expect(entry.statusPurpose).toBe(STATUS_PURPOSE_REVOCATION);
    expect(entry.statusListIndex).toBe("0");
    expect(entry.statusListCredential).toBe("https://issuer.test/status/1");
    expect(entry.id).toBe("https://issuer.test/status/1#0");
  });

  it("revokes by credential id and reports status", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    buildCredentialStatusEntry(reg, "vc:alex");
    expect(isRevokedById(reg, "vc:alex")).toBe(false);
    revokeCredential(reg, "vc:alex");
    expect(isRevokedById(reg, "vc:alex")).toBe(true);
  });

  it("throws when revoking an unknown credential", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    expect(() => revokeCredential(reg, "vc:unknown")).toThrow(
      /not_in_registry/,
    );
  });

  it("returns false for isRevokedById of unknown credential", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    expect(isRevokedById(reg, "vc:unknown")).toBe(false);
  });
});

// ─── Status-list credential build ──────────────────────────────────────────

describe("buildStatusListCredential", () => {
  it("produces a W3C-shaped VC with encoded bitstring", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    buildCredentialStatusEntry(reg, "vc:alex");
    revokeCredential(reg, "vc:alex");
    const sl = buildStatusListCredential(reg, "2026-05-11T00:00:00Z");
    expect(sl.id).toBe("https://issuer.test/status/1");
    expect(sl.type).toContain("VerifiableCredential");
    expect(sl.type).toContain("StatusList2021Credential");
    expect(sl.issuer).toBe("did:web:x");
    expect(sl.credentialSubject.type).toBe(STATUS_LIST_SUBJECT_TYPE);
    expect(sl.credentialSubject.encodingVersion).toBe(
      STATUS_LIST_ENCODING_VERSION,
    );
    expect(sl.credentialSubject.bitLength).toBe(STATUS_LIST_BIT_LENGTH);
    // The decoded list must reflect the revocation.
    const decoded = decodeBitstring(sl.credentialSubject.encodedList);
    expect(isRevokedByIndex(decoded, 0)).toBe(true);
  });
});

describe("issueStatusListCredential round-trip", () => {
  it("signs and embeds a proof block", async () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    const sl = await issueStatusListCredential({
      registry: reg,
      validFromIso: "2026-05-11T00:00:00Z",
      signer: testSigner,
    });
    expect(sl.proof.type).toBe("DataIntegrityProof");
    expect(sl.proof.proofValue.length).toBeGreaterThan(0);
    expect(sl.proof.verificationMethod).toBe("did:web:x#key-1");
  });
});

// ─── Persistence ───────────────────────────────────────────────────────────

describe("registry persistence", () => {
  it("round-trips through JSON", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x", 64);
    buildCredentialStatusEntry(reg, "vc:alex");
    buildCredentialStatusEntry(reg, "vc:sam");
    revokeCredential(reg, "vc:alex");

    const json = registryToJson(reg);
    const rehydrated = registryFromJson(json);

    expect(rehydrated.statusListUrl).toBe(reg.statusListUrl);
    expect(rehydrated.issuerDid).toBe(reg.issuerDid);
    expect(rehydrated.nextIndex).toBe(2);
    expect(isRevokedById(rehydrated, "vc:alex")).toBe(true);
    expect(isRevokedById(rehydrated, "vc:sam")).toBe(false);
  });

  it("rejects a payload with bitLength mismatch", () => {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x", 64);
    const json = registryToJson(reg);
    expect(() =>
      registryFromJson({ ...json, bitLength: 128 }),
    ).toThrow(/mismatch/);
  });
});

// ─── End-to-end verifier wiring ────────────────────────────────────────────

describe("verifyCredential with revocation", () => {
  async function makeIssuedAndList() {
    const reg = createRegistry("https://issuer.test/status/1", "did:web:x");
    const att = fakeAttestation({}, "rev1");
    const credStatus = buildCredentialStatusEntry(
      reg,
      `urn:evenkeel:vc:${att.contentDigestB64url}`,
    );
    const vc = await issueVerifiableCredential({
      attestation: att,
      issuerDid: "did:web:x",
      signer: testSigner,
      credentialStatus: credStatus,
    });
    const list = await issueStatusListCredential({
      registry: reg,
      validFromIso: "2026-05-11T00:00:00Z",
      signer: testSigner,
    });
    const resolver = async (
      url: string,
    ): Promise<StatusListCredential | null> =>
      url === reg.statusListUrl ? list : null;
    return { reg, vc, list, resolver };
  }

  it("accepts a non-revoked VC", async () => {
    const { vc, resolver } = await makeIssuedAndList();
    const r = await verifyCredential(vc, { resolveStatusList: resolver });
    expect(r.ok).toBe(true);
  });

  it("rejects a revoked VC", async () => {
    const { reg, vc, resolver } = await makeIssuedAndList();
    // Re-issue the status list AFTER revoking.
    revokeCredential(reg, vc.id);
    const updatedList = await issueStatusListCredential({
      registry: reg,
      validFromIso: "2026-05-11T01:00:00Z",
      signer: testSigner,
    });
    const resolver2 = async () => updatedList;
    void resolver; // silence unused
    const r = await verifyCredential(vc, { resolveStatusList: resolver2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked");
  });

  it("passes when the resolver returns null (offline)", async () => {
    const { vc } = await makeIssuedAndList();
    const r = await verifyCredential(vc, {
      resolveStatusList: async () => null,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when the resolver returns a list with a mismatching id", async () => {
    const { vc, list } = await makeIssuedAndList();
    const wrongList: StatusListCredential = {
      ...list,
      id: "https://attacker.test/other-list",
    };
    const r = await verifyCredential(vc, {
      resolveStatusList: async () => wrongList,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("status_list_mismatch");
  });

  it("skips revocation check when no resolver is provided", async () => {
    const { vc } = await makeIssuedAndList();
    const r = await verifyCredential(vc);
    expect(r.ok).toBe(true);
  });

  it("backwards-compatible: legacy numeric second arg still works", async () => {
    const { vc } = await makeIssuedAndList();
    const r = await verifyCredential(vc, 1);
    expect(r.ok).toBe(true);
  });
});
