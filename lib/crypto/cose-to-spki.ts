// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/cose-to-spki.ts
//
// v1.4.11 — Convert a COSE_Key (the public-key shape produced by a
// WebAuthn credential) into a SubjectPublicKeyInfo DER blob suitable
// for `SubtleCrypto.importKey("spki", ...)`.
//
// We only support:
//   • EC2 (kty = 2)
//   • P-256 (crv = 1)
//   • ES256 (alg = -7)
//
// That is exactly what `pubKeyCredParams: [{type: "public-key", alg: -7}]`
// requests at enrolment time, which is what we send. Any other shape
// throws — better to fail loudly than to silently mis-import a key the
// verifier will then reject anyway.
//
// SPKI shape for P-256
// ────────────────────
// The output is a fixed 91-byte DER blob:
//
//   SEQUENCE (89 bytes total contents)
//     SEQUENCE (19 bytes — AlgorithmIdentifier)
//       OID 1.2.840.10045.2.1   id-ecPublicKey
//       OID 1.2.840.10045.3.1.7 prime256v1
//     BIT STRING (66 bytes contents = 1 unused-bits byte + 65 key bytes)
//       0x00                    (zero unused bits)
//       0x04                    (uncompressed point indicator)
//       <32-byte X coordinate>
//       <32-byte Y coordinate>
//
// The prefix is identical for every P-256 key we encode, so we ship it
// as a constant byte string and append the X || Y coordinates.
// ─────────────────────────────────────────────────────────────────────────────

import { decodeCborStrict, type CborMap, CborDecodeError } from "./cbor-min";

/** COSE_Key label constants per RFC 8152 + RFC 8230. */
const COSE_LABEL_KTY = 1;
const COSE_LABEL_ALG = 3;
const COSE_LABEL_CRV = -1;
const COSE_LABEL_X = -2;
const COSE_LABEL_Y = -3;

const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;

/**
 * 26-byte fixed prefix for the P-256 SPKI envelope. After this prefix
 * we append `0x04 || X(32) || Y(32)` — 65 bytes — yielding a 91-byte
 * SPKI total.
 */
const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59,                                           // SEQUENCE 89
    0x30, 0x13,                                         //   SEQUENCE 19
      0x06, 0x07,                                       //     OID id-ecPublicKey
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
      0x06, 0x08,                                       //     OID prime256v1
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0x03, 0x42,                                         //   BIT STRING 66
      0x00,                                             //     0 unused bits
]);

export class CoseKeyError extends Error {
  constructor(reason: string) {
    super(`COSE_Key error: ${reason}`);
    this.name = "CoseKeyError";
  }
}

/**
 * Parse and validate a COSE_Key (raw CBOR bytes), returning the
 * { x, y } coordinate pair for the embedded P-256 public point.
 */
export function parseCoseKeyP256(coseKeyBytes: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  let raw;
  try {
    raw = decodeCborStrict(coseKeyBytes);
  } catch (e) {
    if (e instanceof CborDecodeError) throw new CoseKeyError(e.message);
    throw new CoseKeyError("could not decode CBOR");
  }
  if (!(raw instanceof Map)) {
    throw new CoseKeyError("expected a CBOR map at top level");
  }
  const m = raw as CborMap;

  const kty = m.get(COSE_LABEL_KTY);
  if (kty !== COSE_KTY_EC2) {
    throw new CoseKeyError(`unsupported kty (got ${String(kty)}, expected EC2 = 2)`);
  }
  const alg = m.get(COSE_LABEL_ALG);
  if (alg !== COSE_ALG_ES256) {
    throw new CoseKeyError(`unsupported alg (got ${String(alg)}, expected ES256 = -7)`);
  }
  const crv = m.get(COSE_LABEL_CRV);
  if (crv !== COSE_CRV_P256) {
    throw new CoseKeyError(`unsupported crv (got ${String(crv)}, expected P-256 = 1)`);
  }
  const x = m.get(COSE_LABEL_X);
  const y = m.get(COSE_LABEL_Y);
  if (!(x instanceof Uint8Array) || x.length !== 32) {
    throw new CoseKeyError("x coordinate missing or not 32 bytes");
  }
  if (!(y instanceof Uint8Array) || y.length !== 32) {
    throw new CoseKeyError("y coordinate missing or not 32 bytes");
  }
  return { x, y };
}

/**
 * Convert a COSE_Key (CBOR bytes) into a 91-byte SPKI DER blob ready
 * for `SubtleCrypto.importKey("spki", spkiBytes, {name: "ECDSA",
 * namedCurve: "P-256"}, true, ["verify"])`.
 */
export function coseKeyToSpki(coseKeyBytes: Uint8Array): Uint8Array {
  const { x, y } = parseCoseKeyP256(coseKeyBytes);
  const out = new Uint8Array(P256_SPKI_PREFIX.length + 1 + 32 + 32);
  out.set(P256_SPKI_PREFIX, 0);
  out[P256_SPKI_PREFIX.length] = 0x04; // uncompressed point indicator
  out.set(x, P256_SPKI_PREFIX.length + 1);
  out.set(y, P256_SPKI_PREFIX.length + 1 + 32);
  return out;
}
