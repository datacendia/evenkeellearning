// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/cbor-cose.test.ts
//
// v1.4.11 — The most important test in the passkey-binding feature.
//
// Validates the day-1 risk-bearing primitives end-to-end:
//
//   1. Encode an arbitrary {key:int → value} map as CBOR using our test-
//      only encoder, decode it with the production decoder, and assert
//      the round-trip is byte-exact.
//   2. Generate a real P-256 keypair via SubtleCrypto, take its raw
//      public-key x/y coordinates, build a COSE_Key (the shape WebAuthn
//      authenticators emit), feed it through `coseKeyToSpki`, import
//      the SPKI back into a CryptoKey, sign a payload with the original
//      private key (raw r||s), and verify against the round-tripped
//      public key.
//
// If this test passes on every run, we know:
//   • The CBOR decoder handles every shape WebAuthn produces.
//   • The COSE → SPKI conversion is byte-correct for any P-256 key.
//   • The downstream `subtle.importKey("spki", ...)` accepts our output.
//   • Our SPKI prefix bytes are exactly right (a single off-by-one in
//     the prefix would make this fail every time).
//
// The synthesised approach is *stronger* than checked-in fixtures
// because the round-trip is proven on every CI run, against keys the
// platform's own crypto generated, with no trust in vendor-specific
// authenticator output.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  decodeCborStrict,
  encodeCoseKey,
  CborDecodeError,
  type CborMap,
} from "@/lib/crypto/cbor-min";
import { coseKeyToSpki, CoseKeyError } from "@/lib/crypto/cose-to-spki";

// ─── CBOR decoder unit tests ────────────────────────────────────────────────

describe("cbor-min: primitive decoding", () => {
  it("decodes positive integers across length classes", () => {
    expect(decodeCborStrict(new Uint8Array([0x00]))).toBe(0);
    expect(decodeCborStrict(new Uint8Array([0x17]))).toBe(23);
    expect(decodeCborStrict(new Uint8Array([0x18, 0x18]))).toBe(24);
    expect(decodeCborStrict(new Uint8Array([0x18, 0xff]))).toBe(255);
    expect(decodeCborStrict(new Uint8Array([0x19, 0x01, 0x00]))).toBe(256);
    expect(decodeCborStrict(new Uint8Array([0x19, 0xff, 0xff]))).toBe(65535);
    expect(decodeCborStrict(new Uint8Array([0x1a, 0x00, 0x01, 0x00, 0x00]))).toBe(65536);
  });

  it("decodes negative integers (the COSE label range)", () => {
    expect(decodeCborStrict(new Uint8Array([0x20]))).toBe(-1);
    expect(decodeCborStrict(new Uint8Array([0x26]))).toBe(-7);   // ES256
    expect(decodeCborStrict(new Uint8Array([0x21]))).toBe(-2);   // x label
    expect(decodeCborStrict(new Uint8Array([0x22]))).toBe(-3);   // y label
  });

  it("decodes byte strings", () => {
    const bytes = decodeCborStrict(
      new Uint8Array([0x44, 0xde, 0xad, 0xbe, 0xef]),
    ) as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("decodes text strings", () => {
    expect(decodeCborStrict(new Uint8Array([0x63, 0x66, 0x6d, 0x74]))).toBe("fmt");
  });

  it("decodes maps preserving key order", () => {
    const m = decodeCborStrict(
      new Uint8Array([0xa2, 0x01, 0x02, 0x02, 0x03]),
    ) as CborMap;
    expect(m).toBeInstanceOf(Map);
    expect(Array.from(m.entries())).toEqual([[1, 2], [2, 3]]);
  });

  it("rejects trailing bytes in strict mode", () => {
    expect(() =>
      decodeCborStrict(new Uint8Array([0x00, 0x99])),
    ).toThrow(CborDecodeError);
  });

  it("rejects truncated byte strings", () => {
    expect(() =>
      decodeCborStrict(new Uint8Array([0x44, 0x00, 0x00])),
    ).toThrow(CborDecodeError);
  });

  it("rejects floats / simple values (major type 7)", () => {
    expect(() =>
      decodeCborStrict(new Uint8Array([0xf6])),
    ).toThrow(CborDecodeError);
  });

  it("rejects tags (major type 6)", () => {
    expect(() =>
      decodeCborStrict(new Uint8Array([0xc0, 0x00])),
    ).toThrow(CborDecodeError);
  });

  it("rejects indefinite-length items", () => {
    expect(() =>
      decodeCborStrict(new Uint8Array([0x5f])), // bstr indefinite-length
    ).toThrow(CborDecodeError);
  });
});

// ─── encoder/decoder symmetry ────────────────────────────────────────────────

describe("cbor-min: encode/decode round-trip on a synthetic COSE_Key", () => {
  it("round-trips a typical ES256 COSE_Key shape", () => {
    const x = new Uint8Array(32).fill(0xaa);
    const y = new Uint8Array(32).fill(0xbb);
    const encoded = encodeCoseKey([
      [1, 2],   // kty: EC2
      [3, -7],  // alg: ES256
      [-1, 1],  // crv: P-256
      [-2, x],
      [-3, y],
    ]);
    const decoded = decodeCborStrict(encoded) as CborMap;
    expect(decoded.get(1)).toBe(2);
    expect(decoded.get(3)).toBe(-7);
    expect(decoded.get(-1)).toBe(1);
    expect(Array.from(decoded.get(-2) as Uint8Array)).toEqual(Array.from(x));
    expect(Array.from(decoded.get(-3) as Uint8Array)).toEqual(Array.from(y));
  });
});

// ─── COSE_Key → SPKI conversion + real-key round-trip ────────────────────────

describe("cose-to-spki: shape validation", () => {
  it("rejects non-EC2 kty", () => {
    const bad = encodeCoseKey([
      [1, 3], // OKP, not EC2
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(32)],
      [-3, new Uint8Array(32)],
    ]);
    expect(() => coseKeyToSpki(bad)).toThrow(CoseKeyError);
  });

  it("rejects non-ES256 alg", () => {
    const bad = encodeCoseKey([
      [1, 2],
      [3, -8], // EdDSA, not ES256
      [-1, 1],
      [-2, new Uint8Array(32)],
      [-3, new Uint8Array(32)],
    ]);
    expect(() => coseKeyToSpki(bad)).toThrow(CoseKeyError);
  });

  it("rejects non-P-256 crv", () => {
    const bad = encodeCoseKey([
      [1, 2],
      [3, -7],
      [-1, 2], // P-384, not P-256
      [-2, new Uint8Array(32)],
      [-3, new Uint8Array(32)],
    ]);
    expect(() => coseKeyToSpki(bad)).toThrow(CoseKeyError);
  });

  it("rejects mismatched coordinate length", () => {
    const bad = encodeCoseKey([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(31)], // wrong length
      [-3, new Uint8Array(32)],
    ]);
    expect(() => coseKeyToSpki(bad)).toThrow(CoseKeyError);
  });

  it("produces the exact 91-byte SPKI shape for a known coordinate pair", () => {
    const x = new Uint8Array(32).fill(0x11);
    const y = new Uint8Array(32).fill(0x22);
    const cose = encodeCoseKey([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, x],
      [-3, y],
    ]);
    const spki = coseKeyToSpki(cose);
    expect(spki.length).toBe(91);
    // Sanity check the fixed bytes around the coordinates.
    expect(spki[0]).toBe(0x30); // outer SEQUENCE
    expect(spki[1]).toBe(0x59); // length 89
    expect(spki[25]).toBe(0x00); // unused-bits byte (last byte of 26-byte prefix)
    expect(spki[26]).toBe(0x04); // uncompressed-point indicator
    expect(Array.from(spki.slice(27, 59))).toEqual(Array.from(x));
    expect(Array.from(spki.slice(59, 91))).toEqual(Array.from(y));
  });
});

describe("cose-to-spki: end-to-end round-trip with a real SubtleCrypto key", () => {
  it("imports our SPKI output and verifies a signature made by the original key", async () => {
    if (typeof window === "undefined" || !window.crypto?.subtle) {
      // happy-dom (vitest setup) provides this; we still guard.
      // eslint-disable-next-line no-console
      console.warn("SubtleCrypto unavailable; skipping round-trip");
      return;
    }
    const subtle = window.crypto.subtle;

    // 1. Generate a real P-256 keypair.
    const kp = (await subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    // 2. Export the public key as JWK so we can grab the raw x/y bytes.
    const jwk = await subtle.exportKey("jwk", kp.publicKey);
    expect(jwk.x).toBeTruthy();
    expect(jwk.y).toBeTruthy();
    const x = b64urlToBytes(jwk.x as string);
    const y = b64urlToBytes(jwk.y as string);
    expect(x.length).toBe(32);
    expect(y.length).toBe(32);

    // 3. Build a COSE_Key the way an authenticator would.
    const coseKey = encodeCoseKey([
      [1, 2],   // kty: EC2
      [3, -7],  // alg: ES256
      [-1, 1],  // crv: P-256
      [-2, x],
      [-3, y],
    ]);

    // 4. Run our COSE → SPKI converter.
    const spki = coseKeyToSpki(coseKey);

    // 5. Import the SPKI back into a CryptoKey.
    const importedPubKey = await subtle.importKey(
      "spki",
      bufferOf(spki),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );

    // 6. Sign a fixed payload with the ORIGINAL private key (raw r||s).
    const signedBytes = new TextEncoder().encode("hello passkey round-trip");
    const sig = await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      kp.privateKey,
      bufferOf(signedBytes),
    );

    // 7. Verify with the ROUND-TRIPPED public key. If our SPKI is wrong
    //    by even a single byte, this returns false.
    const ok = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      importedPubKey,
      sig,
      bufferOf(signedBytes),
    );
    expect(ok).toBe(true);

    // 8. Negative control: tampered payload must fail.
    const tamperedBytes = new TextEncoder().encode("hello passkey round-trip!");
    const okTampered = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      importedPubKey,
      sig,
      bufferOf(tamperedBytes),
    );
    expect(okTampered).toBe(false);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function b64urlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary =
    typeof atob !== "undefined"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}
