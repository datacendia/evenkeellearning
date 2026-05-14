import { describe, it, expect, beforeEach } from "vitest";
import {
  createStatusRegistry,
  restoreStatusRegistry,
} from "@/lib/vc/status-registry";
import {
  STATUS_LIST_ENTRY_TYPE,
  STATUS_LIST_CREDENTIAL_TYPE,
  decodeBitstring,
  getBit,
  withStatusAtIndex,
} from "@/lib/vc/status-list";
import { issueVerifiableCredential } from "@/lib/vc/issuer";
import { verifyCredential } from "@/lib/vc/verifier";
import { signPayload } from "@/lib/crypto/signing";
import { subscribe, type BusEvent } from "@/lib/data-bus";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";

const URL_A = "https://issuer.example/sl/2026A";

const testSigner = (p: { canonical: string }) =>
  signPayload(p, { keySource: "session" });

function fakeAttestation(
  over: Partial<TeacherAttestationEnvelope["payload"]> = {},
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
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A18",
          label: "Solve quadratics",
          claimVocabularyVersion: 1,
        },
      ],
      ...over,
    },
    contentDigestB64url: "att-digest-xyz",
    signatureB64url: "att-sig",
    publicKeyB64url: "teacher-pk",
    signedAtIso: "2026-05-02T09:00:00Z",
    algorithm: "ECDSA-P256-SHA256",
    keyType: "passkey-derived",
  };
}

// ─── Registry mechanics ────────────────────────────────────────────────────

describe("createStatusRegistry — allocation", () => {
  it("hands out sequential indices starting at 0", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const a = reg.allocate("urn:cred:1");
    const b = reg.allocate("urn:cred:2");
    const c = reg.allocate("urn:cred:3");
    expect(a.statusListIndex).toBe("0");
    expect(b.statusListIndex).toBe("1");
    expect(c.statusListIndex).toBe("2");
    expect(a.type).toBe(STATUS_LIST_ENTRY_TYPE);
    expect(reg.allocatedCount()).toBe(3);
  });

  it("is idempotent — same id returns same index", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const a = reg.allocate("urn:cred:1");
    const b = reg.allocate("urn:cred:1");
    expect(a.statusListIndex).toBe(b.statusListIndex);
    expect(a.id).toBe(b.id);
    expect(reg.allocatedCount()).toBe(1);
  });

  it("throws when capacity is exhausted", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 8,
    });
    for (let i = 0; i < 8; i++) reg.allocate(`urn:cred:${i}`);
    expect(() => reg.allocate("urn:cred:overflow")).toThrow("status_list_full");
  });

  it("indexOf returns null for unknown ids", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    expect(reg.indexOf("urn:nope")).toBe(null);
    reg.allocate("urn:cred:1");
    expect(reg.indexOf("urn:cred:1")).toBe(0);
  });
});

describe("createStatusRegistry — revoke / unrevoke", () => {
  it("revoking flips the bit at the allocated index", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.allocate("urn:cred:B");
    expect(reg.isRevoked("urn:cred:A")).toBe(false);
    reg.revoke("urn:cred:A");
    expect(reg.isRevoked("urn:cred:A")).toBe(true);
    expect(reg.isRevoked("urn:cred:B")).toBe(false);

    // Bit 0 set, bit 1 clear → first byte = 0x80.
    const enc = await reg.encodedList();
    const bits = await decodeBitstring(enc);
    expect(getBit(bits, 0)).toBe(1);
    expect(getBit(bits, 1)).toBe(0);
  });

  it("revoke is idempotent", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.revoke("urn:cred:A");
    reg.revoke("urn:cred:A");
    reg.revoke("urn:cred:A");
    expect(reg.isRevoked("urn:cred:A")).toBe(true);
  });

  it("unrevoke flips the bit back", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.revoke("urn:cred:A");
    expect(reg.isRevoked("urn:cred:A")).toBe(true);
    reg.unrevoke("urn:cred:A");
    expect(reg.isRevoked("urn:cred:A")).toBe(false);
  });

  it("revoke / unrevoke / isRevoked throw on unknown ids", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    expect(() => reg.isRevoked("urn:nope")).toThrow();
    expect(() => reg.revoke("urn:nope")).toThrow();
    expect(() => reg.unrevoke("urn:nope")).toThrow();
  });
});

// ─── Bus events (PII-free by construction) ─────────────────────────────────

describe("createStatusRegistry — bus events", () => {
  let received: BusEvent[];
  let unsub: () => void;

  beforeEach(() => {
    received = [];
    unsub = subscribe((e) => {
      if (
        e.type === "vc.credential.revoked" ||
        e.type === "vc.credential.unrevoked" ||
        e.type === "vc.statuslist.republished"
      ) {
        received.push(e);
      }
    });
  });

  it("publishes vc.credential.revoked once per real flip", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.revoke("urn:cred:A", { reasonCode: "academic_misconduct" });
    reg.revoke("urn:cred:A"); // idempotent — should NOT publish again.
    unsub();
    const revokeEvents = received.filter((e) => e.type === "vc.credential.revoked");
    expect(revokeEvents).toHaveLength(1);
    const p = revokeEvents[0]!.payload as Record<string, unknown>;
    expect(p.statusListCredential).toBe(URL_A);
    expect(p.statusListIndex).toBe(0);
    expect(p.credentialId).toBe("urn:cred:A");
    expect(p.reasonCode).toBe("academic_misconduct");
    // PII guard — payload must not carry student/teacher identifiers.
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/email|dob|firstName|lastName|teacher.passkey/i);
  });

  it("publishes vc.credential.unrevoked on real un-revoke", () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.revoke("urn:cred:A");
    reg.unrevoke("urn:cred:A");
    reg.unrevoke("urn:cred:A"); // idempotent
    unsub();
    const ev = received.filter((e) => e.type === "vc.credential.unrevoked");
    expect(ev).toHaveLength(1);
  });

  it("publishes vc.statuslist.republished with PII-free counts", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.allocate("urn:cred:B");
    reg.revoke("urn:cred:A");
    await reg.buildUnsignedListCredential({ nowIso: "2026-05-11T10:00:00Z" });
    unsub();
    const ev = received.filter((e) => e.type === "vc.statuslist.republished");
    expect(ev).toHaveLength(1);
    const p = ev[0]!.payload as Record<string, unknown>;
    expect(p.totalBits).toBe(64);
    expect(p.setBitCount).toBe(1);
    expect(p.statusListCredential).toBe(URL_A);
    expect(p.validFromIso).toBe("2026-05-11T10:00:00Z");
  });
});

// ─── Snapshot / restore ────────────────────────────────────────────────────

describe("snapshot / restoreStatusRegistry", () => {
  it("round-trips a registry through serialization", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.allocate("urn:cred:B");
    reg.allocate("urn:cred:C");
    reg.revoke("urn:cred:B");

    const snap = await reg.snapshot();
    expect(snap.assignments).toEqual({
      "urn:cred:A": 0,
      "urn:cred:B": 1,
      "urn:cred:C": 2,
    });
    expect(snap.nextIndex).toBe(3);
    expect(snap.totalBits).toBe(64);

    const restored = await restoreStatusRegistry(snap);
    expect(restored.indexOf("urn:cred:A")).toBe(0);
    expect(restored.indexOf("urn:cred:B")).toBe(1);
    expect(restored.indexOf("urn:cred:C")).toBe(2);
    expect(restored.isRevoked("urn:cred:A")).toBe(false);
    expect(restored.isRevoked("urn:cred:B")).toBe(true);
    expect(restored.isRevoked("urn:cred:C")).toBe(false);
    expect(restored.allocatedCount()).toBe(3);
  });

  it("rejects a snapshot with mismatched encodedList length", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const snap = await reg.snapshot();
    const bad = { ...snap, totalBits: 128 };
    await expect(restoreStatusRegistry(bad)).rejects.toThrow();
  });

  it("rejects a snapshot with out-of-range nextIndex", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const snap = await reg.snapshot();
    const bad = { ...snap, nextIndex: 65 };
    await expect(restoreStatusRegistry(bad)).rejects.toThrow();
  });

  it("rejects a snapshot with totalBits not a multiple of 8", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const snap = await reg.snapshot();
    const bad = { ...snap, totalBits: 9 };
    await expect(restoreStatusRegistry(bad)).rejects.toThrow();
  });
});

// ─── Unsigned status-list credential body ──────────────────────────────────

describe("buildUnsignedListCredential", () => {
  it("builds a StatusList2021Credential body with the current encoded list", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:A");
    reg.revoke("urn:cred:A");
    const cred = await reg.buildUnsignedListCredential({
      nowIso: "2026-05-11T10:00:00Z",
    });
    expect(cred.type).toEqual(["VerifiableCredential", STATUS_LIST_CREDENTIAL_TYPE]);
    expect(cred.id).toBe(URL_A);
    expect(cred.issuer).toBe("did:web:issuer.example");
    expect(cred.validFrom).toBe("2026-05-11T10:00:00Z");
    expect(cred.credentialSubject.statusPurpose).toBe("revocation");
    // Decode the embedded list and confirm bit 0 is set.
    const bits = await decodeBitstring(cred.credentialSubject.encodedList);
    expect(getBit(bits, 0)).toBe(1);
  });
});

// ─── End-to-end: issue with credentialStatus, revoke, verify ───────────────

describe("end-to-end revoke flow (issuer + verifier + registry)", () => {
  it("issues a VC with credentialStatus, verifies clean, revokes, then verifies as revoked", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const credentialId = "urn:evenkeel:vc:test-001";
    const status = reg.allocate(credentialId);

    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });

    expect(vc.credentialStatus).toEqual(status);

    // Resolver fetches the live encodedList from the registry.
    const resolver = async (url: string) => {
      expect(url).toBe(URL_A);
      return reg.encodedList();
    };

    // Clean verify.
    const ok = await verifyCredential(vc, { statusListResolver: resolver });
    expect(ok.ok).toBe(true);

    // Revoke and re-verify.
    reg.revoke(credentialId, { reasonCode: "academic_misconduct" });
    const revoked = await verifyCredential(vc, { statusListResolver: resolver });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.reason).toBe("credential_revoked");

    // Un-revoke and verify clean again — same VC, no re-issue.
    reg.unrevoke(credentialId);
    const reok = await verifyCredential(vc, { statusListResolver: resolver });
    expect(reok.ok).toBe(true);
  });

  it("verify still passes when no resolver is supplied (caller opted out)", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const credentialId = "urn:evenkeel:vc:test-002";
    const status = reg.allocate(credentialId);
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });
    reg.revoke(credentialId);
    const r = await verifyCredential(vc); // no resolver
    expect(r.ok).toBe(true);
  });

  it("rejects when an attacker swaps the status list URL to one not in the allowlist", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const credentialId = "urn:evenkeel:vc:test-003";
    const status = reg.allocate(credentialId);
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });

    // Tamper attempt: rewrite the credentialStatus URL to point at a
    // friendly attacker-controlled list with the bit clear. The proof
    // signature would catch this for the canonical form, but if a
    // verifier is configured WITHOUT signature verification (or the
    // attacker has a colliding signature), the allowlist still saves us.
    // We test the allowlist behaviour directly by passing a mismatch:
    const r = await verifyCredential(vc, {
      statusListResolver: async () => reg.encodedList(),
      allowedStatusListUrls: ["https://other-list.example/sl/0"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_status_list_url");
  });

  it("rejects when the resolver throws", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const credentialId = "urn:evenkeel:vc:test-004";
    const status = reg.allocate(credentialId);
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });
    const r = await verifyCredential(vc, {
      statusListResolver: async () => {
        throw new Error("network down");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("status_resolver_failed");
  });

  it("rejects when the resolver returns gibberish", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const credentialId = "urn:evenkeel:vc:test-005";
    const status = reg.allocate(credentialId);
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });
    const r = await verifyCredential(vc, {
      statusListResolver: async () => "!!!not_a_valid_encoded_list!!!",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("status_resolver_failed");
  });

  it("rejects when statusListIndex is past the bitstring end", async () => {
    // Hand-craft a VC pointing past the registry's capacity. We can't
    // actually allocate past capacity, so we forge a credentialStatus.
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    reg.allocate("urn:cred:other"); // populate
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: "urn:vc:forged",
      signer: testSigner,
      credentialStatus: {
        id: `${URL_A}#9999`,
        type: STATUS_LIST_ENTRY_TYPE,
        statusPurpose: "revocation",
        statusListIndex: "9999",
        statusListCredential: URL_A,
      },
    });
    const r = await verifyCredential(vc, {
      statusListResolver: async () => reg.encodedList(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("status_index_out_of_range");
  });

  it("a credentialStatus tamper post-issuance breaks signature verification", async () => {
    // The status block is part of the canonical bytes, so flipping the
    // index after signing should fail signature verification — proving
    // the status pointer is bound to the credential.
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const credentialId = "urn:evenkeel:vc:test-007";
    const status = reg.allocate(credentialId);
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });
    // Forge: point the status entry at a different (clear) bit.
    const tampered = {
      ...vc,
      credentialStatus: { ...vc.credentialStatus!, statusListIndex: "5", id: `${URL_A}#5` },
    };
    const r = await verifyCredential(tampered, {
      statusListResolver: async () => reg.encodedList(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("suspension purpose surfaces as credential_suspended, not credential_revoked", async () => {
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
      statusPurpose: "suspension",
    });
    const credentialId = "urn:evenkeel:vc:test-008";
    const status = reg.allocate(credentialId);
    expect(status.statusPurpose).toBe("suspension");
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: credentialId,
      signer: testSigner,
      credentialStatus: status,
    });
    reg.revoke(credentialId);
    const r = await verifyCredential(vc, {
      statusListResolver: async () => reg.encodedList(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credential_suspended");
  });
});

// ─── Direct withStatusAtIndex sanity (independent of registry) ─────────────

describe("withStatusAtIndex (sanity)", () => {
  it("flipping a bit and reading via verifyCredential agrees", async () => {
    // This proves the registry's encodedList and a handcrafted bit-flip
    // produce the same observable behaviour for the verifier.
    const reg = createStatusRegistry({
      statusListCredentialUrl: URL_A,
      issuerDid: "did:web:issuer.example",
      totalBits: 64,
    });
    const status = reg.allocate("urn:vc:hand-1");
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:issuer.example",
      id: "urn:vc:hand-1",
      signer: testSigner,
      credentialStatus: status,
    });
    const originalEncoded = await reg.encodedList();
    const tampered = await withStatusAtIndex(originalEncoded, 0, 1);
    const r = await verifyCredential(vc, {
      statusListResolver: async () => tampered,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credential_revoked");
  });
});
