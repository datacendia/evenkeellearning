// ─────────────────────────────────────────────────────────────────────────────
// lib/roster/store.ts
//
// v1.6.6 — Encrypted-at-rest roster store. Reuses the AES-GCM device
// key + envelope primitives from `lib/bus-at-rest` so the roster (a
// PII-bearing artefact) inherits the same protection as the bus log.
//
// Storage layout
// ──────────────
//   localStorage key  : evenkeel.roster.v1
//   envelope shape    : { v: 1, iv, ct }   (same shape as the bus log)
//   plaintext payload : { version: 1, committedAtIso, learners[], digest }
//
// Why a separate key (not stuffed inside the bus log)?
//   • The bus log is a ring buffer — old entries roll off after 200
//     events. The roster needs to persist indefinitely.
//   • Different access patterns: the bus is append-many / read-many,
//     the roster is replace-whole-blob / read-whole-blob.
//   • Separate key lets the parent erasure flow drop the roster
//     independently of the bus log.
//
// PII handling
// ────────────
// The roster contains names, DOB, and (optionally) emails. Plaintext
// never touches localStorage; the encrypted envelope is opaque. The
// in-memory cache lives only in this module's scope and is cleared by
// `clearRoster()`.
//
// SSR
// ───
// All functions are no-ops in environments without `window`, returning
// empty values or doing nothing. This matches the bus-at-rest pattern
// and keeps roster code safe to import from server components if ever
// needed (currently it isn't).
// ─────────────────────────────────────────────────────────────────────────────

import {
  encryptJson,
  decryptJson,
  getOrCreateDeviceKey,
  type EncryptedBusLogEnvelope,
} from "@/lib/bus-at-rest";
import type { LearnerRecord } from "./schema";

export const ROSTER_STORAGE_KEY = "evenkeel.roster.v1";

/** Plaintext payload that gets encrypted into the envelope. */
export interface RosterPayload {
  version: 1;
  /** ISO timestamp of the most recent commit. */
  committedAtIso: string;
  /** All learner records currently on roster. */
  learners: LearnerRecord[];
  /** SHA-256 digest of sorted external_ids — mirrors the bus event. */
  rosterDigestB64url: string;
}

/** In-process cache so the UI can re-render without re-decrypting. */
let cached: RosterPayload | null = null;
let cacheLoaded = false;

/**
 * Read the roster from encrypted storage. Returns null if no roster
 * has ever been committed, or if decryption fails (treated equivalently
 * — no half-state surfaced to the UI).
 */
export async function loadRoster(): Promise<RosterPayload | null> {
  if (cacheLoaded) return cached;
  if (typeof window === "undefined") {
    cacheLoaded = true;
    return null;
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
  } catch {
    cacheLoaded = true;
    return null;
  }
  if (!raw) {
    cacheLoaded = true;
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cacheLoaded = true;
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { v?: unknown }).v !== 1
  ) {
    cacheLoaded = true;
    return null;
  }
  try {
    const key = await getOrCreateDeviceKey();
    const payload = await decryptJson<RosterPayload>(
      key,
      parsed as EncryptedBusLogEnvelope,
    );
    if (payload && payload.version === 1 && Array.isArray(payload.learners)) {
      cached = payload;
    }
  } catch {
    // Decryption failed — treat as no-roster.
  }
  cacheLoaded = true;
  return cached;
}

/**
 * Save the roster to encrypted storage. Throws only if SubtleCrypto is
 * unavailable; quota-exceeded errors are swallowed (consistent with
 * the bus-at-rest writer policy).
 */
export async function saveRoster(payload: RosterPayload): Promise<void> {
  if (typeof window === "undefined") return;
  const key = await getOrCreateDeviceKey();
  const envelope = await encryptJson(key, payload);
  try {
    window.localStorage.setItem(
      ROSTER_STORAGE_KEY,
      JSON.stringify(envelope),
    );
    cached = payload;
    cacheLoaded = true;
  } catch {
    // quota / disabled — swallow.
  }
}

/**
 * Delete the roster outright (e.g. as part of parent erasure or
 * teacher-initiated reset). Idempotent.
 */
export function clearRoster(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(ROSTER_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  cached = null;
  cacheLoaded = true;
}

/** Test hook. Resets the in-memory cache so the next call re-reads. */
export function __resetRosterCacheForTests(): void {
  cached = null;
  cacheLoaded = false;
}

/**
 * Convenience writer for the `import.ts` orchestrator. Takes the just-
 * imported learner array, packages it with the digest, and saves.
 */
export async function persistImportedRoster(
  learners: LearnerRecord[],
  committedAtIso: string,
  rosterDigestB64url: string,
): Promise<void> {
  const payload: RosterPayload = {
    version: 1,
    committedAtIso,
    learners,
    rosterDigestB64url,
  };
  await saveRoster(payload);
}
