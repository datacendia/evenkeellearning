// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/safety-settings.test.ts
//
// Pin the observable contract of the Parent Safety Centre settings module.
// Matches the shape of `a11y-settings.test.ts` — same storage idioms, same
// defensive-parse expectations — so a regression in either is caught the
// same way.
//
// Also covers the two pure enforcement helpers that `SafetyGate` composes:
//   1. `isBedtimeActive` — must handle simple and cross-midnight windows.
//   2. `shouldPauseSession` — bedtime wins over cap when both trigger; neither
//      triggers when disabled; cap on its own paints "cap" with real usage.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SAFETY_SETTINGS,
  bumpDailyUsage,
  getDailyUsage,
  getSafetySettings,
  isBedtimeActive,
  resetDailyUsage,
  resetSafetySettings,
  screenTimeCapState,
  setSafetySettings,
  shouldPauseSession,
  todayKey,
  updateSafetySetting,
  type SafetySettings,
} from "@/lib/safety/settings";

const STORAGE_KEY = "evenkeel/safety/v1";
const USAGE_KEY = "evenkeel/safety/usage/v1";

describe("safety/settings — persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when storage is empty", () => {
    expect(getSafetySettings()).toEqual(DEFAULT_SAFETY_SETTINGS);
  });

  it("round-trips a fully-customised settings object", () => {
    const custom: SafetySettings = {
      screenTime: { enabled: true, dailyCapMinutes: 90 },
      bedtime: { enabled: true, startHHMM: "20:00", endHHMM: "06:30" },
      tone: "foreman",
      crisis: { enabled: false, channel: "in-app" },
    };
    setSafetySettings(custom);
    expect(getSafetySettings()).toEqual(custom);
  });

  it("falls back to defaults on malformed JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getSafetySettings()).toEqual(DEFAULT_SAFETY_SETTINGS);
  });

  it("ignores garbage values for known keys and keeps defaults", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        screenTime: { enabled: "nope", dailyCapMinutes: "lots" },
        bedtime: { enabled: 1, startHHMM: "25:99", endHHMM: "not-a-time" },
        tone: "unknown-tone",
        crisis: { enabled: null, channel: "carrier-pigeon" },
      }),
    );
    expect(getSafetySettings()).toEqual(DEFAULT_SAFETY_SETTINGS);
  });

  it("clamps absurd cap values to a sane range", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ screenTime: { enabled: true, dailyCapMinutes: 99999 } }),
    );
    expect(getSafetySettings().screenTime.dailyCapMinutes).toBe(600);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ screenTime: { enabled: true, dailyCapMinutes: -50 } }),
    );
    expect(getSafetySettings().screenTime.dailyCapMinutes).toBe(5);
  });

  it("updateSafetySetting changes one key without touching others", () => {
    updateSafetySetting("tone", "peer");
    const after = updateSafetySetting("bedtime", {
      enabled: true,
      startHHMM: "21:30",
      endHHMM: "07:30",
    });
    expect(after.tone).toBe("peer");
    expect(after.bedtime.enabled).toBe(true);
    expect(after.screenTime).toEqual(DEFAULT_SAFETY_SETTINGS.screenTime);
  });

  it("resetSafetySettings restores defaults", () => {
    updateSafetySetting("tone", "foreman");
    expect(getSafetySettings().tone).toBe("foreman");
    const after = resetSafetySettings();
    expect(after).toEqual(DEFAULT_SAFETY_SETTINGS);
    expect(getSafetySettings()).toEqual(DEFAULT_SAFETY_SETTINGS);
  });
});

describe("safety/settings — isBedtimeActive", () => {
  it("is inactive when the window is disabled, regardless of time", () => {
    const now = new Date("2025-06-01T22:00:00");
    expect(
      isBedtimeActive({ enabled: false, startHHMM: "21:00", endHHMM: "07:00" }, now),
    ).toBe(false);
  });

  it("handles a simple same-day window", () => {
    const bt = { enabled: true, startHHMM: "13:00", endHHMM: "14:00" };
    expect(isBedtimeActive(bt, new Date("2025-06-01T13:30:00"))).toBe(true);
    expect(isBedtimeActive(bt, new Date("2025-06-01T12:59:00"))).toBe(false);
    expect(isBedtimeActive(bt, new Date("2025-06-01T14:00:00"))).toBe(false); // end-exclusive
  });

  it("handles a window that crosses midnight", () => {
    const bt = { enabled: true, startHHMM: "21:00", endHHMM: "07:00" };
    expect(isBedtimeActive(bt, new Date("2025-06-01T21:00:00"))).toBe(true);
    expect(isBedtimeActive(bt, new Date("2025-06-01T23:30:00"))).toBe(true);
    expect(isBedtimeActive(bt, new Date("2025-06-02T03:00:00"))).toBe(true);
    expect(isBedtimeActive(bt, new Date("2025-06-02T06:59:00"))).toBe(true);
    expect(isBedtimeActive(bt, new Date("2025-06-02T07:00:00"))).toBe(false); // end-exclusive
    expect(isBedtimeActive(bt, new Date("2025-06-02T12:00:00"))).toBe(false);
  });

  it("treats zero-length windows as off", () => {
    const bt = { enabled: true, startHHMM: "21:00", endHHMM: "21:00" };
    expect(isBedtimeActive(bt, new Date("2025-06-01T21:00:00"))).toBe(false);
  });
});

describe("safety/settings — daily usage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts at zero for today", () => {
    const u = getDailyUsage();
    expect(u.minutesUsed).toBe(0);
    expect(u.date).toBe(todayKey());
  });

  it("bumpDailyUsage accumulates and persists", () => {
    bumpDailyUsage(1);
    bumpDailyUsage(4);
    expect(getDailyUsage().minutesUsed).toBe(5);
    // Persistence check.
    const raw = window.localStorage.getItem(USAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).minutesUsed).toBe(5);
  });

  it("resets when the stored date is stale", () => {
    window.localStorage.setItem(
      USAGE_KEY,
      JSON.stringify({ date: "1999-01-01", minutesUsed: 500 }),
    );
    const u = getDailyUsage();
    expect(u.minutesUsed).toBe(0);
    expect(u.date).toBe(todayKey());
  });

  it("resetDailyUsage zeros the counter", () => {
    bumpDailyUsage(20);
    expect(getDailyUsage().minutesUsed).toBe(20);
    resetDailyUsage();
    expect(getDailyUsage().minutesUsed).toBe(0);
  });
});

describe("safety/settings — enforcement composition", () => {
  const noonJune1 = new Date("2025-06-01T12:00:00");

  it("does not pause when both bedtime and cap are disabled", () => {
    const s = DEFAULT_SAFETY_SETTINGS;
    const { paused, reason } = shouldPauseSession(
      s,
      { date: todayKey(noonJune1), minutesUsed: 500 },
      noonJune1,
    );
    expect(paused).toBe(false);
    expect(reason).toBeNull();
  });

  it("pauses with reason=bedtime when inside the window", () => {
    const s: SafetySettings = {
      ...DEFAULT_SAFETY_SETTINGS,
      bedtime: { enabled: true, startHHMM: "11:00", endHHMM: "13:00" },
    };
    const { paused, reason } = shouldPauseSession(
      s,
      { date: todayKey(noonJune1), minutesUsed: 0 },
      noonJune1,
    );
    expect(paused).toBe(true);
    expect(reason).toBe("bedtime");
  });

  it("pauses with reason=cap when only the cap is exceeded", () => {
    const s: SafetySettings = {
      ...DEFAULT_SAFETY_SETTINGS,
      screenTime: { enabled: true, dailyCapMinutes: 30 },
    };
    const { paused, reason } = shouldPauseSession(
      s,
      { date: todayKey(noonJune1), minutesUsed: 45 },
      noonJune1,
    );
    expect(paused).toBe(true);
    expect(reason).toBe("cap");
  });

  it("prefers bedtime over cap when both would trigger", () => {
    const s: SafetySettings = {
      screenTime: { enabled: true, dailyCapMinutes: 30 },
      bedtime: { enabled: true, startHHMM: "11:00", endHHMM: "13:00" },
      tone: "mentor",
      crisis: { enabled: true, channel: "in-app" },
    };
    const { paused, reason } = shouldPauseSession(
      s,
      { date: todayKey(noonJune1), minutesUsed: 45 },
      noonJune1,
    );
    expect(paused).toBe(true);
    expect(reason).toBe("bedtime");
  });

  it("screenTimeCapState reports remaining minutes accurately", () => {
    const s = screenTimeCapState(
      { enabled: true, dailyCapMinutes: 60 },
      { date: todayKey(), minutesUsed: 20 },
    );
    expect(s.minutesRemaining).toBe(40);
    expect(s.exceeded).toBe(false);
  });

  it("screenTimeCapState returns Infinity remaining when disabled", () => {
    const s = screenTimeCapState(
      { enabled: false, dailyCapMinutes: 60 },
      { date: todayKey(), minutesUsed: 1000 },
    );
    expect(s.minutesRemaining).toBe(Infinity);
    expect(s.exceeded).toBe(false);
  });
});
