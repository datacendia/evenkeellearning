// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/roster-store.test.ts
//
// Pins the encrypted-at-rest roster persistence contract in
// `lib/roster/store.ts`. Verifies:
//   • round-trip save/load via the AES-GCM device key
//   • plaintext does NOT appear in localStorage
//   • clearRoster() removes the persisted blob
//   • SSR-safe (loadRoster returns null when window is undefined)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRoster,
  saveRoster,
  clearRoster,
  persistImportedRoster,
  ROSTER_STORAGE_KEY,
  __resetRosterCacheForTests,
} from "@/lib/roster/store";
import { __resetDeviceKeyForTests } from "@/lib/bus-at-rest";
import type { LearnerRecord } from "@/lib/roster/schema";

const LEARNERS: LearnerRecord[] = [
  {
    externalId: "A1",
    givenName: "Sara",
    familyName: "Smith",
    yearGroup: 8,
    jurisdiction: "UK-EN",
    consentStatus: "parental_consent_on_file",
  },
  {
    externalId: "A2",
    givenName: "Tom",
    familyName: "Jones",
    yearGroup: 9,
    jurisdiction: "UK-EN",
    dateOfBirth: "2011-05-12",
    isUnder13: false,
    consentStatus: "pending",
  },
];

beforeEach(() => {
  window.localStorage.removeItem(ROSTER_STORAGE_KEY);
  __resetRosterCacheForTests();
  __resetDeviceKeyForTests();
});

describe("roster store — round-trip", () => {
  it("save then load returns the same payload", async () => {
    await saveRoster({
      version: 1,
      committedAtIso: "2026-05-11T08:00:00.000Z",
      learners: LEARNERS,
      rosterDigestB64url: "test-digest",
    });
    __resetRosterCacheForTests(); // force a fresh decrypt path
    const loaded = await loadRoster();
    expect(loaded).not.toBeNull();
    expect(loaded!.learners).toHaveLength(2);
    expect(loaded!.learners[0].externalId).toBe("A1");
    expect(loaded!.committedAtIso).toBe("2026-05-11T08:00:00.000Z");
  });

  it("plaintext PII does not appear in localStorage", async () => {
    await saveRoster({
      version: 1,
      committedAtIso: "2026-05-11T08:00:00.000Z",
      learners: LEARNERS,
      rosterDigestB64url: "test-digest",
    });
    const raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("Sara");
    expect(raw).not.toContain("Smith");
    expect(raw).not.toContain("Tom");
    expect(raw).not.toContain("2011-05-12");
    // The envelope shape itself should be visible.
    const parsed = JSON.parse(raw!);
    expect(parsed.v).toBe(1);
    expect(typeof parsed.iv).toBe("string");
    expect(typeof parsed.ct).toBe("string");
  });
});

describe("roster store — empty / corrupt paths", () => {
  it("loadRoster returns null when nothing is persisted", async () => {
    const r = await loadRoster();
    expect(r).toBeNull();
  });

  it("loadRoster returns null on corrupt JSON in storage", async () => {
    window.localStorage.setItem(ROSTER_STORAGE_KEY, "not json");
    __resetRosterCacheForTests();
    expect(await loadRoster()).toBeNull();
  });

  it("loadRoster returns null on an envelope decryption failure", async () => {
    // Plant a syntactically-valid envelope with garbage ciphertext.
    window.localStorage.setItem(
      ROSTER_STORAGE_KEY,
      JSON.stringify({ v: 1, iv: "AAAAAAAAAAAAAAAA", ct: "garbage" }),
    );
    __resetRosterCacheForTests();
    expect(await loadRoster()).toBeNull();
  });
});

describe("roster store — clearRoster", () => {
  it("removes the persisted blob and the cache", async () => {
    await saveRoster({
      version: 1,
      committedAtIso: "2026-05-11T08:00:00.000Z",
      learners: LEARNERS,
      rosterDigestB64url: "d",
    });
    expect(window.localStorage.getItem(ROSTER_STORAGE_KEY)).not.toBeNull();
    clearRoster();
    expect(window.localStorage.getItem(ROSTER_STORAGE_KEY)).toBeNull();
    expect(await loadRoster()).toBeNull();
  });
});

describe("persistImportedRoster convenience writer", () => {
  it("packages learners + timestamp + digest correctly", async () => {
    const iso = "2026-05-11T08:30:00.000Z";
    await persistImportedRoster(LEARNERS, iso, "digest-xyz");
    __resetRosterCacheForTests();
    const loaded = await loadRoster();
    expect(loaded).not.toBeNull();
    expect(loaded!.committedAtIso).toBe(iso);
    expect(loaded!.rosterDigestB64url).toBe("digest-xyz");
    expect(loaded!.learners).toHaveLength(2);
  });
});
