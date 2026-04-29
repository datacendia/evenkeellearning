import { describe, it, expect, beforeEach } from "vitest";
import {
  BOX_INTERVALS_DAYS,
  NUM_BOXES,
  __resetMigrationFlagForTests,
  clearScheduler,
  getAllStates,
  getDueProblems,
  getProblemState,
  nextBox,
  recordAttempt,
  subscribeScheduler,
} from "@/lib/eke/scheduler";

const STORAGE_KEY = "evenkeel.eke.scheduler";
const LEGACY_STORAGE_KEY = "keellearn.kele.scheduler";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  __resetMigrationFlagForTests();
});

describe("scheduler: nextBox state machine", () => {
  it("a correct attempt promotes the box by one", () => {
    expect(nextBox(1, "correct")).toBe(2);
    expect(nextBox(3, "correct")).toBe(4);
  });

  it("a correct attempt at the top box stays at the top box", () => {
    expect(nextBox(NUM_BOXES, "correct")).toBe(NUM_BOXES);
  });

  it("any non-correct, non-skipped category demotes to box 1", () => {
    for (const cat of [
      "sign_flipped",
      "off_by_one",
      "doubled",
      "halved",
      "wrong",
    ] as const) {
      expect(nextBox(4, cat)).toBe(1);
      expect(nextBox(NUM_BOXES, cat)).toBe(1);
    }
  });

  it("no_attempt is a no-op (caller should skip)", () => {
    expect(nextBox(2, "no_attempt")).toBe(2);
    expect(nextBox(NUM_BOXES, "no_attempt")).toBe(NUM_BOXES);
  });
});

describe("scheduler: recordAttempt", () => {
  it("creates a fresh entry at box 2 with the right dueAt for the first correct attempt", () => {
    const t0 = 1_700_000_000_000;
    const entry = recordAttempt("p1", "correct", t0);
    expect(entry).not.toBeNull();
    expect(entry!.box).toBe(2);
    expect(entry!.attempts).toBe(1);
    expect(entry!.lastSeen).toBe(t0);
    expect(entry!.lastResult).toBe("correct");
    expect(entry!.dueAt).toBe(t0 + BOX_INTERVALS_DAYS[1]! * MS_PER_DAY);
  });

  it("creates a fresh entry at box 1 for a first non-correct attempt", () => {
    const t0 = 1_700_000_000_000;
    const entry = recordAttempt("p1", "sign_flipped", t0);
    expect(entry!.box).toBe(1);
    expect(entry!.dueAt).toBe(t0 + BOX_INTERVALS_DAYS[0]! * MS_PER_DAY);
  });

  it("promotes an existing entry on a correct follow-up", () => {
    const t0 = 1_700_000_000_000;
    recordAttempt("p1", "correct", t0);
    const t1 = t0 + 5 * MS_PER_DAY;
    const updated = recordAttempt("p1", "correct", t1);
    expect(updated!.box).toBe(3);
    expect(updated!.attempts).toBe(2);
    expect(updated!.dueAt).toBe(t1 + BOX_INTERVALS_DAYS[2]! * MS_PER_DAY);
  });

  it("any non-correct attempt collapses an entry back to box 1, regardless of current box", () => {
    const t0 = 1_700_000_000_000;
    recordAttempt("p1", "correct", t0);                    // box 2
    recordAttempt("p1", "correct", t0 + 1 * MS_PER_DAY);   // box 3
    recordAttempt("p1", "correct", t0 + 2 * MS_PER_DAY);   // box 4
    const t = t0 + 3 * MS_PER_DAY;
    const demoted = recordAttempt("p1", "off_by_one", t);
    expect(demoted!.box).toBe(1);
    expect(demoted!.attempts).toBe(4);
    expect(demoted!.dueAt).toBe(t + BOX_INTERVALS_DAYS[0]! * MS_PER_DAY);
  });

  it("ignores no_attempt and returns null", () => {
    expect(recordAttempt("p1", "no_attempt")).toBeNull();
    expect(getProblemState("p1")).toBeUndefined();
  });

  it("ignores empty problemIds", () => {
    expect(recordAttempt("", "correct")).toBeNull();
    expect(getAllStates()).toHaveLength(0);
  });
});

describe("scheduler: due-queue", () => {
  it("freshly-recorded entries are not due (they were just scheduled forward)", () => {
    const t0 = 1_700_000_000_000;
    recordAttempt("p1", "correct", t0);
    expect(getDueProblems(t0)).toHaveLength(0);
  });

  it("returns entries whose dueAt has passed, sorted by dueAt ascending", () => {
    const t0 = 1_700_000_000_000;
    recordAttempt("p1", "correct", t0);                   // due at t0 + 3d
    recordAttempt("p2", "wrong", t0 + 0.1 * MS_PER_DAY);  // due at ~t0 + 1.1d
    recordAttempt("p3", "correct", t0);                   // due at t0 + 3d (later than p2)
    // promote p3 once so it's due even later than p1
    recordAttempt("p3", "correct", t0 + 0.2 * MS_PER_DAY); // box 3 → due ~t0 + 7.2d

    // Look one full month into the future — every entry should be due,
    // ordered by their dueAt timestamps.
    const future = t0 + 60 * MS_PER_DAY;
    const due = getDueProblems(future);
    expect(due.map((e) => e.problemId)).toEqual(["p2", "p1", "p3"]);
  });
});

describe("scheduler: persistence + clear + subscribers", () => {
  it("writes to localStorage and reads back", () => {
    recordAttempt("p1", "correct");
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Array<{ problemId: string }>;
    expect(parsed.map((e) => e.problemId)).toEqual(["p1"]);
  });

  it("clearScheduler removes all entries and notifies subscribers", () => {
    const calls: number[] = [];
    const off = subscribeScheduler((entries) => calls.push(entries.length));
    recordAttempt("p1", "correct");
    recordAttempt("p2", "wrong");
    clearScheduler();
    expect(calls).toEqual([1, 2, 0]);
    expect(getAllStates()).toHaveLength(0);
    off();
  });

  it("a misbehaving subscriber does not poison the rest", () => {
    const ok: number[] = [];
    subscribeScheduler(() => {
      throw new Error("boom");
    });
    subscribeScheduler((entries) => ok.push(entries.length));
    recordAttempt("p1", "correct");
    expect(ok).toEqual([1]);
  });
});

describe("scheduler: defensive parsing", () => {
  it("ignores non-array localStorage contents", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ broken: true }));
    expect(getAllStates()).toEqual([]);
  });

  it("filters out entries that fail the shape guard", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        // Valid
        {
          problemId: "ok",
          box: 2,
          dueAt: 1,
          attempts: 1,
          lastSeen: 0,
          lastResult: "correct",
        },
        // Box out of range
        {
          problemId: "bad-box",
          box: 99,
          dueAt: 1,
          attempts: 1,
          lastSeen: 0,
          lastResult: "correct",
        },
        // Missing fields
        { problemId: "bad-shape" },
      ]),
    );
    const states = getAllStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.problemId).toBe("ok");
  });

  it("treats malformed JSON as empty", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(getAllStates()).toEqual([]);
  });
});

describe("scheduler: legacy migration", () => {
  it("migrates from keellearn.kele.scheduler into the new key on first read", () => {
    const legacy = JSON.stringify([
      {
        problemId: "p-legacy",
        box: 3,
        dueAt: 100,
        attempts: 5,
        lastSeen: 50,
        lastResult: "correct",
      },
    ]);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const states = getAllStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.problemId).toBe("p-legacy");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(legacy);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("does not overwrite an existing evenkeel scheduler with a legacy one", () => {
    const current = JSON.stringify([
      {
        problemId: "p-current",
        box: 1,
        dueAt: 0,
        attempts: 1,
        lastSeen: 0,
        lastResult: "wrong",
      },
    ]);
    const legacy = JSON.stringify([
      {
        problemId: "p-legacy",
        box: 3,
        dueAt: 100,
        attempts: 5,
        lastSeen: 50,
        lastResult: "correct",
      },
    ]);
    window.localStorage.setItem(STORAGE_KEY, current);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const states = getAllStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.problemId).toBe("p-current");
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
