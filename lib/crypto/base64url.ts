// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/base64url.ts
//
// Tiny, dependency-free base64url helpers. Extracted from
// `lib/crypto/signing.ts` in v1.6.0 so that modules which don't need the
// full ECDSA stack (e.g. `lib/auth/server-session.ts`, which runs in the
// Edge middleware) can import only these primitives.
//
// All three helpers are sync, pure, and Edge-runtime-safe — no Buffer on
// the hot path; we fall back to Node's Buffer only when btoa/atob are
// unavailable (i.e. Node <16, which we do not support for runtime).
// ─────────────────────────────────────────────────────────────────────────────

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(input: string): Uint8Array {
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

/**
 * Copy a Uint8Array into a fresh ArrayBuffer. SubtleCrypto on some
 * runtimes rejects Uint8Array views whose underlying buffer is a
 * SharedArrayBuffer, so callers that hand bytes to `crypto.subtle.*`
 * should pass them through here first.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}
