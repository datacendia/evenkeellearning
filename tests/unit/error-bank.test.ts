import { describe, it, expect, beforeEach } from "vitest";
import {
  TRACKED_CATEGORIES,
  __resetMigrationFlagForTests,
  clearErrorBank,
  getPatternDetail,
  readErrorBank,
  recordError,
  subscribeErrorBank,
  summariseErrorBank,
  type TrackedCategory,
} from "@/lib/eke/error-bank";

const STORAGE_KEY = "evenkeel.eke.errorBank";
const LEGACY_STORAGE_KEY = "keellearn.kele.errorBank";

beforeEach(() => {
  // Each test starts from a clean device.
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  __resetMigrationFlagForTests();
});

describe("error-bank: contract", () => {
  it("ignores correct and no_attempt categories", () => {
    recordError("correct", "Linear eqs");
    recordError("no_attempt", "Linear eqs");
    expect(readErrorBank()).toHaveLength(0);
  });

  it("records every tracked non-correct, non-no_attempt category", () => {
    for (const c of TRACKED_CATEGORIES) recordError(c, "Linear eqs");
    expect(readErrorBank()).toHaveLength(TRACKED_CATEGORIES.length);
  });

  it("never persists learner free-form text or expected values", () => {
    recordError("sign_flipped", "Linear eqs");
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
    // The stored payload shape is fixed and contains only ts, category,
    // and (optionally) problemTitle. Any additional keys would be a leak.
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    const keys = Object.keys(parsed[0]!).sort();
    expect(keys).toEqual(["category", "problemTitle", "ts"]);
  });

  it("bounds the journal at 50 entries, dropping oldest first", () => {
    for (let i = 0; i < 60; i++) recordError("wrong", `p-${i}`);
    const entries = readErrorBank();
    expect(entries).toHaveLength(50);
    // After overflow the oldest (p-0..p-9) must be evicted.
    expect(entries.find((e) => e.problemTitle === "p-0")).toBeUndefined();
    expect(entries[entries.length - 1]?.problemTitle).toBe("p-59");
  });
});

describe("error-bank: subscribe + clear", () => {
  it("notifies subscribers on record and clear", () => {
    const calls: number[] = [];
    const off = subscribeErrorBank((entries) => calls.push(entries.length));
    recordError("doubled", "Linear eqs");
    recordError("halved", "Linear eqs");
    clearErrorBank();
    expect(calls).toEqual([1, 2, 0]);
    off();
  });

  it("a misbehaving subscriber does not poison the rest", () => {
    const ok: number[] = [];
    subscribeErrorBank(() => {
      throw new Error("boom");
    });
    subscribeErrorBank((entries) => ok.push(entries.length));
    recordError("off_by_one", "Linear eqs");
    expect(ok).toEqual([1]);
  });
});

describe("error-bank: summary", () => {
  it("groups by category and sorts higher-frequency patterns ahead of lower", () => {
    recordError("sign_flipped", "p1");
    recordError("off_by_one", "p1");
    recordError("sign_flipped", "p2");
    recordError("off_by_one", "p3");
    recordError("doubled", "p4");

    const summary = summariseErrorBank();
    expect(summary).toHaveLength(3);

    // The two count=2 categories must appear before the count=1 category.
    // Their relative order between themselves is a recency tiebreak which
    // is undefined when synchronous record() calls land on the same
    // millisecond, so we don't pin it.
    const top: TrackedCategory[] = [summary[0]!.category, summary[1]!.category];
    expect(top.sort()).toEqual<TrackedCategory[]>(["off_by_one", "sign_flipped"]);
    expect(summary[0]?.count).toBe(2);
    expect(summary[1]?.count).toBe(2);
    expect(summary[2]?.category).toBe<TrackedCategory>("doubled");
    expect(summary[2]?.count).toBe(1);
  });
});

describe("error-bank: pattern detail strings (no-leak surface)", () => {
  it("every tracked category has a non-empty title, explanation and cue", () => {
    for (const c of TRACKED_CATEGORIES) {
      const d = getPatternDetail(c);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.explanation.length).toBeGreaterThan(0);
      expect(d.cue.length).toBeGreaterThan(0);
    }
  });

  it("pattern detail strings never contain digits (defence in depth)", () => {
    // The bank is keyed off a category, never the expected value, but we
    // pin the property explicitly: no copy in the learner-facing surface
    // contains an arabic numeral that could be mistaken for an answer.
    for (const c of TRACKED_CATEGORIES) {
      const d = getPatternDetail(c);
      const corpus = `${d.title} ${d.explanation} ${d.cue}`;
      expect(corpus).not.toMatch(/\d/);
    }
  });
});

describe("error-bank: legacy migration", () => {
  it("migrates from keellearn.kele.errorBank into evenkeel.eke.errorBank", () => {
    const legacy = JSON.stringify([
      { ts: 1, category: "wrong", problemTitle: "old" },
    ]);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const entries = readErrorBank();
    expect(entries).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(legacy);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("does not overwrite an existing evenkeel bank with a legacy one", () => {
    const current = JSON.stringify([
      { ts: 99, category: "doubled", problemTitle: "current" },
    ]);
    const legacy = JSON.stringify([
      { ts: 1, category: "wrong", problemTitle: "old" },
    ]);
    window.localStorage.setItem(STORAGE_KEY, current);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const entries = readErrorBank();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.problemTitle).toBe("current");
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});

describe("error-bank: defensive parsing", () => {
  it("ignores non-array localStorage contents", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ broken: true }));
    expect(readErrorBank()).toEqual([]);
  });

  it("filters out entries with unrecognised category strings", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { ts: 1, category: "sign_flipped" },
        { ts: 2, category: "totally-made-up" },
        { ts: 3, category: "off_by_one" },
      ]),
    );
    const entries = readErrorBank();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.category)).toEqual([
      "sign_flipped",
      "off_by_one",
    ]);
  });
});
