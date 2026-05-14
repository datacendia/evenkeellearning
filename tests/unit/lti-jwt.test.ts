// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-jwt.test.ts
//
// v1.8.0 — End-to-end tests for the LTI JWT verifier using real
// RSA / EC key pairs generated via Web Crypto. We sign a JWT in the
// test setup and verify it with the production code path.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";
import { bytesToBase64Url } from "../../lib/crypto/base64url";
import {
  decodeJwtUnsafe,
  verifyJwt,
  JWT_SKEW_SECONDS,
  type JwtPayload,
} from "../../lib/lti/jwt";
import type { JsonWebKey as LtiJwk, JsonWebKeySet } from "../../lib/lti/jwks";

interface KeyMaterial {
  publicJwk: LtiJwk;
  privateKey: CryptoKey;
  algorithm:
    | { name: "RSASSA-PKCS1-v1_5" }
    | { name: "ECDSA"; hash: { name: "SHA-256" } };
}

async function makeRsaKeyMaterial(kid: string): Promise<KeyMaterial> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>;
  return {
    publicJwk: {
      kty: String(exported.kty),
      n: typeof exported.n === "string" ? exported.n : undefined,
      e: typeof exported.e === "string" ? exported.e : undefined,
      kid,
      alg: "RS256",
      use: "sig",
    },
    privateKey: pair.privateKey,
    algorithm: { name: "RSASSA-PKCS1-v1_5" },
  };
}

async function makeEcKeyMaterial(kid: string): Promise<KeyMaterial> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>;
  return {
    publicJwk: {
      kty: String(exported.kty),
      crv: typeof exported.crv === "string" ? exported.crv : undefined,
      x: typeof exported.x === "string" ? exported.x : undefined,
      y: typeof exported.y === "string" ? exported.y : undefined,
      kid,
      alg: "ES256",
      use: "sig",
    },
    privateKey: pair.privateKey,
    algorithm: { name: "ECDSA", hash: { name: "SHA-256" } },
  };
}

async function signJwt(
  km: KeyMaterial,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const enc = new TextEncoder();
  const hb = bytesToBase64Url(enc.encode(JSON.stringify(header)));
  const pb = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const signingInput = hb + "." + pb;
  const sig = await crypto.subtle.sign(
    km.algorithm,
    km.privateKey,
    enc.encode(signingInput),
  );
  return signingInput + "." + bytesToBase64Url(new Uint8Array(sig));
}

describe("lti/jwt — decodeJwtUnsafe", () => {
  it("returns null for a non-string input", () => {
    expect(decodeJwtUnsafe(123 as unknown as string)).toBeNull();
  });

  it("returns null for a malformed token (wrong dot count)", () => {
    expect(decodeJwtUnsafe("aaa.bbb")).toBeNull();
    expect(decodeJwtUnsafe("aaa.bbb.ccc.ddd")).toBeNull();
  });

  it("returns null for a token whose header is not base64url JSON", () => {
    expect(decodeJwtUnsafe("&&&.eyJ9.zzz")).toBeNull();
  });

  it("decodes a syntactically valid token without verifying", () => {
    const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256" })));
    const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ sub: "x" })));
    const r = decodeJwtUnsafe(header + "." + payload + ".signature");
    expect(r).not.toBeNull();
    expect(r?.header.alg).toBe("RS256");
    expect(r?.payload.sub).toBe("x");
  });
});

describe("lti/jwt — verifyJwt (RSA happy path)", () => {
  let km: KeyMaterial;
  let jwks: JsonWebKeySet;

  beforeAll(async () => {
    km = await makeRsaKeyMaterial("rsa-1");
    jwks = { keys: [km.publicJwk] };
  });

  it("verifies a freshly signed RS256 JWT", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-1", typ: "JWT" },
      {
        iss: "https://example",
        sub: "user-1",
        aud: "client-1",
        exp: now + 60,
        iat: now,
        nonce: "n-1",
      },
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.sub).toBe("user-1");
      expect(r.payload.nonce).toBe("n-1");
    }
  });

  it("rejects an unknown kid", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-WRONG" },
      { iss: "x", sub: "u", aud: "a", exp: Math.floor(Date.now() / 1000) + 60 },
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_kid");
  });

  it("rejects an unsupported algorithm", async () => {
    const token = await signJwt(
      km,
      { alg: "HS256", kid: "rsa-1" },
      { iss: "x", sub: "u", aud: "a", exp: Math.floor(Date.now() / 1000) + 60 },
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_alg");
  });

  it("rejects a tampered payload", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-1" },
      { iss: "x", sub: "u", aud: "a", exp: now + 60 },
    );
    // Mangle the payload section.
    const [h, _p, s] = token.split(".");
    const mangled = h + "." + bytesToBase64Url(new TextEncoder().encode('{"sub":"attacker"}')) + "." + s;
    const r = await verifyJwt(mangled, { keys: [km.publicJwk] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - JWT_SKEW_SECONDS - 60;
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-1" },
      { iss: "x", sub: "u", aud: "a", exp: past },
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a not-yet-valid token (nbf in the future)", async () => {
    const futureNbf = Math.floor(Date.now() / 1000) + JWT_SKEW_SECONDS + 60;
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-1" },
      { iss: "x", sub: "u", aud: "a", exp: futureNbf + 60, nbf: futureNbf },
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_yet_valid");
  });

  it("tolerates clock skew within the JWT_SKEW_SECONDS window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-1" },
      { iss: "x", sub: "u", aud: "a", exp: now - 10 }, // just expired
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(true);
  });
});

describe("lti/jwt — verifyJwt (EC happy path)", () => {
  let km: KeyMaterial;
  let jwks: JsonWebKeySet;

  beforeAll(async () => {
    km = await makeEcKeyMaterial("ec-1");
    jwks = { keys: [km.publicJwk] };
  });

  it("verifies a freshly signed ES256 JWT", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      km,
      { alg: "ES256", kid: "ec-1", typ: "JWT" },
      {
        iss: "https://example",
        sub: "user-1",
        aud: "client-1",
        exp: now + 60,
        nonce: "n-2",
      },
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.nonce).toBe("n-2");
  });
});

describe("lti/jwt — verifyJwt (mismatch between header alg and JWK alg)", () => {
  it("rejects a header that disagrees with the JWK's alg", async () => {
    const km = await makeRsaKeyMaterial("rsa-1");
    // Force the JWK to advertise a different alg from the header.
    const jwks: JsonWebKeySet = {
      keys: [{ ...km.publicJwk, alg: "RS384" }],
    };
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-1" },
      { iss: "x", sub: "u", aud: "a", exp: Math.floor(Date.now() / 1000) + 60 } as JwtPayload,
    );
    const r = await verifyJwt(token, jwks);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_alg");
  });
});
