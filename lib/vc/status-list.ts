// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/status-list.ts
//
// v1.7.1 — W3C StatusList2021-subset revocation registry.
//
// What this module does
// ─────────────────────
// Provides the two pieces needed to revoke a previously-issued VC:
//
//   1. A bitstring-backed registry. Each issued VC is allocated an index
//      into a bitstring; flipping the bit at that index revokes the
//      credential. Lookup is O(1) by index.
//
//   2. A StatusList credential builder. The bitstring is packaged as
//      the `credentialSubject` of a status-list VC that can itself be
//      signed + published at a stable URL. Verifiers fetch that
//      credential, decode the bitstring, and check the bit at the
//      index named by the VC-under-verification's `credentialStatus`.
//
// FAITHFULNESS / DEVIATION from W3C StatusList2021
// ─────────────────────────────────────────────────
// Faithful:
//   • `credentialStatus.type` is `"StatusList2021Entry"`.
//   • `credentialStatus.statusPurpose` is `"revocation"`.
//   • `credentialStatus.statusListIndex` is a stringified integer.
//   • `credentialStatus.statusListCredential` is a URL.
//   • The status-list VC's subject has `type: "StatusList2021"` and
//     carries an `encodedList` string.
//
// Pilot deviation (called out for auditability):
//   • The spec requires the bitstring be GZIPped then base64url-encoded.
//     We skip gzip and store a raw base64url-encoded bitstring, because
//     (a) gzip requires either `pako` (dependency) or
//     `CompressionStream` (Node 18+ only; adds async to a sync path),
//     (b) the compression factor on a pilot-scale bitstring (<<64 KB)
//     is not worth the async cost, and
//     (c) we control both ends of the pilot. The `encodingVersion`
//     field on the status-list subject names the variant so a
//     spec-compliant verifier can reject our flavour explicitly.
//     Revisit before district phase when a standalone verifier may be
//     fed status lists from multiple issuers.
//
// Every deviation is opt-in via the `encodingVersion` field; a future
// spec-compliant registry can live alongside this one.
// ─────────────────────────────────────────────────────────────────────────────

import type { SignedEnvelope } from "@/lib/crypto/signing";
import { signPayloadWithAutoPasskey } from "@/lib/crypto/signing";
import { VC_V2_CONTEXT, canonicalizeJcsSubset } from "./issuer";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Pilot bitstring length. 16 KiB of bits = 131,072 credentials. */
export const STATUS_LIST_BIT_LENGTH = 16 * 1024 * 8;

/** The `credentialStatus.type` we emit. */
export const STATUS_LIST_ENTRY_TYPE = "StatusList2021Entry" as const;

/** The `credentialSubject.type` on the status-list VC we emit. */
export const STATUS_LIST_SUBJECT_TYPE = "StatusList2021" as const;

/** The status-list credential's `type[1]`. */
export const STATUS_LIST_CREDENTIAL_TYPE = "StatusList2021Credential" as const;

/** Encoding version — names the base64url-without-gzip pilot variant. */
export const STATUS_LIST_ENCODING_VERSION = "base64url-bitstring-v1" as const;

/** Status purpose constant. */
export const STATUS_PURPOSE_REVOCATION = "revocation" as const;

// ─── Bitstring ─────────────────────────────────────────────────────────────

/** Allocate a zeroed bitstring of the default length. */
export function newBitstring(
  bitLength: number = STATUS_LIST_BIT_LENGTH,
): Uint8Array {
  if (bitLength <= 0 || bitLength % 8 !== 0) {
    throw new Error("bitLength must be a positive multiple of 8");
  }
  return new Uint8Array(bitLength / 8);
}

/** Set a bit at `index` to `value` (default 1). Mutates in place. */
export function setBit(bits: Uint8Array, index: number, value: 0 | 1 = 1): void {
  if (index < 0 || index >= bits.length * 8) {
    throw new Error(`bit index ${index} out of range`);
  }
  const byte = Math.floor(index / 8);
  const mask = 1 << (index % 8);
  if (value === 1) bits[byte] |= mask;
  else bits[byte] &= ~mask & 0xff;
}

/** Read a bit. */
export function getBit(bits: Uint8Array, index: number): 0 | 1 {
  if (index < 0 || index >= bits.length * 8) {
    throw new Error(`bit index ${index} out of range`);
  }
  const byte = Math.floor(index / 8);
  const mask = 1 << (index % 8);
  return (bits[byte] & mask) !== 0 ? 1 : 0;
}

// ─── base64url codec (no gzip — see header deviation note) ────────────────

export function encodeBitstring(bits: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bits.length; i++) bin += String.fromCharCode(bits[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBitstring(encoded: string): Uint8Array {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── credentialStatus block (embedded on issued VCs) ───────────────────────

/** Shape of the `credentialStatus` field that gets embedded on every VC. */
export interface CredentialStatusEntry {
  /** Stable URI for this specific entry. */
  id: string;
  type: typeof STATUS_LIST_ENTRY_TYPE;
  statusPurpose: typeof STATUS_PURPOSE_REVOCATION;
  /** Stringified integer — index into the bitstring. */
  statusListIndex: string;
  /** URL of the status-list VC that carries the bitstring. */
  statusListCredential: string;
}

// ─── Status-list VC (the thing that carries the bitstring) ─────────────────

export interface StatusListCredentialSubject {
  /** Stable identifier of the status list (matches the VC id). */
  id: string;
  type: typeof STATUS_LIST_SUBJECT_TYPE;
  statusPurpose: typeof STATUS_PURPOSE_REVOCATION;
  /** Base64url of the bitstring (no gzip — see header note). */
  encodedList: string;
  /** Names the bitstring variant. */
  encodingVersion: typeof STATUS_LIST_ENCODING_VERSION;
  /** Total number of bits (== max credentials in this list). */
  bitLength: number;
}

export interface UnsignedStatusListCredential {
  "@context": [typeof VC_V2_CONTEXT];
  id: string;
  type: ["VerifiableCredential", typeof STATUS_LIST_CREDENTIAL_TYPE];
  issuer: string;
  validFrom: string;
  credentialSubject: StatusListCredentialSubject;
}

/** Signed status-list VC — same proof shape as any other VC we issue. */
export type StatusListCredential = UnsignedStatusListCredential & {
  proof: {
    type: "DataIntegrityProof";
    cryptosuite: "ecdsa-jcs-2019";
    created: string;
    verificationMethod: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
    publicKeyB64url: string;
  };
};

// ─── In-memory revocation registry ─────────────────────────────────────────

/**
 * A revocation registry for a single status-list URL. In the pilot the
 * registry lives in memory; persistence is the caller's job (`toJSON`
 * / `fromJSON`). In production the registry would be server-backed and
 * the status-list credential would be re-issued + re-published each
 * time a bit flips.
 */
export interface RegistryState {
  /** Status-list credential URL (also the VC id). */
  statusListUrl: string;
  /** Issuer DID. */
  issuerDid: string;
  /** Raw bitstring. */
  bits: Uint8Array;
  /** Next unused index. */
  nextIndex: number;
  /** Map from VC id → index, so we can look up & revoke by credential. */
  indexByCredentialId: Record<string, number>;
}

export function createRegistry(
  statusListUrl: string,
  issuerDid: string,
  bitLength: number = STATUS_LIST_BIT_LENGTH,
): RegistryState {
  return {
    statusListUrl,
    issuerDid,
    bits: newBitstring(bitLength),
    nextIndex: 0,
    indexByCredentialId: {},
  };
}

/** Reserve a fresh index for `credentialId`. Idempotent. */
export function allocateIndex(
  registry: RegistryState,
  credentialId: string,
): number {
  const existing = registry.indexByCredentialId[credentialId];
  if (existing !== undefined) return existing;
  if (registry.nextIndex >= registry.bits.length * 8) {
    throw new Error("status_list_exhausted");
  }
  const idx = registry.nextIndex++;
  registry.indexByCredentialId[credentialId] = idx;
  return idx;
}

/**
 * Build the `credentialStatus` block to embed on a VC. Allocates an
 * index automatically if the credential is not yet tracked.
 */
export function buildCredentialStatusEntry(
  registry: RegistryState,
  credentialId: string,
): CredentialStatusEntry {
  const idx = allocateIndex(registry, credentialId);
  return {
    id: `${registry.statusListUrl}#${idx}`,
    type: STATUS_LIST_ENTRY_TYPE,
    statusPurpose: STATUS_PURPOSE_REVOCATION,
    statusListIndex: String(idx),
    statusListCredential: registry.statusListUrl,
  };
}

/** Flip the bit for `credentialId`. Throws if the id is not allocated. */
export function revokeCredential(
  registry: RegistryState,
  credentialId: string,
): void {
  const idx = registry.indexByCredentialId[credentialId];
  if (idx === undefined) throw new Error("credential_not_in_registry");
  setBit(registry.bits, idx, 1);
}

/** Returns `true` iff the credential is currently revoked. */
export function isRevokedById(
  registry: RegistryState,
  credentialId: string,
): boolean {
  const idx = registry.indexByCredentialId[credentialId];
  if (idx === undefined) return false;
  return getBit(registry.bits, idx) === 1;
}

/** Pure bitstring-level revocation check, for verifiers that only have
 *  the decoded bits + an index (i.e. they fetched the status-list VC). */
export function isRevokedByIndex(
  bits: Uint8Array,
  index: number,
): boolean {
  return getBit(bits, index) === 1;
}

// ─── Status-list credential build + sign ───────────────────────────────────

export function buildStatusListCredential(
  registry: RegistryState,
  validFromIso: string,
): UnsignedStatusListCredential {
  return {
    "@context": [VC_V2_CONTEXT],
    id: registry.statusListUrl,
    type: ["VerifiableCredential", STATUS_LIST_CREDENTIAL_TYPE],
    issuer: registry.issuerDid,
    validFrom: validFromIso,
    credentialSubject: {
      id: registry.statusListUrl,
      type: STATUS_LIST_SUBJECT_TYPE,
      statusPurpose: STATUS_PURPOSE_REVOCATION,
      encodedList: encodeBitstring(registry.bits),
      encodingVersion: STATUS_LIST_ENCODING_VERSION,
      bitLength: registry.bits.length * 8,
    },
  };
}

/**
 * Sign the status-list VC. Same passkey-required default as the main
 * issuer; tests inject a session-key signer.
 */
export async function issueStatusListCredential(input: {
  registry: RegistryState;
  validFromIso: string;
  signer?: (payload: { canonical: string }) => Promise<
    SignedEnvelope<{ canonical: string }>
  >;
}): Promise<StatusListCredential> {
  const unsigned = buildStatusListCredential(
    input.registry,
    input.validFromIso,
  );
  const canonical = canonicalizeJcsSubset(unsigned);
  const sign =
    input.signer ??
    ((p: { canonical: string }) =>
      signPayloadWithAutoPasskey<{ canonical: string }>(p, {
        requirePasskey: true,
      }));
  const envelope = await sign({ canonical });

  return {
    ...unsigned,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-jcs-2019",
      created: envelope.signedAtIso,
      verificationMethod: `${input.registry.issuerDid}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue: envelope.signatureB64url,
      publicKeyB64url: envelope.publicKeyB64url,
    },
  };
}

// ─── Persistence helpers ───────────────────────────────────────────────────

/** Serialize the registry to a JSON-safe object. */
export function registryToJson(registry: RegistryState): {
  statusListUrl: string;
  issuerDid: string;
  encodedList: string;
  nextIndex: number;
  indexByCredentialId: Record<string, number>;
  bitLength: number;
} {
  return {
    statusListUrl: registry.statusListUrl,
    issuerDid: registry.issuerDid,
    encodedList: encodeBitstring(registry.bits),
    nextIndex: registry.nextIndex,
    indexByCredentialId: { ...registry.indexByCredentialId },
    bitLength: registry.bits.length * 8,
  };
}

/** Rehydrate from the shape emitted by `registryToJson`. */
export function registryFromJson(raw: {
  statusListUrl: string;
  issuerDid: string;
  encodedList: string;
  nextIndex: number;
  indexByCredentialId: Record<string, number>;
  bitLength: number;
}): RegistryState {
  const bits = decodeBitstring(raw.encodedList);
  if (bits.length * 8 !== raw.bitLength) {
    throw new Error("registry_bit_length_mismatch");
  }
  return {
    statusListUrl: raw.statusListUrl,
    issuerDid: raw.issuerDid,
    bits,
    nextIndex: raw.nextIndex,
    indexByCredentialId: { ...raw.indexByCredentialId },
  };
}
