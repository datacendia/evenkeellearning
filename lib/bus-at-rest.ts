// ─────────────────────────────────────────────────────────────────────────────
// lib/bus-at-rest.ts
//
// v1.6.0 — audit M-3. At-rest encryption for the `evenkeel.bus.log`
// ring buffer.
//
// Threat model
// ────────────
// Anything written to `localStorage` on the same origin is readable by:
//   - any JavaScript running on the page (already fenced by the CSP added
//     in v1.5.5 M-7)
//   - anyone with physical access to the profile directory
//   - cloud-sync backups of the browser profile
//   - forensic tools and browser extensions with host permissions
//
// Plaintext bus payloads therefore leak *metadata about the learner's
// session* outside the page context. For a child's learning journal this
// is a non-trivial privacy concern — we say "everything is local" in the
// honesty doc, and "local and encrypted at rest" is closer to what that
// promise should mean.
//
// Design
// ──────
// - A 256-bit AES-GCM key is generated once per browser profile and
//   stored **non-extractable** in IndexedDB (`evenkeel-device-keys`,
//   object store `keys`, id = "bus.v1"). Non-extractable means:
//     * page JS can call `encrypt`/`decrypt` through this module
//     * page JS CANNOT read the raw key bytes
//     * a profile dump cannot decrypt without running JS on the origin
//
// - Records in localStorage take the envelope shape
//     { v: 1, iv: base64url, ct: base64url }
//   where `ct` is AES-GCM(key, iv=iv, aad="evenkeel.bus.log.v1") of the
//   JSON-serialised event array. The AAD binds the ciphertext to this
//   module's intent — decrypting a blob extracted from another store
//   with the same key fails.
//
// - A legacy **plaintext** array (the pre-v1.6.0 format) is detected on
//   init, read once, re-persisted encrypted, and then never read again.
//   This is the only back-compat path.
//
// Limits
// ──────
// - JS running on the origin can still decrypt (the key lives in the
//   browser's CryptoKey vault, accessible to same-origin scripts via the
//   public API of this module). The CSP in `next.config.js` is what
//   keeps untrusted JS off the page.
// - If IndexedDB is unavailable or the key fetch fails, we refuse to
//   write plaintext. The bus still works in-memory for the session; the
//   log just isn't persisted. Honest degradation.
// ─────────────────────────────────────────────────────────────────────────────

import { openDB, type IDBPDatabase } from "idb";
import {
  bytesToBase64Url,
  base64UrlToBytes,
  toArrayBuffer,
} from "@/lib/crypto/base64url";

const DB_NAME = "evenkeel-device-keys";
const DB_VERSION = 1;
const STORE = "keys";
const KEY_ID = "bus.v1";
const AAD = new TextEncoder().encode("evenkeel.bus.log.v1");

export const BUS_LOG_STORAGE_KEY = "evenkeel.bus.log";

/** Envelope we write to localStorage. `v` is the schema version. */
export interface EncryptedBusLogEnvelope {
  v: 1;
  iv: string;
  ct: string;
}

function isEncryptedEnvelope(x: unknown): x is EncryptedBusLogEnvelope {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.v === 1 && typeof o.iv === "string" && typeof o.ct === "string";
}

// ── IndexedDB key storage ──────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase> | null = null;
function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}
function getDb(): Promise<IDBPDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    },
  });
  return dbPromise;
}

let cachedKey: CryptoKey | null = null;

/**
 * Load the device key, generating it on first run. Always returns a
 * non-extractable AES-GCM key.
 *
 * Storage strategy (in order of preference):
 *   1. IndexedDB `evenkeel-device-keys/keys/bus.v1` — persists across
 *      tabs and reloads. The normal path.
 *   2. In-memory (this module scope) — used when IndexedDB is
 *      unavailable (private browsing, SSR, happy-dom test env).
 *      Persists only for the lifetime of the page. On next reload the
 *      encrypted localStorage record will fail to decrypt and the
 *      `readBusLog` caller will see an empty log — equivalent to the
 *      bus starting fresh, which is the acceptable degradation.
 *
 * Throws only if SubtleCrypto itself is unavailable; the caller
 * (data-bus.ts) treats that as "do not persist".
 */
export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("SubtleCrypto unavailable");
  }

  if (hasIndexedDB()) {
    try {
      const db = await getDb();
      const existing = (await db.get(STORE, KEY_ID)) as CryptoKey | undefined;
      if (existing) {
        cachedKey = existing;
        return existing;
      }
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        /* extractable */ false,
        ["encrypt", "decrypt"],
      );
      await db.put(STORE, key, KEY_ID);
      cachedKey = key;
      return key;
    } catch {
      // Fall through to in-memory fallback.
    }
  }

  // IndexedDB unavailable — generate an ephemeral key for this page load.
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  cachedKey = key;
  return key;
}

/**
 * Test hook. Clears the cached key so the next call regenerates. Callers
 * outside tests should never touch this.
 */
export function __resetDeviceKeyForTests(): void {
  cachedKey = null;
  dbPromise = null;
}

// ── Encrypt / decrypt ──────────────────────────────────────────────────────

/** Encrypt a JSON-serialisable value into the on-disk envelope. */
export async function encryptJson<T>(
  key: CryptoKey,
  value: T,
): Promise<EncryptedBusLogEnvelope> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(AAD) },
    key,
    toArrayBuffer(plaintext),
  );
  return {
    v: 1,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ctBuf)),
  };
}

/**
 * Decrypt an on-disk envelope back into the original JSON value.
 * Returns null on any error (bad key, corrupt ciphertext, tampered IV,
 * AAD mismatch). Does not throw.
 */
export async function decryptJson<T = unknown>(
  key: CryptoKey,
  env: EncryptedBusLogEnvelope,
): Promise<T | null> {
  try {
    const iv = base64UrlToBytes(env.iv);
    const ct = base64UrlToBytes(env.ct);
    const ptBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(AAD) },
      key,
      toArrayBuffer(ct),
    );
    return JSON.parse(new TextDecoder().decode(new Uint8Array(ptBuf))) as T;
  } catch {
    return null;
  }
}

// ── Ring-buffer read/write helpers (used by lib/data-bus.ts) ───────────────

/**
 * Read the bus log from localStorage, decrypting if encrypted. If the
 * record is in the legacy plaintext array format we return it as-is AND
 * flag that a re-encrypt-on-next-write should happen; the caller (the
 * data-bus init path) is responsible for the migration write.
 *
 * Returns { events, wasLegacyPlaintext } so callers can distinguish.
 */
export async function readBusLog<T = unknown>(): Promise<{
  events: T[];
  wasLegacyPlaintext: boolean;
}> {
  if (typeof window === "undefined") return { events: [], wasLegacyPlaintext: false };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(BUS_LOG_STORAGE_KEY);
  } catch {
    return { events: [], wasLegacyPlaintext: false };
  }
  if (!raw) return { events: [], wasLegacyPlaintext: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { events: [], wasLegacyPlaintext: false };
  }

  if (isEncryptedEnvelope(parsed)) {
    try {
      const key = await getOrCreateDeviceKey();
      const decrypted = await decryptJson<T[]>(key, parsed);
      return { events: decrypted ?? [], wasLegacyPlaintext: false };
    } catch {
      return { events: [], wasLegacyPlaintext: false };
    }
  }

  // Legacy plaintext array (pre-v1.6.0). Migrate on next write.
  if (Array.isArray(parsed)) {
    return { events: parsed as T[], wasLegacyPlaintext: true };
  }

  return { events: [], wasLegacyPlaintext: false };
}

/** Write the bus log to localStorage, encrypted. Throws if encryption fails. */
export async function writeBusLog<T>(events: T[]): Promise<void> {
  if (typeof window === "undefined") return;
  const key = await getOrCreateDeviceKey();
  const envelope = await encryptJson(key, events);
  try {
    window.localStorage.setItem(BUS_LOG_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // quota exceeded or disabled — swallow, consistent with data-bus.ts
  }
}
