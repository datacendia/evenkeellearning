// ─────────────────────────────────────────────────────────────────────────────
// lib/jwt/jwks.ts
//
// v1.8.4 — Generic JWK Set helpers (formerly `lib/lti/jwks.ts`).
//
// SCOPE
// ─────
// Pure JWK → CryptoKey transformations. No network I/O, no caching,
// no protocol-specific semantics. Used by:
//
//   • `lib/lti/*`           — LTI 1.3 id_token verification
//   • `lib/district/oidc/*` — district OIDC/OIDF ID token verification
//
// SUPPORTED ALGORITHMS
// ────────────────────
//   • RS256 — RSASSA-PKCS1-v1_5 with SHA-256. OIDC + LTI default.
//   • RS384 — same family, SHA-384. Spec-legal.
//   • RS512 — same family, SHA-512. Spec-legal.
//   • ES256 — ECDSA-P256-SHA256. Common in modern OIDC providers.
//
// We REFUSE to import any other algorithm here — better to fail loud
// than silently downgrade to an algorithm we can't verify.
// ─────────────────────────────────────────────────────────────────────────────

import { base64UrlToBytes, toArrayBuffer } from "@/lib/crypto/base64url";

/**
 * Subset of a JWK relevant to signature verification. The full
 * JWK shape (RFC 7517) has more optional fields; we ignore them but
 * tolerate them.
 */
export interface JsonWebKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  // RSA
  n?: string;
  e?: string;
  // EC
  crv?: string;
  x?: string;
  y?: string;
}

/** A JWK Set (JWKS) as published at a `jwks_uri`. */
export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

/** Stable reasons for a JWK→CryptoKey conversion failure. */
export type JwkImportFailure =
  | "missing_kty"
  | "unsupported_kty"
  | "missing_rsa_n"
  | "missing_rsa_e"
  | "missing_ec_x"
  | "missing_ec_y"
  | "unsupported_curve"
  | "unsupported_alg"
  | "import_failed";

/** Supported JWS algorithms for `algForJwk` and `verifyParamsFor`. */
export type SupportedJwsAlgorithm = "RS256" | "RS384" | "RS512" | "ES256";

const RSA_HASH: Record<"RS256" | "RS384" | "RS512", string> = {
  RS256: "SHA-256",
  RS384: "SHA-384",
  RS512: "SHA-512",
};

/**
 * Web Crypto `algorithm` argument for importing a JWK as a verify-only
 * public key.
 */
export function importParamsFor(
  alg: SupportedJwsAlgorithm,
): RsaHashedImportParams | EcKeyImportParams {
  if (alg === "ES256") {
    return { name: "ECDSA", namedCurve: "P-256" };
  }
  return { name: "RSASSA-PKCS1-v1_5", hash: { name: RSA_HASH[alg] } };
}

/**
 * Web Crypto `algorithm` argument for `crypto.subtle.verify`.
 */
export function verifyParamsFor(
  alg: SupportedJwsAlgorithm,
): EcdsaParams | { name: "RSASSA-PKCS1-v1_5" } {
  if (alg === "ES256") {
    return { name: "ECDSA", hash: { name: "SHA-256" } };
  }
  return { name: "RSASSA-PKCS1-v1_5" };
}

/** Return the supported-algorithm tag for a JWK, or null if unsupported. */
export function algForJwk(jwk: JsonWebKey): SupportedJwsAlgorithm | null {
  if (jwk.alg === "RS256" || jwk.alg === "RS384" || jwk.alg === "RS512") {
    return jwk.alg;
  }
  if (jwk.alg === "ES256") return "ES256";
  if (jwk.kty === "RSA") return "RS256"; // OIDC/LTI default
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  return null;
}

/**
 * Convert a JWK to a Web Crypto `CryptoKey` suitable for `subtle.verify`.
 * Returns either the key or a stable failure reason.
 */
export async function importPublicJwk(
  jwk: JsonWebKey,
): Promise<
  | { ok: true; key: CryptoKey; algorithm: SupportedJwsAlgorithm }
  | { ok: false; reason: JwkImportFailure }
> {
  if (!jwk.kty || typeof jwk.kty !== "string") {
    return { ok: false, reason: "missing_kty" };
  }

  if (jwk.kty === "RSA") {
    if (!jwk.n || typeof jwk.n !== "string") {
      return { ok: false, reason: "missing_rsa_n" };
    }
    if (!jwk.e || typeof jwk.e !== "string") {
      return { ok: false, reason: "missing_rsa_e" };
    }
  } else if (jwk.kty === "EC") {
    if (jwk.crv !== "P-256") {
      return { ok: false, reason: "unsupported_curve" };
    }
    if (!jwk.x || typeof jwk.x !== "string") {
      return { ok: false, reason: "missing_ec_x" };
    }
    if (!jwk.y || typeof jwk.y !== "string") {
      return { ok: false, reason: "missing_ec_y" };
    }
  } else {
    return { ok: false, reason: "unsupported_kty" };
  }

  const algorithm = algForJwk(jwk);
  if (!algorithm) return { ok: false, reason: "unsupported_alg" };

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk.kty === "RSA"
        ? { kty: "RSA", n: jwk.n, e: jwk.e, alg: algorithm, ext: true }
        : {
            kty: "EC",
            crv: jwk.crv!,
            x: jwk.x,
            y: jwk.y,
            ext: true,
          },
      importParamsFor(algorithm),
      false,
      ["verify"],
    );
    return { ok: true, key, algorithm };
  } catch {
    return { ok: false, reason: "import_failed" };
  }
}

/**
 * Locate a JWK in a JWKS by `kid`. Returns null if no match. If `kid`
 * is undefined and the set contains exactly ONE usable signing key,
 * we return that key (matches the OIDC spec's fallback behaviour).
 */
export function findJwkByKid(
  jwks: JsonWebKeySet,
  kid: string | undefined,
): JsonWebKey | null {
  if (!jwks || !Array.isArray(jwks.keys)) return null;
  if (kid) {
    return jwks.keys.find((k) => k.kid === kid) ?? null;
  }
  const signingKeys = jwks.keys.filter(
    (k) => (k.use === "sig" || !k.use) && (k.kty === "RSA" || k.kty === "EC"),
  );
  return signingKeys.length === 1 ? signingKeys[0] : null;
}

// Re-export so callers don't need a second import.
export { base64UrlToBytes, toArrayBuffer };
