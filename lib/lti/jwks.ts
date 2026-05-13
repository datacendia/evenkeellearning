// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/jwks.ts
//
// v1.8.0 — JWK Set helpers for the LTI 1.3 launch handler.
//
// PURPOSE
// ───────
// LTI 1.3 has the LMS sign its `id_token` with a key whose JWK is
// published at the platform's `jwks_uri`. This module converts the
// `kty: "RSA"` (mandatory in LTI Core) and `kty: "EC"` (optional)
// public-key entries into Web Crypto `CryptoKey` instances suitable
// for `crypto.subtle.verify`.
//
// SCOPE
// ─────
// Pure transformations only. No fetching, no caching, no LTI claim
// validation. Higher layers handle network I/O.
//
// SUPPORTED ALGORITHMS
// ────────────────────
//   • RS256 — RSASSA-PKCS1-v1_5 with SHA-256. LTI Core mandatory.
//   • RS384 — same family, SHA-384. Rare but spec-legal.
//   • RS512 — same family, SHA-512. Rare but spec-legal.
//   • ES256 — ECDSA-P256-SHA256. Same curve we use for issuer keys.
//
// We REFUSE to import any other algorithm here — better to fail loud
// than silently downgrade to an algorithm we can't verify.
// ─────────────────────────────────────────────────────────────────────────────

import { base64UrlToBytes, toArrayBuffer } from "@/lib/crypto/base64url";

/**
 * Subset of a JWK relevant to LTI signature verification. The full
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

/** A JWK Set (JWKS) as published at a platform's `jwks_uri`. */
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

/** Supported algorithms for `algForKey` and `verifyParamsFor`. */
export type SupportedLtiAlgorithm = "RS256" | "RS384" | "RS512" | "ES256";

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
  alg: SupportedLtiAlgorithm,
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
  alg: SupportedLtiAlgorithm,
): EcdsaParams | { name: "RSASSA-PKCS1-v1_5" } {
  if (alg === "ES256") {
    return { name: "ECDSA", hash: { name: "SHA-256" } };
  }
  return { name: "RSASSA-PKCS1-v1_5" };
}

/** Return the supported-algorithm tag for a JWK, or null if unsupported. */
export function algForJwk(jwk: JsonWebKey): SupportedLtiAlgorithm | null {
  // Prefer the explicit `alg` field when present; otherwise infer.
  if (jwk.alg === "RS256" || jwk.alg === "RS384" || jwk.alg === "RS512") {
    return jwk.alg;
  }
  if (jwk.alg === "ES256") return "ES256";
  if (jwk.kty === "RSA") return "RS256"; // LTI default
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
  | { ok: true; key: CryptoKey; algorithm: SupportedLtiAlgorithm }
  | { ok: false; reason: JwkImportFailure }
> {
  if (!jwk.kty || typeof jwk.kty !== "string") {
    return { ok: false, reason: "missing_kty" };
  }

  // Check kty + per-kty field validity FIRST so error reporting is
  // specific (unsupported_curve, missing_rsa_n, etc.) before falling
  // back to the generic unsupported_alg.
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
    // Web Crypto `importKey` accepts JWKs natively.
    const key = await crypto.subtle.importKey(
      "jwk",
      // We pass a clone with only the fields Web Crypto cares about so
      // unrelated extension fields can't trip an implementation up.
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
