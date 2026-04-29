import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMigrationFlagForTests,
  endPracticeSession,
  getPracticeState,
  isPracticeActive,
  startPracticeSession,
  subscribePracticeMode,
} from "@/lib/eke/practice-mode";

const STORAGE_KEY = "evenkeel.eke.practiceMode";
const LEGACY_STORAGE_KEY = "keellearn.kele.practiceMode";

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  __resetMigrationFlagForTests();
});

describe("practice-mode: lifecycle", () => {
  it("starts inactive on a fresh device", () => {
    expect(isPracticeActive()).toBe(false);
    expect(getPracticeState().active).toBe(false);
  });

  it("startPracticeSession activates and returns a session id", () => {
    const id = startPracticeSession();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(isPracticeActive()).toBe(true);
    expect(getPracticeState().sessionId).toBe(id);
  });

  it("startPracticeSession is idempotent — repeated calls return the same id", () => {
    const a = startPracticeSession();
    const b = startPracticeSession();
    expect(a).toBe(b);
  });

  it("endPracticeSession returns the session id and a non-negative duration", () => {
    const id = startPracticeSession();
    const closing = endPracticeSession();
    expect(closing).not.toBeNull();
    expect(closing!.sessionId).toBe(id);
    expect(closing!.durationMs).toBeGreaterThanOrEqual(0);
    expect(isPracticeActive()).toBe(false);
  });

  it("endPracticeSession when inactive returns null", () => {
    expect(endPracticeSession()).toBeNull();
  });
});

describe("practice-mode: subscribers", () => {
  it("notifies on start and end", () => {
    const seen: boolean[] = [];
    const off = subscribePracticeMode((s) => seen.push(s.active));
    startPracticeSession();
    endPracticeSession();
    expect(seen).toEqual([true, false]);
    off();
  });

  it("a misbehaving subscriber does not poison the rest", () => {
    const ok: boolean[] = [];
    subscribePracticeMode(() => {
      throw new Error("boom");
    });
    subscribePracticeMode((s) => ok.push(s.active));
    startPracticeSession();
    expect(ok).toEqual([true]);
  });
});

describe("practice-mode: defensive parsing", () => {
  it("treats a stored 'active' record without a sessionId as inactive", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ active: true }), // no sessionId — corrupt
    );
    expect(isPracticeActive()).toBe(false);
  });

  it("treats malformed JSON as inactive", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(isPracticeActive()).toBe(false);
  });

  it("backfills a missing startedAt with the current time so duration is non-negative", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ active: true, sessionId: "abc" }),
    );
    expect(isPracticeActive()).toBe(true);
    const closing = endPracticeSession();
    expect(closing).not.toBeNull();
    expect(closing!.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("practice-mode: legacy migration", () => {
  it("migrates from keellearn.kele.practiceMode into the new key on first read", () => {
    const legacy = JSON.stringify({
      active: true,
      sessionId: "legacy-1",
      startedAt: 1,
    });
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const state = getPracticeState();
    expect(state.active).toBe(true);
    expect(state.sessionId).toBe("legacy-1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(legacy);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("does not overwrite an existing evenkeel record with a legacy one", () => {
    const current = JSON.stringify({
      active: true,
      sessionId: "current-1",
      startedAt: 99,
    });
    const legacy = JSON.stringify({
      active: true,
      sessionId: "legacy-1",
      startedAt: 1,
    });
    window.localStorage.setItem(STORAGE_KEY, current);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const state = getPracticeState();
    expect(state.sessionId).toBe("current-1");
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
