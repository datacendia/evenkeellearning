// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-id-token.test.ts
//
// v1.8.4 — End-to-end tests for the OIDC ID-token verifier. Signs real
// RS256 / ES256 tokens with Web Crypto, feeds them through the verifier,
// and covers the happy path + every documented failure branch.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";
import { bytesToBase64Url } from "../../lib/crypto/base64url";
import type { JsonWebKey as Jwk, JsonWebKeySet } from "../../lib/jwt/jwks";
import { JWT_SKEW_SECONDS } from "../../lib/jwt/jwt";
import { verifyOidcIdToken } from "../../lib/district/oidc/id-token";

// ── Test key material & signer ──────────────────────────────────────────────

interface KeyMaterial {
  publicJwk: Jwk;
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
  const exported = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as Record<string, unknown>;
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
  const exported = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as Record<string, unknown>;
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

// ── Shared fixture ──────────────────────────────────────────────────────────

const ISS = "https://accounts.example.com";
const AUD = "evk-district-client-1";
const NONCE = "n-abc-123";

function baseClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISS,
    sub: "user-789",
    aud: AUD,
    exp: now + 300,
    iat: now,
    nonce: NONCE,
    email: "user@example.com",
    email_verified: true,
    name: "Ada Lovelace",
    given_name: "Ada",
    family_name: "Lovelace",
    picture: "https://cdn.example.com/u/789.png",
    locale: "en-GB",
    ...overrides,
  };
}

// ── RSA happy path + profile projection ─────────────────────────────────────

describe("district/oidc/id-token — RSA happy path", () => {
  let km: KeyMaterial;
  let jwks: JsonWebKeySet;

  beforeAll(async () => {
    km = await makeRsaKeyMaterial("rsa-oidc-1");
    jwks = { keys: [km.publicJwk] };
  });

  it("verifies and projects the expected profile claims", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-oidc-1", typ: "JWT" },
      baseClaims(),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sub).toBe("user-789");
      expect(r.iss).toBe(ISS);
      expect(r.aud).toEqual([AUD]);
      expect(r.email).toBe("user@example.com");
      expect(r.emailVerified).toBe(true);
      expect(r.name).toBe("Ada Lovelace");
      expect(r.givenName).toBe("Ada");
      expect(r.familyName).toBe("Lovelace");
      expect(r.picture).toBe("https://cdn.example.com/u/789.png");
      expect(r.locale).toBe("en-GB");
    }
  });

  it("accepts aud as an array containing the client id", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-oidc-1" },
      baseClaims({ aud: [AUD] }), // single-element array
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(true);
  });

  it("requires azp when aud is multi-valued and accepts correct azp", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-oidc-1" },
      baseClaims({ aud: [AUD, "other-rp"], azp: AUD }),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(true);
  });

  it("tolerates missing optional profile claims", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-oidc-1" },
      baseClaims({
        email: undefined,
        email_verified: undefined,
        name: undefined,
        given_name: undefined,
        family_name: undefined,
        picture: undefined,
        locale: undefined,
      }),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.email).toBeUndefined();
      expect(r.name).toBeUndefined();
    }
  });
});

// ── Signature-stage failures ────────────────────────────────────────────────

describe("district/oidc/id-token — signature-stage failures", () => {
  let km: KeyMaterial;
  let jwks: JsonWebKeySet;

  beforeAll(async () => {
    km = await makeRsaKeyMaterial("rsa-oidc-2");
    jwks = { keys: [km.publicJwk] };
  });

  it("reports signature/unknown_kid for a kid not in the JWKS", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "not-in-jwks" },
      baseClaims(),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("signature");
      expect(r.reason).toBe("unknown_kid");
    }
  });

  it("reports signature/bad_signature for a tampered payload", async () => {
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-oidc-2" },
      baseClaims(),
    );
    const [h, _p, s] = token.split(".");
    const tampered =
      h +
      "." +
      bytesToBase64Url(
        new TextEncoder().encode(JSON.stringify(baseClaims({ sub: "attacker" }))),
      ) +
      "." +
      s;
    const r = await verifyOidcIdToken(tampered, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("signature");
      expect(r.reason).toBe("bad_signature");
    }
  });

  it("reports signature/expired for a token past exp + skew", async () => {
    const past = Math.floor(Date.now() / 1000) - JWT_SKEW_SECONDS - 60;
    const token = await signJwt(
      km,
      { alg: "RS256", kid: "rsa-oidc-2" },
      baseClaims({ exp: past, iat: past - 10 }),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("signature");
      expect(r.reason).toBe("expired");
    }
  });
});

// ── Claim-stage failures ────────────────────────────────────────────────────

describe("district/oidc/id-token — claim-stage failures", () => {
  let km: KeyMaterial;
  let jwks: JsonWebKeySet;

  beforeAll(async () => {
    km = await makeRsaKeyMaterial("rsa-oidc-3");
    jwks = { keys: [km.publicJwk] };
  });

  async function sign(claims: Record<string, unknown>) {
    return signJwt(km, { alg: "RS256", kid: "rsa-oidc-3" }, claims);
  }

  it("reports iss_mismatch when iss differs", async () => {
    const token = await sign(baseClaims({ iss: "https://evil.example" }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("claims");
      expect(r.reason).toBe("iss_mismatch");
    }
  });

  it("reports aud_missing_client when aud is wrong string", async () => {
    const token = await sign(baseClaims({ aud: "some-other-rp" }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("claims");
      expect(r.reason).toBe("aud_missing_client");
    }
  });

  it("reports aud_missing_client when aud array lacks our client_id", async () => {
    const token = await sign(baseClaims({ aud: ["a", "b"], azp: "a" }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("claims");
      expect(r.reason).toBe("aud_missing_client");
    }
  });

  it("reports azp_mismatch when aud is multi-valued but azp is wrong", async () => {
    const token = await sign(
      baseClaims({ aud: [AUD, "another-rp"], azp: "another-rp" }),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("claims");
      expect(r.reason).toBe("azp_mismatch");
    }
  });

  it("reports azp_mismatch when aud is multi-valued and azp is missing", async () => {
    const token = await sign(baseClaims({ aud: [AUD, "another-rp"] }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("claims");
      expect(r.reason).toBe("azp_mismatch");
    }
  });

  it("does NOT require azp when aud has a single string value", async () => {
    // Sanity: same setup as happy path, no azp. Already covered, but
    // checked here too so we protect against regressions that start
    // demanding azp universally.
    const token = await sign(baseClaims({ aud: AUD }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(true);
  });

  it("reports nonce_missing when nonce is absent", async () => {
    const token = await sign(baseClaims({ nonce: undefined }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("nonce_missing");
  });

  it("reports nonce_mismatch when nonce differs", async () => {
    const token = await sign(baseClaims({ nonce: "different-nonce" }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("nonce_mismatch");
  });

  it("reports sub_missing when sub is absent", async () => {
    const token = await sign(baseClaims({ sub: undefined }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("sub_missing");
  });

  it("reports iat_too_old when max_age is exceeded", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(
      baseClaims({ iat: now - 3600, exp: now + 300 }),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
      maxAgeSeconds: 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("iat_too_old");
  });

  it("accepts iat inside max_age window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(baseClaims({ iat: now - 10, exp: now + 300 }));
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
      maxAgeSeconds: 60,
    });
    expect(r.ok).toBe(true);
  });
});

// ── ES256 happy path (mirrors RSA but exercises the EC path) ────────────────

describe("district/oidc/id-token — ES256 happy path", () => {
  it("verifies an ES256-signed ID token", async () => {
    const km = await makeEcKeyMaterial("ec-oidc-1");
    const jwks: JsonWebKeySet = { keys: [km.publicJwk] };
    const token = await signJwt(
      km,
      { alg: "ES256", kid: "ec-oidc-1", typ: "JWT" },
      baseClaims(),
    );
    const r = await verifyOidcIdToken(token, jwks, {
      expectedIss: ISS,
      expectedAud: AUD,
      expectedNonce: NONCE,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sub).toBe("user-789");
  });
});
