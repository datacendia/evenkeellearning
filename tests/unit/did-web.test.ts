import { describe, it, expect } from "vitest";
import {
  resolveDidWebUrl,
  buildDidDocument,
  verifyVerificationMethodBinding,
  spkiBase64UrlToJwk,
  jwkToSpkiBase64Url,
  DID_CONTEXT_V1,
  JWS_2020_CONTEXT,
} from "@/lib/vc/did-web";
// ─── Helpers ───────────────────────────────────────────────────────────────

async function makeSpkiB64url(): Promise<string> {
  // The session signer caches a single keypair per process, so we
  // generate fresh ECDSA P-256 keypairs here to get DISTINCT keys
  // when the test wants two different public keys.
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
  const bytes = new Uint8Array(spki);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// ─── resolveDidWebUrl ──────────────────────────────────────────────────────

describe("resolveDidWebUrl", () => {
  it("maps a bare domain to /.well-known/did.json", () => {
    expect(resolveDidWebUrl("did:web:school.example")).toBe(
      "https://school.example/.well-known/did.json",
    );
  });

  it("maps a path-qualified did to the nested did.json", () => {
    expect(resolveDidWebUrl("did:web:school.example:issuers:maths")).toBe(
      "https://school.example/issuers/maths/did.json",
    );
  });

  it("decodes percent-encoded port in domain segment", () => {
    expect(resolveDidWebUrl("did:web:school.example%3A8443")).toBe(
      "https://school.example:8443/.well-known/did.json",
    );
  });

  it("rejects non-did-web identifiers", () => {
    expect(() => resolveDidWebUrl("did:key:xyz")).toThrow(/not_did_web/);
    expect(() => resolveDidWebUrl("https://x.test")).toThrow(/not_did_web/);
  });

  it("rejects an empty identifier", () => {
    expect(() => resolveDidWebUrl("did:web:")).toThrow(/empty_did_identifier/);
  });
});

// ─── spki ↔ jwk round-trip ─────────────────────────────────────────────────

describe("spkiBase64UrlToJwk + jwkToSpkiBase64Url", () => {
  it("round-trips through JWK without byte change", async () => {
    const spki = await makeSpkiB64url();
    const jwk = await spkiBase64UrlToJwk(spki);
    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(jwk.x.length).toBeGreaterThan(0);
    expect(jwk.y.length).toBeGreaterThan(0);
    const back = await jwkToSpkiBase64Url(jwk);
    expect(back).toBe(spki);
  });
});

// ─── buildDidDocument ──────────────────────────────────────────────────────

describe("buildDidDocument", () => {
  it("builds a W3C-shaped DID document with one key", async () => {
    const spki = await makeSpkiB64url();
    const doc = await buildDidDocument({
      did: "did:web:school.example",
      keys: [{ fragmentId: "key-1", publicKeyB64url: spki }],
    });
    expect(doc["@context"]).toEqual([DID_CONTEXT_V1, JWS_2020_CONTEXT]);
    expect(doc.id).toBe("did:web:school.example");
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0].id).toBe(
      "did:web:school.example#key-1",
    );
    expect(doc.verificationMethod[0].type).toBe("JsonWebKey2020");
    expect(doc.verificationMethod[0].controller).toBe("did:web:school.example");
    expect(doc.verificationMethod[0].publicKeyJwk.kid).toBe("key-1");
    expect(doc.assertionMethod).toEqual(["did:web:school.example#key-1"]);
  });

  it("supports multiple keys", async () => {
    const k1 = await makeSpkiB64url();
    const k2 = await makeSpkiB64url();
    const doc = await buildDidDocument({
      did: "did:web:school.example",
      keys: [
        { fragmentId: "key-1", publicKeyB64url: k1 },
        { fragmentId: "key-2", publicKeyB64url: k2 },
      ],
    });
    expect(doc.verificationMethod).toHaveLength(2);
    expect(doc.assertionMethod).toHaveLength(2);
  });

  it("rejects a non-did:web identifier", async () => {
    await expect(
      buildDidDocument({ did: "did:key:x", keys: [] }),
    ).rejects.toThrow(/not_did_web/);
  });

  it("rejects an empty key list", async () => {
    await expect(
      buildDidDocument({ did: "did:web:x", keys: [] }),
    ).rejects.toThrow(/no_keys/);
  });
});

// ─── verifyVerificationMethodBinding ───────────────────────────────────────

describe("verifyVerificationMethodBinding", () => {
  async function makeFixture() {
    const spki = await makeSpkiB64url();
    const did = "did:web:school.example";
    const doc = await buildDidDocument({
      did,
      keys: [{ fragmentId: "key-1", publicKeyB64url: spki }],
    });
    return { did, doc, spki };
  }

  it("accepts a correctly-bound key", async () => {
    const { did, doc, spki } = await makeFixture();
    const r = await verifyVerificationMethodBinding({
      didDocument: doc,
      expectedDid: did,
      verificationMethodId: `${did}#key-1`,
      embeddedPublicKeyB64url: spki,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects when DID document id does not match issuer", async () => {
    const { doc, spki } = await makeFixture();
    const r = await verifyVerificationMethodBinding({
      didDocument: doc,
      expectedDid: "did:web:attacker.example",
      verificationMethodId: "did:web:school.example#key-1",
      embeddedPublicKeyB64url: spki,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("did_mismatch");
  });

  it("rejects when the verificationMethod id is absent", async () => {
    const { did, doc, spki } = await makeFixture();
    const r = await verifyVerificationMethodBinding({
      didDocument: doc,
      expectedDid: did,
      verificationMethodId: `${did}#key-missing`,
      embeddedPublicKeyB64url: spki,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("vm_not_found");
  });

  it("rejects when the method is not an assertion method", async () => {
    const { did, doc, spki } = await makeFixture();
    const tampered = { ...doc, assertionMethod: [] };
    const r = await verifyVerificationMethodBinding({
      didDocument: tampered,
      expectedDid: did,
      verificationMethodId: `${did}#key-1`,
      embeddedPublicKeyB64url: spki,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("vm_not_assertion_method");
  });

  it("rejects when the embedded key does not match the published JWK", async () => {
    const { did, doc } = await makeFixture();
    const wrongKey = await makeSpkiB64url(); // fresh, different session key
    const r = await verifyVerificationMethodBinding({
      didDocument: doc,
      expectedDid: did,
      verificationMethodId: `${did}#key-1`,
      embeddedPublicKeyB64url: wrongKey,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("key_mismatch");
  });
});
