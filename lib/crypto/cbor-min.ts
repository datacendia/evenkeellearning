// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/cbor-min.ts
//
// v1.4.11 — A *minimal* CBOR decoder, scoped to exactly what WebAuthn
// produces and nothing more.
//
// Why hand-rolled instead of `cbor-x` or similar?
// ──────────────────────────────────────────────
// WebAuthn's attestation object and credentialPublicKey use a tiny,
// well-defined subset of CBOR (RFC 8949 / RFC 7049):
//   • Major type 0 — unsigned integer (key labels, signCount, etc.)
//   • Major type 1 — negative integer (COSE alg = -7, crv = -1 etc.)
//   • Major type 2 — byte string (rpIdHash, credentialId, x/y coords)
//   • Major type 3 — text string (the attestationObject `fmt` field)
//   • Major type 4 — array (rare, but appears in some attStmt shapes)
//   • Major type 5 — map (top-level attestationObject, COSE_Key)
//
// We never see floats, tags, indefinite-length items, or 64-bit ints in
// practice. By scoping the decoder to that subset (~150 lines, no
// external dependency, total surface auditable on two screens), we keep
// the cryptographic-adjacent code path inspectable by anyone reading
// HONESTY.md without pulling in a 12-30 KB dep.
//
// API contract
// ────────────
// `decodeCbor(bytes)` returns a `{ value, bytesRead }` pair so callers
// that need to consume only a prefix (e.g. parsing CBOR embedded inside
// authenticatorData) can do so safely. `decodeCborStrict(bytes)` is the
// convenience for "I expect the entire buffer to be one CBOR item."
//
// Errors
// ──────
// Every malformed input throws `CborDecodeError` with a precise reason.
// Callers in `lib/crypto/cose-to-spki.ts` and `lib/crypto/passkey.ts`
// catch this and surface a sanitised "passkey credential malformed"
// message to the UI — never the raw bytes.
// ─────────────────────────────────────────────────────────────────────────────

/** Anything our subset of CBOR can produce. */
export type CborValue =
  | number          // ints up to ±2^53-1
  | bigint          // ints beyond Number.MAX_SAFE_INTEGER (rare; supported for completeness)
  | Uint8Array      // major type 2 (byte string)
  | string          // major type 3 (text string)
  | CborValue[]     // major type 4 (array)
  | CborMap;        // major type 5 (map) — keys can be int or string

/** A CBOR map is order-preserving (real CBOR maps are), so we use a Map. */
export type CborMap = Map<number | string, CborValue>;

/** Thrown by every decoder failure path. */
export class CborDecodeError extends Error {
  constructor(reason: string, public readonly offset?: number) {
    super(`CBOR decode error at offset ${offset ?? "?"}: ${reason}`);
    this.name = "CborDecodeError";
  }
}

/**
 * Decode a single CBOR item starting at offset 0 of `bytes`. Returns the
 * decoded value and the number of bytes consumed. Useful when the caller
 * needs to parse a prefix of a larger buffer.
 */
export function decodeCbor(bytes: Uint8Array): { value: CborValue; bytesRead: number } {
  if (bytes.length === 0) throw new CborDecodeError("empty input", 0);
  const ctx = { buf: bytes, pos: 0 };
  const value = readItem(ctx);
  return { value, bytesRead: ctx.pos };
}

/**
 * Decode a CBOR item that is expected to span the entire buffer. Throws
 * if there are trailing bytes — that catches truncation mistakes.
 */
export function decodeCborStrict(bytes: Uint8Array): CborValue {
  const { value, bytesRead } = decodeCbor(bytes);
  if (bytesRead !== bytes.length) {
    throw new CborDecodeError(
      `expected exactly ${bytes.length} bytes, decoded ${bytesRead} (${
        bytes.length - bytesRead
      } trailing)`,
      bytesRead,
    );
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

interface Cursor {
  buf: Uint8Array;
  pos: number;
}

function readItem(ctx: Cursor): CborValue {
  const initialByte = readByte(ctx);
  const majorType = initialByte >> 5;        // top 3 bits
  const additionalInfo = initialByte & 0x1f; // low 5 bits
  const argument = readArgument(ctx, additionalInfo);

  switch (majorType) {
    case 0: // unsigned int
      return argument;
    case 1: // negative int — value is -1 - argument
      // For our use (COSE labels) the argument fits comfortably in a
      // Number; if it ever grows we promote to BigInt below.
      if (typeof argument === "bigint") return -1n - argument;
      return -1 - argument;
    case 2: // byte string
      return readBytes(ctx, toLength(argument, ctx.pos));
    case 3: // text string
      return new TextDecoder("utf-8", { fatal: true }).decode(
        readBytes(ctx, toLength(argument, ctx.pos)),
      );
    case 4: {
      // array
      const len = toLength(argument, ctx.pos);
      const arr: CborValue[] = [];
      for (let i = 0; i < len; i++) arr.push(readItem(ctx));
      return arr;
    }
    case 5: {
      // map
      const len = toLength(argument, ctx.pos);
      const map: CborMap = new Map();
      for (let i = 0; i < len; i++) {
        const key = readItem(ctx);
        if (typeof key !== "number" && typeof key !== "string") {
          throw new CborDecodeError(
            `unsupported map-key type (only int and text-string are accepted)`,
            ctx.pos,
          );
        }
        const value = readItem(ctx);
        map.set(key, value);
      }
      return map;
    }
    case 6:
      throw new CborDecodeError("CBOR tags are not supported in this subset", ctx.pos);
    case 7:
      throw new CborDecodeError(
        "floats / simple values are not supported in this subset",
        ctx.pos,
      );
    default:
      // unreachable — major type is 3 bits
      throw new CborDecodeError(`unknown major type ${majorType}`, ctx.pos);
  }
}

function readByte(ctx: Cursor): number {
  if (ctx.pos >= ctx.buf.length) {
    throw new CborDecodeError("unexpected end of input", ctx.pos);
  }
  return ctx.buf[ctx.pos++]!;
}

function readBytes(ctx: Cursor, n: number): Uint8Array {
  if (ctx.pos + n > ctx.buf.length) {
    throw new CborDecodeError(
      `unexpected end of input (wanted ${n} bytes)`,
      ctx.pos,
    );
  }
  const slice = ctx.buf.slice(ctx.pos, ctx.pos + n);
  ctx.pos += n;
  return slice;
}

/**
 * Reads the "argument" of a CBOR item header: either the literal value
 * 0..23 from the additional-info bits, or the 1/2/4/8 bytes that follow.
 * Returns a Number when safe (≤ 2^53-1) or a BigInt otherwise.
 */
function readArgument(ctx: Cursor, info: number): number | bigint {
  if (info < 24) return info;
  if (info === 24) return readByte(ctx);
  if (info === 25) {
    const a = readByte(ctx);
    const b = readByte(ctx);
    return (a << 8) | b;
  }
  if (info === 26) {
    const a = readByte(ctx);
    const b = readByte(ctx);
    const c = readByte(ctx);
    const d = readByte(ctx);
    // unsigned right-shift to keep Number positive on the high bit
    return (a * 0x1000000 + ((b << 16) | (c << 8) | d)) >>> 0;
  }
  if (info === 27) {
    // 64-bit. Promote to BigInt to be safe; we'll error in `toLength`
    // if a length doesn't fit in a Number.
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(readByte(ctx));
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }
  // 28..30 reserved; 31 = indefinite length (not in our subset).
  throw new CborDecodeError(
    `unsupported additional-info value ${info} (indefinite-length / reserved)`,
    ctx.pos,
  );
}

/** Convert a CBOR argument to a non-negative array/string/map length. */
function toLength(arg: number | bigint, offset: number): number {
  if (typeof arg === "bigint") {
    throw new CborDecodeError(`length value too large for this decoder`, offset);
  }
  if (!Number.isInteger(arg) || arg < 0) {
    throw new CborDecodeError(`invalid length ${arg}`, offset);
  }
  return arg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encoder — small, only used to *generate* test fixtures. Production code
// never round-trips through it. Intentionally not exported by the index.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode a CBOR map whose keys are ints. Used by tests to build a
 * synthetic COSE_Key for a generated P-256 key. NOT used at runtime.
 *
 * Limited to: ints (positive and small negatives down to -24), byte
 * strings up to 2^16-1 bytes, and one nesting level. That is exactly
 * what a COSE_Key for ES256 needs.
 */
export function encodeCoseKey(entries: Array<[number, number | Uint8Array]>): Uint8Array {
  const parts: number[] = [];
  // map header
  parts.push(0xa0 | entries.length); // 0xa0 = major type 5, info = length (≤23)
  if (entries.length > 23) {
    throw new Error("encodeCoseKey: too many entries for compact form");
  }
  for (const [key, value] of entries) {
    // key (int)
    if (key >= 0) {
      pushInt(parts, 0, key);
    } else {
      pushInt(parts, 1, -1 - key);
    }
    // value
    if (typeof value === "number") {
      if (value >= 0) {
        pushInt(parts, 0, value);
      } else {
        pushInt(parts, 1, -1 - value);
      }
    } else {
      pushBstr(parts, value);
    }
  }
  return new Uint8Array(parts);
}

function pushInt(out: number[], majorType: number, n: number): void {
  const tag = majorType << 5;
  if (n < 24) {
    out.push(tag | n);
  } else if (n < 0x100) {
    out.push(tag | 24, n);
  } else if (n < 0x10000) {
    out.push(tag | 25, (n >> 8) & 0xff, n & 0xff);
  } else {
    out.push(
      tag | 26,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff,
    );
  }
}

function pushBstr(out: number[], bytes: Uint8Array): void {
  pushInt(out, 2, bytes.length);
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
}
