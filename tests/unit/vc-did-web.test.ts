import { describe, it, expect } from "vitest";
import {
  DID_CORE_CONTEXT,
  JWS_2020_CONTEXT,
  buildDidWebDocument,
  defaultDidWebResolver,
  didWebToHttpsUrl,
  extractAssertionPublicKey,
  findVerificationMethod,
  jwkToSpkiBase64Url,
  spkiBase64UrlToJwk,
  type DidDocument,
  type DidWebResolver,
} from "@/lib/vc/did-web";
import { issueVerifiableCredential } from "@/lib/vc/issuer";
import { verifyCredential } from "@/lib/vc/verifier";
import { signPayload } from "@/lib/crypto/signing";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";

// ─── didWebToHttpsUrl ──────────────────────────────────────────────────────

describe("didWebToHttpsUrl", () => {
  it("maps a bare host to .well-known/did.json", () => {
    expect(didWebToHttpsUrl("did:web:issuer.example")).toBe(
      "https://issuer.example/.well-known/did.json",
    );
  });

  it("maps a host + path segments to /seg/seg/did.json", () => {
    expect(didWebToHttpsUrl("did:web:issuer.example:user:alice")).toBe(
      "https://issuer.example/user/alice/did.json",
    );
  });

  it("decodes %3A in the host segment as a port", () => {
    expect(didWebToHttpsUrl("did:web:issuer.example%3A8443")).toBe(
      "https://issuer.example:8443/.well-known/did.json",
    );
  });

  it("decodes %3A in the host segment AND keeps path segments", () => {
    expect(didWebToHttpsUrl("did:web:issuer.example%3A8443:keys:1")).toBe(
      "https://issuer.example:8443/keys/1/did.json",
    );
  });

  it("rejects empty input", () => {
    expect(() => didWebToHttpsUrl("")).toThrow();
  });

  it("rejects non-did:web", () => {
    expect(() => didWebToHttpsUrl("did:key:z6Mk...")).toThrow();
    expect(() => didWebToHttpsUrl("https://issuer.example")).toThrow();
  });

  it("rejects empty host", () => {
    expect(() => didWebToHttpsUrl("did:web:")).toThrow();
  });

  it("rejects host with forbidden chars", () => {
    expect(() => didWebToHttpsUrl("did:web:foo/bar")).toThrow();
    expect(() => didWebToHttpsUrl("did:web:foo?bar")).toThrow();
  });

  it("rejects empty path segments", () => {
    expect(() => didWebToHttpsUrl("did:web:issuer.example::alice")).toThrow();
  });
});

// ─── buildDidWebDocument ───────────────────────────────────────────────────

describe("buildDidWebDocument", () => {
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: "AAAA",
    y: "BBBB",
  };

  it("emits a spec-compliant minimal doc", () => {
    const doc = buildDidWebDocument({
      did: "did:web:issuer.example",
      publicKeyJwk: jwk,
    });
    expect(doc["@context"]).toEqual([DID_CORE_CONTEXT, JWS_2020_CONTEXT]);
    expect(doc.id).toBe("did:web:issuer.example");
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0]).toEqual({
      id: "did:web:issuer.example#key-1",
      type: "JsonWebKey2020",
      controller: "did:web:issuer.example",
      publicKeyJwk: jwk,
    });
    expect(doc.assertionMethod).toEqual(["did:web:issuer.example#key-1"]);
    expect(doc.authentication).toEqual(["did:web:issuer.example#key-1"]);
  });

  it("respects a custom fragment", () => {
    const doc = buildDidWebDocument({
      did: "did:web:issuer.example",
      publicKeyJwk: jwk,
      fragment: "signing-key",
    });
    expect(doc.verificationMethod[0]?.id).toBe(
      "did:web:issuer.example#signing-key",
    );
    expect(doc.assertionMethod[0]).toBe("did:web:issuer.example#signing-key");
  });

  it("rejects bad inputs", () => {
    expect(() =>
      buildDidWebDocument({ did: "https://x", publicKeyJwk: jwk }),
    ).toThrow();
    expect(() =>
      buildDidWebDocument({
        did: "did:web:issuer.example",
        publicKeyJwk: null as unknown as JsonWebKey,
      }),
    ).toThrow();
    expect(() =>
      buildDidWebDocument({
        did: "did:web:issuer.example",
        publicKeyJwk: jwk,
        fragment: "bad/fragment",
      }),
    ).toThrow();
    expect(() =>
      buildDidWebDocument({
        did: "did:web:issuer.example",
        publicKeyJwk: jwk,
        fragment: "with#hash",
      }),
    ).toThrow();
  });
});

// ─── findVerificationMethod / extractAssertionPublicKey ────────────────────

describe("findVerificationMethod / extractAssertionPublicKey", () => {
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: "AAAA", y: "BBBB" };
  const doc = buildDidWebDocument({
    did: "did:web:issuer.example",
    publicKeyJwk: jwk,
  });

  it("finds a method by id", () => {
    expect(findVerificationMethod(doc, "did:web:issuer.example#key-1")).not.toBe(
      null,
    );
    expect(findVerificationMethod(doc, "did:web:issuer.example#missing")).toBe(
      null,
    );
  });

  it("extracts the JWK when the VM is in assertionMethod", () => {
    const got = extractAssertionPublicKey(doc, "did:web:issuer.example#key-1");
    expect(got).toEqual(jwk);
  });

  it("returns null when the VM exists but is NOT in assertionMethod", () => {
    const tweaked: DidDocument = { ...doc, assertionMethod: [] };
    expect(
      extractAssertionPublicKey(tweaked, "did:web:issuer.example#key-1"),
    ).toBe(null);
  });

  it("returns null on missing or malformed doc", () => {
    expect(
      extractAssertionPublicKey(
        { verificationMethod: undefined } as unknown as DidDocument,
        "did:web:x#key-1",
      ),
    ).toBe(null);
  });
});

// ─── spkiBase64UrlToJwk / jwkToSpkiBase64Url ───────────────────────────────

describe("spkiBase64UrlToJwk / jwkToSpkiBase64Url round-trip", () => {
  it("round-trips a fresh ECDSA-P256 public key", async () => {
    const kp = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
    const spkiB64url = bytesToBase64Url(new Uint8Array(spki));
    const jwk = await spkiBase64UrlToJwk(spkiB64url);
    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(typeof jwk.x).toBe("string");
    expect(typeof jwk.y).toBe("string");
    const back = await jwkToSpkiBase64Url(jwk);
    expect(back).toBe(spkiB64url);
  });

  it("rejects malformed SPKI", async () => {
    await expect(spkiBase64UrlToJwk("not-real-spki-bytes")).rejects.toThrow();
  });
});

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ─── defaultDidWebResolver (with mocked fetch) ─────────────────────────────

describe("defaultDidWebResolver", () => {
  const did = "did:web:issuer.example";
  const goodDoc: DidDocument = buildDidWebDocument({
    did,
    publicKeyJwk: { kty: "EC", crv: "P-256", x: "AAAA", y: "BBBB" },
  });

  function mockFetch(impl: (url: string) => Promise<Response> | Response): () => void {
    const original = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      return impl(url);
    }) as typeof fetch;
    return () => {
      (globalThis as { fetch: typeof fetch }).fetch = original;
    };
  }

  it("fetches and parses a well-formed doc", async () => {
    const restore = mockFetch((url) => {
      expect(url).toBe("https://issuer.example/.well-known/did.json");
      return new Response(JSON.stringify(goodDoc), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const doc = await defaultDidWebResolver(did);
    restore();
    expect(doc.id).toBe(did);
  });

  it("throws on non-2xx", async () => {
    const restore = mockFetch(() => new Response("nope", { status: 404 }));
    await expect(defaultDidWebResolver(did)).rejects.toThrow(/did_web_http_404/);
    restore();
  });

  it("throws on invalid JSON", async () => {
    const restore = mockFetch(
      () => new Response("not json", { status: 200 }),
    );
    await expect(defaultDidWebResolver(did)).rejects.toThrow(/did_web_bad_json/);
    restore();
  });

  it("throws when doc.id does not match the requested did", async () => {
    const wrong = { ...goodDoc, id: "did:web:other.example" };
    const restore = mockFetch(
      () => new Response(JSON.stringify(wrong), { status: 200 }),
    );
    await expect(defaultDidWebResolver(did)).rejects.toThrow(/did_web_id_mismatch/);
    restore();
  });

  it("throws when verificationMethod is missing", async () => {
    const bad = { ...goodDoc, verificationMethod: undefined };
    const restore = mockFetch(
      () => new Response(JSON.stringify(bad), { status: 200 }),
    );
    await expect(defaultDidWebResolver(did)).rejects.toThrow(/did_web_bad_doc/);
    restore();
  });

  it("propagates network errors as did_web_fetch_failed", async () => {
    const restore = mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(defaultDidWebResolver(did)).rejects.toThrow(
      /did_web_fetch_failed/,
    );
    restore();
  });
});

// ─── End-to-end: issue, resolve, verify ────────────────────────────────────

const testSigner = (p: { canonical: string }) =>
  signPayload(p, { keySource: "session" });

function fakeAttestation(): TeacherAttestationEnvelope {
  return {
    payload: {
      version: 1,
      crtContentDigestB64url: "crt-digest",
      studentExternalId: "alex-01",
      problemId: "alg-quad-01",
      attestedAtIso: "2026-05-11T10:00:00Z",
      verdict: "verified-mastery",
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A18",
          claimVocabularyVersion: 1,
        },
      ],
    },
    contentDigestB64url: "att-digest",
    signatureB64url: "att-sig",
    publicKeyB64url: "teacher-pk",
    signedAtIso: "2026-05-11T10:00:00Z",
    algorithm: "ECDSA-P256-SHA256",
    keyType: "passkey-derived",
  };
}

describe("end-to-end: did-web resolve + verify", () => {
  it("verifies when the resolved DID-doc key matches the embedded key", async () => {
    const issuerDid = "did:web:issuer.example";
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid,
      signer: testSigner,
    });
    const jwk = await spkiBase64UrlToJwk(vc.proof.publicKeyB64url);
    const doc = buildDidWebDocument({ did: issuerDid, publicKeyJwk: jwk });
    const resolver: DidWebResolver = async (d) => {
      expect(d).toBe(issuerDid);
      return doc;
    };
    const r = await verifyCredential(vc, { didResolver: resolver });
    expect(r.ok).toBe(true);
  });

  it("rejects with did_key_mismatch when the DID doc publishes a different key", async () => {
    const issuerDid = "did:web:issuer.example";
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid,
      signer: testSigner,
    });
    // Mint a DIFFERENT key and publish that one in the DID doc.
    const otherKp = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const otherJwk = await crypto.subtle.exportKey("jwk", otherKp.publicKey);
    const doc = buildDidWebDocument({ did: issuerDid, publicKeyJwk: otherJwk });
    const r = await verifyCredential(vc, {
      didResolver: async () => doc,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("did_key_mismatch");
  });

  it("rejects with did_verification_method_not_found when the proof's vmId is absent from the doc", async () => {
    const issuerDid = "did:web:issuer.example";
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid,
      signer: testSigner,
    });
    const jwk = await spkiBase64UrlToJwk(vc.proof.publicKeyB64url);
    const doc = buildDidWebDocument({
      did: issuerDid,
      publicKeyJwk: jwk,
      fragment: "different-fragment",
    });
    const r = await verifyCredential(vc, {
      didResolver: async () => doc,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("did_verification_method_not_found");
  });

  it("rejects with did_resolver_failed when the resolver throws", async () => {
    const issuerDid = "did:web:issuer.example";
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid,
      signer: testSigner,
    });
    const r = await verifyCredential(vc, {
      didResolver: async () => {
        throw new Error("DNS failure");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("did_resolver_failed");
  });

  it("with no resolver, falls back to the embedded key (legacy behaviour preserved)", async () => {
    const issuerDid = "did:web:issuer.example";
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid,
      signer: testSigner,
    });
    const r = await verifyCredential(vc);
    expect(r.ok).toBe(true);
  });

  it("with a resolver but a non-DID issuer, passes (resolver no-op for plain string issuers)", async () => {
    // A v1.7.0 credential whose issuer is a plain string, not a DID.
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "https://legacy-issuer.example",
      signer: testSigner,
    });
    const r = await verifyCredential(vc, {
      didResolver: async () => {
        throw new Error("should not be called");
      },
    });
    expect(r.ok).toBe(true);
  });

  it("with requireDidIssuer + non-DID issuer, rejects with issuer_did_required (no resolver case)", async () => {
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "https://legacy-issuer.example",
      signer: testSigner,
    });
    const r = await verifyCredential(vc, { requireDidIssuer: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer_did_required");
  });

  it("with requireDidIssuer + non-DID issuer + resolver, rejects with issuer_did_required (resolver case)", async () => {
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "https://legacy-issuer.example",
      signer: testSigner,
    });
    const r = await verifyCredential(vc, {
      requireDidIssuer: true,
      didResolver: async () => {
        throw new Error("should not be called");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer_did_required");
  });
});
