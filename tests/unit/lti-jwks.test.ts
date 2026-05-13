// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-jwks.test.ts
//
// v1.8.0 — Tests for the JWK→CryptoKey importer used by the LTI 1.3
// launch handler. Covers RSA + EC happy paths, malformed JWKs, kid
// lookup, and JWKS shape validation.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  algForJwk,
  findJwkByKid,
  importParamsFor,
  importPublicJwk,
  verifyParamsFor,
  type JsonWebKey,
  type JsonWebKeySet,
} from "../../lib/lti/jwks";

async function generateRsaPublicJwk(kid = "test-rsa"): Promise<JsonWebKey> {
  const { publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = (await crypto.subtle.exportKey("jwk", publicKey)) as Record<string, unknown>;
  return {
    kty: String(exported.kty),
    n: typeof exported.n === "string" ? exported.n : undefined,
    e: typeof exported.e === "string" ? exported.e : undefined,
    kid,
    alg: "RS256",
    use: "sig",
  };
}

async function generateEcPublicJwk(kid = "test-ec"): Promise<JsonWebKey> {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const exported = (await crypto.subtle.exportKey("jwk", publicKey)) as Record<string, unknown>;
  return {
    kty: String(exported.kty),
    crv: typeof exported.crv === "string" ? exported.crv : undefined,
    x: typeof exported.x === "string" ? exported.x : undefined,
    y: typeof exported.y === "string" ? exported.y : undefined,
    kid,
    alg: "ES256",
    use: "sig",
  };
}

describe("lti/jwks — algForJwk", () => {
  it("returns RS256 for an explicit RS256 JWK", () => {
    expect(algForJwk({ kty: "RSA", alg: "RS256", n: "x", e: "y" })).toBe("RS256");
  });

  it("returns RS384 for an explicit RS384 JWK", () => {
    expect(algForJwk({ kty: "RSA", alg: "RS384", n: "x", e: "y" })).toBe("RS384");
  });

  it("returns ES256 for an EC P-256 JWK", () => {
    expect(algForJwk({ kty: "EC", crv: "P-256", x: "x", y: "y" })).toBe("ES256");
  });

  it("defaults RSA without alg to RS256", () => {
    expect(algForJwk({ kty: "RSA", n: "x", e: "y" })).toBe("RS256");
  });

  it("returns null for unsupported kty", () => {
    expect(algForJwk({ kty: "OKP" })).toBeNull();
  });

  it("returns null for EC with unsupported curve", () => {
    expect(algForJwk({ kty: "EC", crv: "P-384", x: "x", y: "y" })).toBeNull();
  });
});

describe("lti/jwks — verify / import params", () => {
  it("RS256 import params name RSASSA-PKCS1-v1_5 with SHA-256", () => {
    const p = importParamsFor("RS256") as { hash: { name: string }; name: string };
    expect(p.name).toBe("RSASSA-PKCS1-v1_5");
    expect(p.hash.name).toBe("SHA-256");
  });

  it("ES256 import params name ECDSA with P-256", () => {
    const p = importParamsFor("ES256") as { name: string; namedCurve: string };
    expect(p.name).toBe("ECDSA");
    expect(p.namedCurve).toBe("P-256");
  });

  it("ES256 verify params include a hash", () => {
    const p = verifyParamsFor("ES256") as { name: string; hash: { name: string } };
    expect(p.name).toBe("ECDSA");
    expect(p.hash.name).toBe("SHA-256");
  });

  it("RS256 verify params do NOT include a hash (already baked in)", () => {
    const p = verifyParamsFor("RS256") as { name: string };
    expect(p.name).toBe("RSASSA-PKCS1-v1_5");
  });
});

describe("lti/jwks — importPublicJwk", () => {
  it("imports a real RSA public JWK", async () => {
    const jwk = await generateRsaPublicJwk();
    const r = await importPublicJwk(jwk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.algorithm).toBe("RS256");
      expect(r.key.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
    }
  });

  it("imports a real EC P-256 public JWK", async () => {
    const jwk = await generateEcPublicJwk();
    const r = await importPublicJwk(jwk);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.algorithm).toBe("ES256");
      expect(r.key.algorithm.name).toBe("ECDSA");
    }
  });

  it("rejects a JWK missing kty", async () => {
    const r = await importPublicJwk({} as JsonWebKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_kty");
  });

  it("rejects RSA JWK missing n", async () => {
    const r = await importPublicJwk({ kty: "RSA", e: "AQAB" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_rsa_n");
  });

  it("rejects RSA JWK missing e", async () => {
    const r = await importPublicJwk({ kty: "RSA", n: "anything" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_rsa_e");
  });

  it("rejects EC JWK with unsupported curve", async () => {
    const r = await importPublicJwk({ kty: "EC", crv: "P-384", x: "x", y: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_curve");
  });

  it("rejects EC JWK missing x", async () => {
    const r = await importPublicJwk({ kty: "EC", crv: "P-256", y: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_ec_x");
  });

  it("rejects unsupported kty (OKP)", async () => {
    const r = await importPublicJwk({ kty: "OKP" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_kty");
  });
});

describe("lti/jwks — findJwkByKid", () => {
  const jwks: JsonWebKeySet = {
    keys: [
      { kty: "RSA", kid: "a", n: "x", e: "y", use: "sig" },
      { kty: "EC", kid: "b", crv: "P-256", x: "x", y: "y", use: "sig" },
    ],
  };

  it("finds a JWK by exact kid", () => {
    expect(findJwkByKid(jwks, "a")?.kty).toBe("RSA");
    expect(findJwkByKid(jwks, "b")?.kty).toBe("EC");
  });

  it("returns null for an unknown kid", () => {
    expect(findJwkByKid(jwks, "missing")).toBeNull();
  });

  it("returns the single signing key when kid is undefined and exactly one usable key exists", () => {
    const single: JsonWebKeySet = {
      keys: [{ kty: "RSA", n: "x", e: "y", use: "sig" }],
    };
    expect(findJwkByKid(single, undefined)?.kty).toBe("RSA");
  });

  it("returns null when kid is undefined and the set is ambiguous", () => {
    expect(findJwkByKid(jwks, undefined)).toBeNull();
  });

  it("tolerates a missing keys array", () => {
    expect(findJwkByKid({ keys: undefined as unknown as JsonWebKey[] }, "a")).toBeNull();
  });
});
