// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/passkey.ts
//
// v1.4.11 — WebAuthn passkey binding for signed envelopes.
//
// Plain-language summary
// ──────────────────────
// A "passkey" is a private key the user's device or password manager
// (iCloud Keychain, Google Password Manager, Windows Hello, hardware
// security key) creates and stores. The private key never leaves the
// device. The browser exposes a small API — `navigator.credentials` —
// that lets a website ask the device to sign a piece of data with that
// key, after the user authorises it (Touch ID, Windows Hello PIN, etc).
//
// Why we want this
// ────────────────
// Until v1.4.10, every signature in the app was made with a per-tab
// "session key" that lived only in memory. The signature proved the
// envelope hadn't been tampered with, but it did NOT prove WHO signed
// it — anyone running the app could produce signatures from a fresh
// session key on each page load. v1.4.11 binds signatures to a
// device-resident passkey, so a verifier can check that the signature
// was produced by the same passkey that was enrolled.
//
// What this module does (and only this)
// ─────────────────────────────────────
//   • `isPasskeySupported()` — feature-detect WebAuthn cleanly.
//   • `enrolPasskey()` — one-time `navigator.credentials.create` ceremony.
//     Stores `{credentialId, spkiB64url, enrolledAtIso}` in localStorage.
//   • `getEnrolment()` / `clearEnrolment()` — read + remove.
//   • `signPayloadWithPasskey(payload)` — runs an assertion ceremony
//     using SHA-256(canonical(payload)) as the WebAuthn challenge.
//     Returns a `SignedEnvelope<T>` with `keyType: "passkey-derived"`
//     and the WebAuthn `authenticatorData`/`clientDataJSON` attached so
//     a verifier can replay the signed bytes.
//   • `verifyPasskeyEnvelope(envelope)` — the verifier-side counterpart.
//     Used by `verifyEnvelope` in `signing.ts` when the envelope carries
//     a `webauthn` field.
//
// Honesty rules baked in
// ──────────────────────
//   • If WebAuthn is unsupported, every entry point throws a typed
//     `PasskeyError` with `code: "unsupported"`. Callers MUST surface
//     this — there is no silent fallback in this module. The
//     IssueReceiptCard UI handles fallback explicitly via separate
//     buttons.
//   • If the user cancels the OS prompt, we throw `code: "cancelled"`.
//     Same rule: no silent downgrade.
//   • Verification rejects any envelope whose `webauthn.clientDataJSON`
//     `challenge` does not equal SHA-256 of the canonical payload, OR
//     whose `clientDataJSON.type` is not "webauthn.get". This stops a
//     replay where someone splices an enrolment-time signature into an
//     issuance-time envelope.
//
// What this module does NOT do
// ────────────────────────────
//   • It does not verify the WebAuthn attestation chain. We accept
//     `attestation: "none"` credentials. Verifying manufacturer
//     attestation is meaningful for hardware-security-key audits but
//     adds complexity that isn't useful for a learner-facing flow.
//   • It does not promise cross-device passkey sync. Sync behaviour is
//     entirely up to the OS / password-manager the user picks.
//   • It does not authenticate identity to a server. v1.4.11 is fully
//     client-side — there is no backend to authenticate to.
// ─────────────────────────────────────────────────────────────────────────────

import { coseKeyToSpki, parseCoseKeyP256 } from "./cose-to-spki";
import { decodeCbor, decodeCborStrict, type CborMap } from "./cbor-min";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PasskeyErrorCode =
  | "unsupported"        // WebAuthn API not present in this browser
  | "cancelled"          // user denied / closed the OS prompt
  | "no_enrolment"       // signWithPasskey called with nothing enrolled
  | "ceremony_failed"    // any other navigator.credentials failure
  | "credential_invalid" // returned credential failed CBOR / COSE parse
  | "verify_failed";     // verifier rejected the assertion

export class PasskeyError extends Error {
  constructor(public readonly code: PasskeyErrorCode, message: string) {
    super(message);
    this.name = "PasskeyError";
  }
}

/** What we persist in localStorage after a successful enrolment. */
export interface PasskeyEnrolment {
  /** base64url(credentialId). Used to scope assertion ceremonies. */
  credentialIdB64url: string;
  /** base64url(SPKI(P-256 public key)) — feeds SubtleCrypto.importKey. */
  spkiB64url: string;
  /** Wall-clock enrolment time. */
  enrolledAtIso: string;
}

/** WebAuthn fields embedded in a passkey-signed envelope. */
export interface WebauthnAttestation {
  /** base64url credentialId of the passkey that signed. */
  credentialIdB64url: string;
  /** base64url authenticatorData bytes. */
  authenticatorDataB64url: string;
  /** base64url of the raw clientDataJSON UTF-8 bytes. */
  clientDataJsonB64url: string;
}

const STORAGE_KEY = "evenkeel.passkey.enrolment.v1";
const RP_ID = "evenkeel.local"; // honesty: any string works in self-RP mode
const RP_NAME = "Even Keel Learning";

// ─── Feature detection ───────────────────────────────────────────────────────

/**
 * True iff the current environment exposes the WebAuthn API. Returns
 * `false` cleanly on Node / SSR / older browsers — never throws.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined" &&
    typeof navigator.credentials.create === "function" &&
    typeof navigator.credentials.get === "function"
  );
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

export function getEnrolment(): PasskeyEnrolment | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PasskeyEnrolment>;
    if (
      typeof parsed.credentialIdB64url === "string" &&
      typeof parsed.spkiB64url === "string" &&
      typeof parsed.enrolledAtIso === "string"
    ) {
      return parsed as PasskeyEnrolment;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearEnrolment(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / privacy mode — ignore */
  }
  notifyEnrolment(null);
}

function persistEnrolment(e: PasskeyEnrolment): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
  } catch {
    /* quota / privacy mode — silently ignore; in-memory caller still sees the enrolment */
  }
  notifyEnrolment(e);
}

// ─── Subscriber API ──────────────────────────────────────────────────────────
//
// UI components (PasskeyEnrolCard, IssueReceiptCard, /receipt verifier)
// call `subscribePasskey()` so they re-render the moment a learner
// enrols or clears their passkey, without prop-drilling through the
// page tree.

type PasskeyListener = (e: PasskeyEnrolment | null) => void;
const listeners = new Set<PasskeyListener>();

function notifyEnrolment(e: PasskeyEnrolment | null): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      /* a bad subscriber must not poison the rest */
    }
  }
}

/** Subscribe to enrolment changes. Returns an unsubscribe function. */
export function subscribePasskey(fn: PasskeyListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ─── Dependency-injection seam (so tests can mock cleanly) ───────────────────

/**
 * Test seam. Production code never calls this; tests inject a fake
 * `navigator.credentials`-shaped object whose `create` and `get` return
 * canned PublicKeyCredential-shaped responses synthesised from a real
 * SubtleCrypto keypair.
 */
export interface CredentialsContainer {
  create(options: { publicKey: unknown }): Promise<unknown>;
  get(options: { publicKey: unknown }): Promise<unknown>;
}

let injectedCredentials: CredentialsContainer | null = null;

export function __setCredentialsForTesting(c: CredentialsContainer | null): void {
  injectedCredentials = c;
}

function credentials(): CredentialsContainer {
  if (injectedCredentials) return injectedCredentials;
  if (!isPasskeySupported()) {
    throw new PasskeyError("unsupported", "WebAuthn is not available in this browser");
  }
  return navigator.credentials as unknown as CredentialsContainer;
}

// ─── Base64URL helpers (kept local for self-containment) ─────────────────────

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function subtle(): SubtleCrypto {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new PasskeyError(
      "unsupported",
      "SubtleCrypto unavailable; passkey is browser-only",
    );
  }
  return window.crypto.subtle;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().digest("SHA-256", bufferOf(bytes));
  return new Uint8Array(out);
}

// ─── Canonical payload digest (matches signing.ts) ───────────────────────────

async function canonicalPayloadDigest(payload: unknown): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(JSON.stringify(payload)));
}

// ─── Authenticator-data parsing ──────────────────────────────────────────────

/**
 * Parse the binary `authenticatorData` blob produced by an authenticator.
 * For our purposes we need only the credentialId and credentialPublicKey
 * (when AT flag is set), which only happens during enrolment.
 *
 * Layout (binary, NOT CBOR):
 *   rpIdHash:        32 bytes
 *   flags:            1 byte   (UP=0x01, UV=0x04, AT=0x40, ED=0x80)
 *   signCount:        4 bytes  (big-endian uint32)
 *   if AT:
 *     aaguid:           16 bytes
 *     credIdLen:         2 bytes (big-endian uint16)
 *     credentialId:      <credIdLen> bytes
 *     credentialPubKey:  CBOR (consumes through end-of-buffer or up to ED block)
 */
export function parseAuthenticatorData(bytes: Uint8Array): {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  attested?: { aaguid: Uint8Array; credentialId: Uint8Array; coseKey: Uint8Array };
} {
  if (bytes.length < 37) {
    throw new PasskeyError(
      "credential_invalid",
      `authenticatorData too short (${bytes.length} bytes, need ≥37)`,
    );
  }
  const rpIdHash = bytes.slice(0, 32);
  const flags = bytes[32]!;
  const signCount =
    (bytes[33]! << 24) | (bytes[34]! << 16) | (bytes[35]! << 8) | bytes[36]!;

  const attestedFlag = (flags & 0x40) !== 0;
  if (!attestedFlag) {
    return { rpIdHash, flags, signCount };
  }

  if (bytes.length < 37 + 16 + 2) {
    throw new PasskeyError(
      "credential_invalid",
      "authenticatorData truncated before credentialId length",
    );
  }
  const aaguid = bytes.slice(37, 53);
  const credIdLen = (bytes[53]! << 8) | bytes[54]!;
  const credIdEnd = 55 + credIdLen;
  if (bytes.length < credIdEnd) {
    throw new PasskeyError(
      "credential_invalid",
      `authenticatorData truncated; credIdLen=${credIdLen}`,
    );
  }
  const credentialId = bytes.slice(55, credIdEnd);

  // The COSE_Key occupies the remainder until the ED block (which we
  // don't use). Since our subset rejects extension data anyway, we
  // attempt to decode the rest as a single CBOR map; any trailing
  // extension bytes will trigger the strict-mode trailing-byte error
  // and we fall back to a non-strict decode.
  const remaining = bytes.slice(credIdEnd);
  const coseKey = sliceFirstCborItem(remaining);
  return { rpIdHash, flags, signCount, attested: { aaguid, credentialId, coseKey } };
}

/**
 * Helper: returns the first CBOR item in `remaining` as a fresh Uint8Array.
 * We use `decodeCbor` (which reports bytesRead) so we can correctly
 * locate the credentialPublicKey CBOR boundary even when extension data
 * follows it in the authenticatorData blob.
 */
function sliceFirstCborItem(remaining: Uint8Array): Uint8Array {
  const { bytesRead } = decodeCbor(remaining);
  return copyOf(remaining, 0, bytesRead);
}

/**
 * Returns a fresh `Uint8Array` (backed by a non-shared `ArrayBuffer`)
 * containing `bytes[start..end]`. Used to coerce slices of arbitrary
 * `Uint8Array<ArrayBufferLike>` inputs into the `Uint8Array<ArrayBuffer>`
 * shape that TypeScript 5.7's narrowed `BufferSource` requires.
 */
function copyOf(bytes: Uint8Array, start = 0, end?: number): Uint8Array {
  const stop = end ?? bytes.length;
  const len = Math.max(0, stop - start);
  const out = new Uint8Array(new ArrayBuffer(len));
  out.set(bytes.subarray(start, stop));
  return out;
}

// ─── DER → raw r||s signature converter ──────────────────────────────────────

/**
 * Convert an ECDSA signature in ASN.1 DER form (which is what WebAuthn
 * always returns) to the raw IEEE-P1363 form (32-byte R concatenated
 * with 32-byte S, total 64 bytes) that SubtleCrypto.verify expects.
 *
 * DER layout (ECDSA-Sig-Value):
 *   30 LEN
 *     02 LEN_R [00] R
 *     02 LEN_S [00] S
 *
 * The optional 0x00 prefix on R and S is present iff the high bit of
 * the first content byte is set (DER's signed-integer rule). We strip
 * it and left-pad to 32 bytes.
 */
export function derToRawEcdsaP256(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new PasskeyError(
      "credential_invalid",
      "ECDSA signature is not a DER SEQUENCE",
    );
  }
  let p = 2;
  // Handle short/long-form length encoding for the outer SEQUENCE.
  if ((der[1]! & 0x80) !== 0) {
    const n = der[1]! & 0x7f;
    p = 2 + n; // skip the length octets
  }
  if (der[p] !== 0x02) {
    throw new PasskeyError(
      "credential_invalid",
      "ECDSA signature R component is not an INTEGER",
    );
  }
  const rLen = der[p + 1]!;
  let r = copyOf(der, p + 2, p + 2 + rLen);
  p = p + 2 + rLen;
  if (der[p] !== 0x02) {
    throw new PasskeyError(
      "credential_invalid",
      "ECDSA signature S component is not an INTEGER",
    );
  }
  const sLen = der[p + 1]!;
  let s = copyOf(der, p + 2, p + 2 + sLen);

  // Strip a leading 0x00 added by DER for high-bit-set integers.
  if (r.length > 32 && r[0] === 0x00) r = copyOf(r, 1);
  if (s.length > 32 && s[0] === 0x00) s = copyOf(s, 1);
  // Left-pad short components to 32 bytes.
  if (r.length < 32) r = concat(new Uint8Array(32 - r.length), r);
  if (s.length < 32) s = concat(new Uint8Array(32 - s.length), s);

  if (r.length !== 32 || s.length !== 32) {
    throw new PasskeyError(
      "credential_invalid",
      `ECDSA signature components have unexpected length (R=${r.length}, S=${s.length})`,
    );
  }
  return concat(r, s);
}

// ─── Enrolment ───────────────────────────────────────────────────────────────

/**
 * Run a one-time WebAuthn `credentials.create` ceremony to enrol a
 * device-resident passkey. The browser will prompt the user to confirm
 * (Touch ID, Windows Hello, etc). On success, persists the credentialId
 * + SPKI public key to localStorage and returns the parsed enrolment.
 */
export async function enrolPasskey(
  options: { userIdB64url?: string; userName?: string } = {},
): Promise<PasskeyEnrolment> {
  const challenge = window.crypto.getRandomValues(new Uint8Array(32));
  const userIdB64url = options.userIdB64url ?? bytesToB64url(
    window.crypto.getRandomValues(new Uint8Array(16)),
  );
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: bufferOf(challenge),
    rp: { id: RP_ID, name: RP_NAME },
    user: {
      id: bufferOf(b64urlToBytes(userIdB64url)),
      name: options.userName ?? "evenkeel-learner",
      displayName: options.userName ?? "Even Keel Learner",
    },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 only
    authenticatorSelection: {
      userVerification: "preferred",
      residentKey: "preferred",
    },
    timeout: 60_000,
    attestation: "none",
  };

  let cred: unknown;
  try {
    cred = await credentials().create({ publicKey });
  } catch (e) {
    if ((e as Error)?.name === "NotAllowedError") {
      throw new PasskeyError("cancelled", "User cancelled the passkey enrolment");
    }
    throw new PasskeyError(
      "ceremony_failed",
      `WebAuthn create failed: ${(e as Error)?.message ?? "unknown"}`,
    );
  }
  if (!cred || typeof cred !== "object") {
    throw new PasskeyError("credential_invalid", "credentials.create returned no value");
  }

  // Extract the response shape we need. Don't trust the runtime types.
  const c = cred as {
    rawId?: ArrayBuffer | Uint8Array;
    response?: { attestationObject?: ArrayBuffer | Uint8Array };
  };
  if (!c.rawId || !c.response?.attestationObject) {
    throw new PasskeyError(
      "credential_invalid",
      "credentials.create returned a malformed credential",
    );
  }

  const credentialIdBytes = toBytes(c.rawId);
  const attObjBytes = toBytes(c.response.attestationObject);

  // attestationObject is CBOR { fmt, attStmt, authData }.
  const attObj = decodeCborStrict(attObjBytes);
  if (!(attObj instanceof Map)) {
    throw new PasskeyError(
      "credential_invalid",
      "attestationObject is not a CBOR map",
    );
  }
  const authData = (attObj as CborMap).get("authData");
  if (!(authData instanceof Uint8Array)) {
    throw new PasskeyError(
      "credential_invalid",
      "attestationObject.authData missing or not a byte string",
    );
  }
  const parsed = parseAuthenticatorData(authData);
  if (!parsed.attested) {
    throw new PasskeyError(
      "credential_invalid",
      "authenticatorData has no attested credential data (AT flag clear)",
    );
  }
  // Validate the COSE_Key actually parses before we persist anything.
  parseCoseKeyP256(parsed.attested.coseKey);
  const spki = coseKeyToSpki(parsed.attested.coseKey);

  const enrolment: PasskeyEnrolment = {
    credentialIdB64url: bytesToB64url(credentialIdBytes),
    spkiB64url: bytesToB64url(spki),
    enrolledAtIso: new Date().toISOString(),
  };
  persistEnrolment(enrolment);
  return enrolment;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Sign `payload` with the currently-enrolled passkey. Returns the raw
 * material a caller (e.g. `signing.ts`) can splice into a SignedEnvelope
 * — we don't construct the envelope here so the existing signing code
 * stays the single source of truth for envelope shape.
 */
export async function signPayloadWithPasskey<T>(payload: T): Promise<{
  payload: T;
  contentDigestB64url: string;
  signatureB64url: string;       // raw r||s, NOT DER
  publicKeyB64url: string;       // SPKI from the enrolment
  webauthn: WebauthnAttestation;
}> {
  const enrolment = getEnrolment();
  if (!enrolment) {
    throw new PasskeyError(
      "no_enrolment",
      "No passkey enrolled on this device. Enrol one first.",
    );
  }
  const challengeBytes = await canonicalPayloadDigest(payload);
  const credentialIdBytes = b64urlToBytes(enrolment.credentialIdB64url);

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: bufferOf(challengeBytes),
    rpId: RP_ID,
    allowCredentials: [
      { type: "public-key", id: bufferOf(credentialIdBytes) },
    ],
    userVerification: "preferred",
    timeout: 60_000,
  };

  let assertion: unknown;
  try {
    assertion = await credentials().get({ publicKey });
  } catch (e) {
    if ((e as Error)?.name === "NotAllowedError") {
      throw new PasskeyError(
        "cancelled",
        "User cancelled the passkey signing prompt",
      );
    }
    throw new PasskeyError(
      "ceremony_failed",
      `WebAuthn get failed: ${(e as Error)?.message ?? "unknown"}`,
    );
  }
  if (!assertion || typeof assertion !== "object") {
    throw new PasskeyError("credential_invalid", "credentials.get returned no value");
  }
  const a = assertion as {
    rawId?: ArrayBuffer | Uint8Array;
    response?: {
      authenticatorData?: ArrayBuffer | Uint8Array;
      clientDataJSON?: ArrayBuffer | Uint8Array;
      signature?: ArrayBuffer | Uint8Array;
    };
  };
  if (
    !a.rawId ||
    !a.response?.authenticatorData ||
    !a.response.clientDataJSON ||
    !a.response.signature
  ) {
    throw new PasskeyError(
      "credential_invalid",
      "credentials.get returned a malformed assertion",
    );
  }

  const assertionCredId = toBytes(a.rawId);
  if (!bytesEqual(assertionCredId, credentialIdBytes)) {
    throw new PasskeyError(
      "credential_invalid",
      "Assertion credentialId does not match the enrolled credentialId",
    );
  }

  const authenticatorData = toBytes(a.response.authenticatorData);
  const clientDataJSON = toBytes(a.response.clientDataJSON);
  const sigDer = toBytes(a.response.signature);
  const sigRaw = derToRawEcdsaP256(sigDer);

  return {
    payload,
    contentDigestB64url: bytesToB64url(challengeBytes),
    signatureB64url: bytesToB64url(sigRaw),
    publicKeyB64url: enrolment.spkiB64url,
    webauthn: {
      credentialIdB64url: enrolment.credentialIdB64url,
      authenticatorDataB64url: bytesToB64url(authenticatorData),
      clientDataJsonB64url: bytesToB64url(clientDataJSON),
    },
  };
}

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * Verify a passkey-signed envelope (the `webauthn` discriminator branch
 * from `signing.ts.verifyEnvelope`).
 *
 * Checks performed:
 *   (A) The clientDataJSON `challenge` field equals base64url(SHA-256(payload)).
 *       This is the *payload commitment* — without this check, a passkey
 *       signature could be replayed across payloads.
 *   (B) clientDataJSON `type` is exactly "webauthn.get".
 *       (Stops a registration-time signature from being mis-used as
 *       an issuance-time signature.)
 *   (C) The ECDSA signature verifies against the SPKI public key over
 *       `authenticatorData || SHA-256(clientDataJSON)`, which is what
 *       WebAuthn always signs. Per the spec.
 *   (D) The `contentDigestB64url` in the envelope matches (A).
 *
 * Returns a boolean rather than throwing, to match `verifyEnvelope`'s
 * contract. Any decode / parse error simply yields `false`.
 */
export async function verifyPasskeyEnvelope(envelope: {
  payload: unknown;
  contentDigestB64url: string;
  signatureB64url: string;
  publicKeyB64url: string;
  webauthn: WebauthnAttestation;
}): Promise<boolean> {
  try {
    const expectedDigest = await canonicalPayloadDigest(envelope.payload);
    const expectedDigestB64url = bytesToB64url(expectedDigest);
    if (expectedDigestB64url !== envelope.contentDigestB64url) return false;

    const clientDataJSON = b64urlToBytes(envelope.webauthn.clientDataJsonB64url);
    const cdj = JSON.parse(new TextDecoder().decode(clientDataJSON)) as {
      type?: string;
      challenge?: string;
    };
    if (cdj.type !== "webauthn.get") return false;
    if (cdj.challenge !== expectedDigestB64url) return false;

    const authenticatorData = b64urlToBytes(
      envelope.webauthn.authenticatorDataB64url,
    );
    const clientDataHash = await sha256(clientDataJSON);
    const signedBytes = concat(authenticatorData, clientDataHash);

    const spki = b64urlToBytes(envelope.publicKeyB64url);
    const pubKey = await subtle().importKey(
      "spki",
      bufferOf(spki),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const sigRaw = b64urlToBytes(envelope.signatureB64url);
    return await subtle().verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      bufferOf(sigRaw),
      bufferOf(signedBytes),
    );
  } catch {
    return false;
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function toBytes(b: ArrayBuffer | Uint8Array): Uint8Array {
  if (b instanceof Uint8Array) return b;
  return new Uint8Array(b);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
