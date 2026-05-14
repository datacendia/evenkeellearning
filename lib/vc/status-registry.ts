// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/status-registry.ts
//
// v1.7.1 — In-memory orchestrator that glues `lib/vc/status-list.ts` to the
// VC issuance flow.
//
// Responsibilities
// ────────────────
//   1. Allocate the next free StatusList2021 index for a credential id.
//   2. Track the (credentialId → index) mapping so an issuer can later
//      revoke a credential by id without remembering its index.
//   3. Maintain the in-memory bitstring; expose `revoke()`/`unrevoke()`
//      that recompute the encodedList lazily.
//   4. Build the unsigned StatusList2021Credential body on demand so the
//      caller can sign it with the same Data Integrity proof used for
//      regular VCs (single source of truth in `lib/vc/issuer.ts`).
//   5. Publish PII-free bus events whenever the registry mutates.
//
// What this is NOT
// ────────────────
//   • A persistence layer. The registry is in-memory; callers wire it to
//     whatever store they like (encrypted local storage for the pilot,
//     Postgres in the district phase). The (snapshot/load) helpers below
//     give a serializable form so persistence stays a one-liner.
//   • A signer. Signing the StatusList2021Credential happens outside —
//     either via `signPayloadWithAutoPasskey` directly, or via the same
//     `issueVerifiableCredential` path with a custom `unsigned` builder.
//     Keeping signing out of here means the registry is fully testable
//     without WebAuthn or session keys.
// ─────────────────────────────────────────────────────────────────────────────

import { publish } from "@/lib/data-bus";
import {
  STATUS_LIST_MIN_BITS,
  allocBitstring,
  buildStatusEntry,
  buildStatusListCredential,
  decodeBitstring,
  encodeBitstring,
  getBit,
  setBit,
  type StatusList2021Entry,
  type StatusPurpose,
  type UnsignedStatusListCredential,
} from "./status-list";

// ─── Snapshot shape (serializable) ─────────────────────────────────────────

export interface StatusRegistrySnapshot {
  /** Stable URL of the StatusList2021Credential this registry serves. */
  statusListCredentialUrl: string;
  /** Issuer DID baked into the published list credential. */
  issuerDid: string;
  /** Bit count (multiple of 8). */
  totalBits: number;
  /** "revocation" or "suspension". */
  statusPurpose: StatusPurpose;
  /** Next index to hand out on the next allocate. */
  nextIndex: number;
  /** Map of credentialId → assigned index. */
  assignments: Record<string, number>;
  /** Encoded bitstring (gzip + base64url). */
  encodedList: string;
  /** Optional ISO timestamp for the most recent encoded list. */
  validFromIso: string;
}

export interface CreateRegistryInput {
  statusListCredentialUrl: string;
  issuerDid: string;
  totalBits?: number;
  statusPurpose?: StatusPurpose;
}

// ─── Internal mutable state ────────────────────────────────────────────────

interface RegistryState {
  url: string;
  issuerDid: string;
  totalBits: number;
  statusPurpose: StatusPurpose;
  nextIndex: number;
  assignments: Map<string, number>;
  bits: Uint8Array;
  validFromIso: string;
  /** Cached encodedList; cleared on every mutation. */
  cachedEncoded: string | null;
}

// ─── Bus event payloads (PII-free by construction) ─────────────────────────

interface RevokePayload {
  statusListCredential: string;
  statusListIndex: number;
  credentialId: string;
  reasonCode?: string;
}
interface RepublishPayload {
  statusListCredential: string;
  totalBits: number;
  setBitCount: number;
  validFromIso: string;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface StatusRegistry {
  /** Allocate a fresh index for `credentialId` and return the inline
   *  `credentialStatus` block to embed at issuance time. Idempotent: calling
   *  twice with the same id returns the SAME entry. */
  allocate(credentialId: string): StatusList2021Entry;

  /** Look up the index assigned to a credentialId, or null if unassigned. */
  indexOf(credentialId: string): number | null;

  /** Read the current bit (0/1) for an assigned credentialId.
   *  Throws if the id was never allocated. */
  isRevoked(credentialId: string): boolean;

  /** Set the bit to 1. Idempotent. Publishes `vc.credential.revoked`. */
  revoke(credentialId: string, opts?: { reasonCode?: string }): void;

  /** Set the bit back to 0. Idempotent. Publishes `vc.credential.unrevoked`. */
  unrevoke(credentialId: string): void;

  /** Encoded (gzip + base64url) bitstring suitable for the
   *  StatusList2021Credential body. Async because gzip is async. */
  encodedList(): Promise<string>;

  /** Build the UNSIGNED StatusList2021Credential body. Caller signs.
   *  Bumps `validFromIso` to "now" before encoding. Publishes
   *  `vc.statuslist.republished`. */
  buildUnsignedListCredential(opts?: {
    nowIso?: string;
  }): Promise<UnsignedStatusListCredential>;

  /** Total bits in the bitstring (capacity). */
  capacity(): number;

  /** How many indices have been handed out (regardless of revoked/not). */
  allocatedCount(): number;

  /** Snapshot (serializable). */
  snapshot(): Promise<StatusRegistrySnapshot>;
}

/**
 * Create a fresh registry. `totalBits` defaults to the spec minimum
 * (131,072) for privacy reasons — see status-list.ts.
 */
export function createStatusRegistry(input: CreateRegistryInput): StatusRegistry {
  if (!input.statusListCredentialUrl.startsWith("http")) {
    throw new Error("statusListCredentialUrl must be an http(s) URL");
  }
  if (!input.issuerDid) throw new Error("issuerDid required");
  const totalBits = input.totalBits ?? STATUS_LIST_MIN_BITS;
  const state: RegistryState = {
    url: input.statusListCredentialUrl,
    issuerDid: input.issuerDid,
    totalBits,
    statusPurpose: input.statusPurpose ?? "revocation",
    nextIndex: 0,
    assignments: new Map(),
    bits: allocBitstring(totalBits),
    validFromIso: new Date(0).toISOString(),
    cachedEncoded: null,
  };
  return wrap(state);
}

/**
 * Restore a registry from a snapshot. Useful for persistence wiring.
 * Validates that `nextIndex`, `assignments`, and `encodedList` are
 * mutually consistent (decoded bitstring length matches `totalBits`).
 */
export async function restoreStatusRegistry(
  snap: StatusRegistrySnapshot,
): Promise<StatusRegistry> {
  if (snap.totalBits % 8 !== 0 || snap.totalBits <= 0) {
    throw new Error("invalid snapshot: totalBits must be a positive multiple of 8");
  }
  const bits = await decodeBitstring(snap.encodedList);
  if (bits.length * 8 !== snap.totalBits) {
    throw new Error(
      `invalid snapshot: encodedList decodes to ${bits.length * 8} bits, expected ${snap.totalBits}`,
    );
  }
  if (snap.nextIndex < 0 || snap.nextIndex > snap.totalBits) {
    throw new Error("invalid snapshot: nextIndex out of range");
  }
  const assignments = new Map<string, number>();
  for (const [id, idx] of Object.entries(snap.assignments)) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= snap.totalBits) {
      throw new Error(`invalid snapshot: assignment out of range for ${id}`);
    }
    assignments.set(id, idx);
  }
  const state: RegistryState = {
    url: snap.statusListCredentialUrl,
    issuerDid: snap.issuerDid,
    totalBits: snap.totalBits,
    statusPurpose: snap.statusPurpose,
    nextIndex: snap.nextIndex,
    assignments,
    bits,
    validFromIso: snap.validFromIso,
    cachedEncoded: snap.encodedList,
  };
  return wrap(state);
}

// ─── Internal wrapper ──────────────────────────────────────────────────────

function wrap(state: RegistryState): StatusRegistry {
  function invalidateCache(): void {
    state.cachedEncoded = null;
  }

  function setBitCount(): number {
    let n = 0;
    for (const b of state.bits) {
      // popcount byte
      let v = b;
      v = v - ((v >> 1) & 0x55);
      v = (v & 0x33) + ((v >> 2) & 0x33);
      n += (((v + (v >> 4)) & 0x0f) * 0x01) & 0xff;
    }
    return n;
  }

  return {
    allocate(credentialId: string): StatusList2021Entry {
      if (!credentialId) throw new Error("credentialId required");
      let idx = state.assignments.get(credentialId);
      if (idx === undefined) {
        if (state.nextIndex >= state.totalBits) {
          throw new Error("status_list_full");
        }
        idx = state.nextIndex++;
        state.assignments.set(credentialId, idx);
        // Allocation does not flip a bit, so cache is still valid.
      }
      return buildStatusEntry({
        statusListCredential: state.url,
        statusListIndex: idx,
        statusPurpose: state.statusPurpose,
      });
    },

    indexOf(credentialId: string): number | null {
      const i = state.assignments.get(credentialId);
      return i === undefined ? null : i;
    },

    isRevoked(credentialId: string): boolean {
      const i = state.assignments.get(credentialId);
      if (i === undefined) {
        throw new Error(`unknown_credential:${credentialId}`);
      }
      return getBit(state.bits, i) === 1;
    },

    revoke(credentialId: string, opts?: { reasonCode?: string }): void {
      const i = state.assignments.get(credentialId);
      if (i === undefined) {
        throw new Error(`unknown_credential:${credentialId}`);
      }
      const before = getBit(state.bits, i);
      if (before === 1) return; // idempotent
      setBit(state.bits, i, 1);
      invalidateCache();
      const payload: RevokePayload = {
        statusListCredential: state.url,
        statusListIndex: i,
        credentialId,
        ...(opts?.reasonCode ? { reasonCode: opts.reasonCode } : {}),
      };
      publish("vc.credential.revoked", payload as unknown as Record<string, unknown>, "vc.registry");
    },

    unrevoke(credentialId: string): void {
      const i = state.assignments.get(credentialId);
      if (i === undefined) {
        throw new Error(`unknown_credential:${credentialId}`);
      }
      const before = getBit(state.bits, i);
      if (before === 0) return; // idempotent
      setBit(state.bits, i, 0);
      invalidateCache();
      const payload: RevokePayload = {
        statusListCredential: state.url,
        statusListIndex: i,
        credentialId,
      };
      publish("vc.credential.unrevoked", payload as unknown as Record<string, unknown>, "vc.registry");
    },

    async encodedList(): Promise<string> {
      if (state.cachedEncoded) return state.cachedEncoded;
      const enc = await encodeBitstring(state.bits);
      state.cachedEncoded = enc;
      return enc;
    },

    async buildUnsignedListCredential(opts?: {
      nowIso?: string;
    }): Promise<UnsignedStatusListCredential> {
      const enc = await this.encodedList();
      state.validFromIso = opts?.nowIso ?? new Date().toISOString();
      const cred = buildStatusListCredential({
        id: state.url,
        issuerDid: state.issuerDid,
        validFromIso: state.validFromIso,
        encodedList: enc,
        statusPurpose: state.statusPurpose,
      });
      const repub: RepublishPayload = {
        statusListCredential: state.url,
        totalBits: state.totalBits,
        setBitCount: setBitCount(),
        validFromIso: state.validFromIso,
      };
      publish(
        "vc.statuslist.republished",
        repub as unknown as Record<string, unknown>,
        "vc.registry",
      );
      return cred;
    },

    capacity(): number {
      return state.totalBits;
    },

    allocatedCount(): number {
      return state.assignments.size;
    },

    async snapshot(): Promise<StatusRegistrySnapshot> {
      const enc = await this.encodedList();
      const assignments: Record<string, number> = {};
      for (const [id, idx] of state.assignments) assignments[id] = idx;
      return {
        statusListCredentialUrl: state.url,
        issuerDid: state.issuerDid,
        totalBits: state.totalBits,
        statusPurpose: state.statusPurpose,
        nextIndex: state.nextIndex,
        assignments,
        encodedList: enc,
        validFromIso: state.validFromIso,
      };
    },
  };
}
