// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/status-list.ts
//
// v1.7.1 — W3C StatusList2021 primitives.
//
// What this module does
// ─────────────────────
// Pure helpers for building the bitstring that backs a `StatusList2021`
// credential, the inline `credentialStatus` block embedded into each
// issued VC, and the (unsigned) `StatusList2021Credential` document.
//
// Spec reference
// ──────────────
//   W3C "Status List 2021" — https://www.w3.org/TR/2023/WD-vc-status-list-20230427/
//   (The successor draft is "Bitstring Status List"; the wire format is
//   identical for our purposes — gzip-compressed bitstring, base64url.)
//
// Bit ordering
// ────────────
// Index 0 is the MOST-SIGNIFICANT bit of the FIRST byte. So bit i lives at
// byte (i >> 3), mask (1 << (7 - (i & 7))). This matches the spec's
// reference encoder/decoder. A verifier that uses the opposite convention
// would read every bit at the wrong position; tested explicitly below.
//
// Privacy minimum
// ───────────────
// The spec recommends a MINIMUM of 131,072 bits (16 KB uncompressed) so
// that revoking a single credential does not measurably change the
// distribution of revoked-vs-non-revoked bits in any practical sense.
// We default to that and let callers grow it.
//
// Gzip via Web Streams
// ────────────────────
// Encoding/decoding uses `CompressionStream("gzip")` /
// `DecompressionStream("gzip")`, available in Node 18+ and modern
// browsers. We do NOT depend on `pako` or `zlib` — staying on web-platform
// APIs keeps the verifier identical between Node and browser.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Constants ─────────────────────────────────────────────────────────────

/** Minimum bitstring size recommended by the spec (16 KB, 131,072 bits). */
export const STATUS_LIST_MIN_BITS = 131_072 as const;

/** Type tag emitted on the inline `credentialStatus` block. */
export const STATUS_LIST_ENTRY_TYPE = "StatusList2021Entry" as const;

/** Type tag emitted on the StatusList2021Credential's credentialSubject. */
export const STATUS_LIST_SUBJECT_TYPE = "StatusList2021" as const;

/** Top-level type added alongside `VerifiableCredential` for the list cred. */
export const STATUS_LIST_CREDENTIAL_TYPE = "StatusList2021Credential" as const;

/** Allowed values of `statusPurpose`. */
export type StatusPurpose = "revocation" | "suspension";

// ─── Bitstring helpers (pure, sync) ────────────────────────────────────────

/**
 * Allocate an all-zero bitstring of `bits` bits. `bits` must be a positive
 * multiple of 8. Returns the raw byte buffer.
 */
export function allocBitstring(bits: number): Uint8Array {
  if (!Number.isInteger(bits) || bits <= 0 || bits % 8 !== 0) {
    throw new Error("bits must be a positive multiple of 8");
  }
  return new Uint8Array(bits >> 3);
}

/** Read a bit (0 or 1) at index `i` from the raw bitstring. */
export function getBit(bitstring: Uint8Array, i: number): 0 | 1 {
  if (i < 0 || i >= bitstring.length * 8) {
    throw new Error(`status_index_out_of_range:${i}`);
  }
  const byte = bitstring[i >> 3]!;
  const mask = 1 << (7 - (i & 7));
  return (byte & mask) === 0 ? 0 : 1;
}

/** Set the bit at index `i` to `value` (0 or 1) IN PLACE. */
export function setBit(
  bitstring: Uint8Array,
  i: number,
  value: 0 | 1,
): void {
  if (i < 0 || i >= bitstring.length * 8) {
    throw new Error(`status_index_out_of_range:${i}`);
  }
  const byteIdx = i >> 3;
  const mask = 1 << (7 - (i & 7));
  if (value === 1) bitstring[byteIdx]! |= mask;
  else bitstring[byteIdx]! &= ~mask;
}

// ─── Gzip + base64url codec (async) ────────────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function streamThrough(
  bytes: Uint8Array,
  transform: TransformStream<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Swallow rejections from write/close; the read loop below will surface
  // the same error through `reader.read()` and we want a single error
  // path. Without these handlers, the rejection bubbles up as an
  // "unhandled rejection" and crashes the test runner.
  const writePromise = writer.write(bytes).catch(() => {});
  const closePromise = writer.close().catch(() => {});
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    // Make sure the writer-side promises settle so they don't outlive us.
    await writePromise;
    await closePromise;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Encode a raw bitstring into the `encodedList` field per the spec:
 * gzip-compress, then base64url. Async because gzip uses Web Streams.
 */
export async function encodeBitstring(bitstring: Uint8Array): Promise<string> {
  const compressed = await streamThrough(
    bitstring,
    new (globalThis as { CompressionStream: typeof CompressionStream }).CompressionStream(
      "gzip",
    ) as unknown as TransformStream<Uint8Array, Uint8Array>,
  );
  return bytesToBase64Url(compressed);
}

/**
 * Decode an `encodedList` string back to the raw bitstring. Async.
 * Throws `bad_encoded_list` if base64url is malformed or gzip is invalid.
 */
export async function decodeBitstring(encodedList: string): Promise<Uint8Array> {
  let compressed: Uint8Array;
  try {
    compressed = base64UrlToBytes(encodedList);
  } catch {
    throw new Error("bad_encoded_list");
  }
  try {
    return await streamThrough(
      compressed,
      new (globalThis as { DecompressionStream: typeof DecompressionStream }).DecompressionStream(
        "gzip",
      ) as unknown as TransformStream<Uint8Array, Uint8Array>,
    );
  } catch {
    throw new Error("bad_encoded_list");
  }
}

/**
 * Convenience: read the bit at a status-list index from an encoded list.
 * Async because it has to gunzip first.
 */
export async function getStatusAtIndex(
  encodedList: string,
  index: number,
): Promise<0 | 1> {
  const bits = await decodeBitstring(encodedList);
  return getBit(bits, index);
}

/**
 * Convenience: produce a NEW encoded list with the bit at `index` flipped
 * to `value`. Does not mutate the caller's input.
 */
export async function withStatusAtIndex(
  encodedList: string,
  index: number,
  value: 0 | 1,
): Promise<string> {
  const bits = await decodeBitstring(encodedList);
  setBit(bits, index, value);
  return encodeBitstring(bits);
}

/**
 * Convenience: empty list of `bits` bits, encoded.
 */
export async function createEmptyEncodedList(
  bits: number = STATUS_LIST_MIN_BITS,
): Promise<string> {
  return encodeBitstring(allocBitstring(bits));
}

// ─── Inline credentialStatus block (sync) ──────────────────────────────────

/**
 * The inline `credentialStatus` block embedded into a VC at issuance.
 * Pointed at a position inside the issuer's StatusList2021Credential.
 */
export interface StatusList2021Entry {
  /** Stable URL with a fragment, e.g. `https://issuer.example/sl/1#42`. */
  id: string;
  type: typeof STATUS_LIST_ENTRY_TYPE;
  statusPurpose: StatusPurpose;
  /** Index encoded as a string per spec (so it survives JSON-LD without
   *  losing precision for very large indices). */
  statusListIndex: string;
  /** URL of the StatusList2021Credential. */
  statusListCredential: string;
}

export interface BuildStatusEntryInput {
  statusListCredential: string;
  statusListIndex: number;
  statusPurpose?: StatusPurpose;
}

export function buildStatusEntry(input: BuildStatusEntryInput): StatusList2021Entry {
  if (!Number.isInteger(input.statusListIndex) || input.statusListIndex < 0) {
    throw new Error("statusListIndex must be a non-negative integer");
  }
  if (!input.statusListCredential.startsWith("http")) {
    throw new Error("statusListCredential must be an http(s) URL");
  }
  const purpose: StatusPurpose = input.statusPurpose ?? "revocation";
  return {
    id: `${input.statusListCredential}#${input.statusListIndex}`,
    type: STATUS_LIST_ENTRY_TYPE,
    statusPurpose: purpose,
    statusListIndex: String(input.statusListIndex),
    statusListCredential: input.statusListCredential,
  };
}

// ─── StatusList2021Credential body (unsigned) ──────────────────────────────

export interface StatusListCredentialSubject {
  id: string;
  type: typeof STATUS_LIST_SUBJECT_TYPE;
  statusPurpose: StatusPurpose;
  encodedList: string;
}

export interface UnsignedStatusListCredential {
  "@context": [string, ...string[]];
  id: string;
  type: ["VerifiableCredential", typeof STATUS_LIST_CREDENTIAL_TYPE];
  issuer: string;
  validFrom: string;
  credentialSubject: StatusListCredentialSubject;
}

export interface BuildStatusListCredentialInput {
  /** Stable URL of THIS list, e.g. `https://issuer.example/sl/1`. */
  id: string;
  issuerDid: string;
  validFromIso: string;
  encodedList: string;
  statusPurpose?: StatusPurpose;
  /** Optional extra @context entries. The first is always VC v2. */
  extraContexts?: string[];
}

/**
 * Build (but do not sign) a StatusList2021Credential. The issuer is
 * expected to wrap this with the same Data Integrity proof used for
 * regular VCs, so a verifier can authenticate the list itself.
 */
export function buildStatusListCredential(
  input: BuildStatusListCredentialInput,
): UnsignedStatusListCredential {
  if (!input.id.startsWith("http")) {
    throw new Error("status list id must be an http(s) URL");
  }
  if (!input.issuerDid) {
    throw new Error("issuerDid required");
  }
  if (!input.validFromIso) {
    throw new Error("validFromIso required");
  }
  if (!input.encodedList) {
    throw new Error("encodedList required");
  }
  const purpose: StatusPurpose = input.statusPurpose ?? "revocation";
  const contexts: [string, ...string[]] = [
    "https://www.w3.org/ns/credentials/v2",
    ...(input.extraContexts ?? []),
  ];
  return {
    "@context": contexts,
    id: input.id,
    type: ["VerifiableCredential", STATUS_LIST_CREDENTIAL_TYPE],
    issuer: input.issuerDid,
    validFrom: input.validFromIso,
    credentialSubject: {
      id: `${input.id}#list`,
      type: STATUS_LIST_SUBJECT_TYPE,
      statusPurpose: purpose,
      encodedList: input.encodedList,
    },
  };
}
