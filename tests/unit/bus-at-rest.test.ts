// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/bus-at-rest.test.ts
//
// v1.6.0 — audit M-3. Regression suite for the at-rest encryption of the
// bus ring buffer. Pins the security-critical invariants:
//
//   1. A legitimate envelope round-trips (encrypt → decrypt → equals).
//   2. Flipping any ciphertext byte breaks the GCM auth tag → decrypt nulls.
//   3. Flipping any IV byte breaks the GCM auth tag → decrypt nulls.
//   4. A different key cannot decrypt (key binding).
//   5. The plaintext never appears in the envelope (trivial but pinned).
//   6. Legacy plaintext arrays in localStorage are detected and read once,
//      with `wasLegacyPlaintext: true`, so the caller can migrate.
//   7. An encrypted envelope in localStorage round-trips via readBusLog
//      without the caller ever handling plaintext on disk.
//   8. `writeBusLog` always produces a versioned envelope, never plaintext.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUS_LOG_STORAGE_KEY,
  decryptJson,
  encryptJson,
  getOrCreateDeviceKey,
  readBusLog,
  writeBusLog,
  type EncryptedBusLogEnvelope,
} from "@/lib/bus-at-rest";

describe("bus-at-rest — encryptJson/decryptJson", () => {
  it("round-trips a JSON-serialisable value", async () => {
    const key = await getOrCreateDeviceKey();
    const value = { events: [1, 2, 3], note: "hello" };
    const envelope = await encryptJson(key, value);
    const decrypted = await decryptJson(key, envelope);
    expect(decrypted).toEqual(value);
  });

  it("produces envelope { v:1, iv:base64url, ct:base64url } with plaintext absent", async () => {
    const key = await getOrCreateDeviceKey();
    const value = { secretMarker: "this-string-must-not-leak" };
    const envelope = await encryptJson(key, value);
    expect(envelope.v).toBe(1);
    expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(envelope)).not.toContain("secretMarker");
    expect(JSON.stringify(envelope)).not.toContain("this-string-must-not-leak");
  });

  it("decrypt nulls out if the ciphertext byte is flipped", async () => {
    const key = await getOrCreateDeviceKey();
    const envelope = await encryptJson(key, { n: 1 });
    const tampered: EncryptedBusLogEnvelope = {
      ...envelope,
      // Flip one char in the ciphertext. base64url alphabet — pick an
      // adjacent letter so it stays valid base64url.
      ct: envelope.ct.replace(/^./, (c: string) => (c === "A" ? "B" : "A")),
    };
    const out = await decryptJson(key, tampered);
    expect(out).toBeNull();
  });

  it("decrypt nulls out if the IV byte is flipped", async () => {
    const key = await getOrCreateDeviceKey();
    const envelope = await encryptJson(key, { n: 1 });
    const tampered: EncryptedBusLogEnvelope = {
      ...envelope,
      iv: envelope.iv.replace(/^./, (c: string) => (c === "A" ? "B" : "A")),
    };
    const out = await decryptJson(key, tampered);
    expect(out).toBeNull();
  });

  it("a different key cannot decrypt (AES-GCM key binding)", async () => {
    const key = await getOrCreateDeviceKey();
    const envelope = await encryptJson(key, { n: 1 });

    // Generate a separate, fresh key. This key has NOT been stored in the
    // device-keys IndexedDB, so it's a standalone comparison.
    const otherKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const out = await decryptJson(otherKey as CryptoKey, envelope);
    expect(out).toBeNull();
  });
});

describe("bus-at-rest — readBusLog / writeBusLog", () => {
  beforeEach(() => {
    window.localStorage.removeItem(BUS_LOG_STORAGE_KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(BUS_LOG_STORAGE_KEY);
  });

  it("readBusLog returns an empty log and wasLegacyPlaintext=false when the key is absent", async () => {
    const out = await readBusLog();
    expect(out.events).toEqual([]);
    expect(out.wasLegacyPlaintext).toBe(false);
  });

  it("writeBusLog then readBusLog round-trips, with an encrypted envelope on disk", async () => {
    const events = [
      { type: "a", id: "1", ts: 1, source: "s", payload: {} },
      { type: "b", id: "2", ts: 2, source: "s", payload: { x: 42 } },
    ];
    await writeBusLog(events);

    // The raw localStorage value must be an encrypted envelope, not JSON
    // of the events.
    const raw = window.localStorage.getItem(BUS_LOG_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.v).toBe(1);
    expect(parsed.iv).toBeTypeOf("string");
    expect(parsed.ct).toBeTypeOf("string");
    // Payload string must not appear on disk.
    expect(raw).not.toContain("source");
    expect(raw).not.toContain("payload");

    const out = await readBusLog();
    expect(out.events).toEqual(events);
    expect(out.wasLegacyPlaintext).toBe(false);
  });

  it("readBusLog detects legacy plaintext arrays and flags them for migration", async () => {
    const legacy = [
      { type: "legacy", id: "1", ts: 1, source: "s", payload: {} },
    ];
    window.localStorage.setItem(BUS_LOG_STORAGE_KEY, JSON.stringify(legacy));
    const out = await readBusLog();
    expect(out.events).toEqual(legacy);
    expect(out.wasLegacyPlaintext).toBe(true);
  });

  it("readBusLog returns empty+false for a malformed localStorage value", async () => {
    window.localStorage.setItem(BUS_LOG_STORAGE_KEY, "not-json");
    const out = await readBusLog();
    expect(out.events).toEqual([]);
    expect(out.wasLegacyPlaintext).toBe(false);
  });

  it("readBusLog returns empty for an envelope that cannot be decrypted", async () => {
    // Construct a syntactically valid but cryptographically bogus envelope.
    const bogus: EncryptedBusLogEnvelope = {
      v: 1,
      iv: "AAAAAAAAAAAAAAAA",
      ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    window.localStorage.setItem(BUS_LOG_STORAGE_KEY, JSON.stringify(bogus));
    const out = await readBusLog();
    expect(out.events).toEqual([]);
    expect(out.wasLegacyPlaintext).toBe(false);
  });
});
