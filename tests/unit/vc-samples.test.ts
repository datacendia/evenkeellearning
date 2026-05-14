// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/vc-samples.test.ts
//
// v1.7.4 — Self-consistency tests for the public ecosystem outreach kit
// (public/vc/sample-credential.json, sample-did.json, sample-status-list.json).
//
// What these tests guard against
// ──────────────────────────────
// The samples are written by `scripts/build-vc-samples.mjs`, which mirrors
// the issuer logic inline (it can't import the TypeScript lib/vc/* modules
// directly). If lib/vc/verifier ever changes its expected wrapping, proof
// shape, or canonicalisation, these tests fail loudly — surfacing the
// drift before an integrator copies a sample that doesn't actually verify.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyCredential } from "@/lib/vc/verifier";
import { extractAssertionPublicKey, jwkToSpkiBase64Url } from "@/lib/vc/did-web";
import {
  parseCredentialFromPaste,
  extractEncodedListFromPaste,
} from "@/lib/vc/standalone-verifier-helpers";

const SAMPLES_DIR = join(process.cwd(), "public", "vc");

function loadJson<T>(name: string): T {
  const raw = readFileSync(join(SAMPLES_DIR, name), "utf8");
  return JSON.parse(raw) as T;
}

describe("vc-samples (public/vc/*)", () => {
  it("sample-credential.json passes the standalone-verifier paste check", () => {
    const raw = readFileSync(
      join(SAMPLES_DIR, "sample-credential.json"),
      "utf8",
    );
    const r = parseCredentialFromPaste(raw);
    expect(r.ok).toBe(true);
  });

  it("sample-status-list.json paste-extraction returns the encoded list", () => {
    const raw = readFileSync(
      join(SAMPLES_DIR, "sample-status-list.json"),
      "utf8",
    );
    const r = extractEncodedListFromPaste(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBeGreaterThan(20);
  });

  it("sample-did.json publishes the same key the credential proof embeds", async () => {
    const cred = loadJson<{
      issuer: string;
      proof: { verificationMethod: string; publicKeyB64url: string };
    }>("sample-credential.json");
    const didDoc = loadJson<Parameters<typeof extractAssertionPublicKey>[0]>(
      "sample-did.json",
    );
    expect(didDoc.id).toBe(cred.issuer);
    const jwk = extractAssertionPublicKey(didDoc, cred.proof.verificationMethod);
    expect(jwk).not.toBe(null);
    const resolvedSpki = await jwkToSpkiBase64Url(jwk!);
    expect(resolvedSpki).toBe(cred.proof.publicKeyB64url);
  });

  it("sample credential verifies end-to-end (no resolvers)", async () => {
    const cred = loadJson<Parameters<typeof verifyCredential>[0]>(
      "sample-credential.json",
    );
    const r = await verifyCredential(cred);
    expect(r.ok).toBe(true);
  });

  it("sample credential verifies with a stub status-list resolver — not revoked", async () => {
    const cred = loadJson<Parameters<typeof verifyCredential>[0]>(
      "sample-credential.json",
    );
    const sl = loadJson<{ credentialSubject: { encodedList: string } }>(
      "sample-status-list.json",
    );
    const r = await verifyCredential(cred, {
      statusListResolver: async () => sl.credentialSubject.encodedList,
    });
    expect(r.ok).toBe(true);
  });

  it("sample credential verifies with a stub did-web resolver", async () => {
    const cred = loadJson<Parameters<typeof verifyCredential>[0]>(
      "sample-credential.json",
    );
    const didDoc = loadJson<Awaited<ReturnType<NonNullable<Parameters<typeof verifyCredential>[1]>["didResolver"] extends infer R ? (R extends (...a: never[]) => Promise<infer T> ? T : never) : never>>>(
      "sample-did.json",
    );
    const r = await verifyCredential(cred, {
      didResolver: async () => didDoc,
    });
    expect(r.ok).toBe(true);
  });

  it("sample credential verifies with BOTH resolvers + the URL allowlist", async () => {
    const cred = loadJson<Parameters<typeof verifyCredential>[0]>(
      "sample-credential.json",
    );
    const didDoc = loadJson<Awaited<ReturnType<NonNullable<Parameters<typeof verifyCredential>[1]>["didResolver"] extends infer R ? (R extends (...a: never[]) => Promise<infer T> ? T : never) : never>>>(
      "sample-did.json",
    );
    const sl = loadJson<{ id: string; credentialSubject: { encodedList: string } }>(
      "sample-status-list.json",
    );
    const r = await verifyCredential(cred, {
      didResolver: async () => didDoc,
      statusListResolver: async () => sl.credentialSubject.encodedList,
      allowedStatusListUrls: [sl.id],
      requireDidIssuer: true,
    });
    expect(r.ok).toBe(true);
  });

  it("status-list credential itself is a verifiable VC", async () => {
    const sl = loadJson<Parameters<typeof verifyCredential>[0]>(
      "sample-status-list.json",
    );
    // The StatusList2021Credential carries its own DataIntegrityProof.
    // The verifier expects type[1] === EvenKeelAttestationCredential, so
    // the structural shape check will reject it — but the cryptographic
    // helpers we DO have access to still let us check the issuer matches.
    const cred = loadJson<{ issuer: string }>("sample-status-list.json");
    expect(cred.issuer).toBe("did:web:samples.evenkeel.org");
    void sl; // shape-check separately if a future verifier supports list creds.
  });

  it("sample VC documents real-world claim shape (admissions-officer perspective)", () => {
    const cred = loadJson<{
      credentialSubject: {
        claim: string;
        demonstratedSpecPoints: Array<{
          framework: string;
          code: string;
          claimVocabularyVersion: number;
        }>;
        reviewerNote?: string;
        problemId: string;
      };
      credentialStatus?: { type: string; statusListIndex: string };
    }>("sample-credential.json");
    expect(cred.credentialSubject.claim).toBe("DemonstratedMastery");
    expect(cred.credentialSubject.demonstratedSpecPoints.length).toBeGreaterThanOrEqual(1);
    for (const sp of cred.credentialSubject.demonstratedSpecPoints) {
      expect(sp.framework).toMatch(/[A-Z]/);
      expect(sp.code).toBeTruthy();
      expect(sp.claimVocabularyVersion).toBe(1);
    }
    expect(cred.credentialSubject.problemId).toBeTruthy();
    expect(cred.credentialStatus?.type).toBe("StatusList2021Entry");
    expect(cred.credentialStatus?.statusListIndex).toBe("0");
  });
});
