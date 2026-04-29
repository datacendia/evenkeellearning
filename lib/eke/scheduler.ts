// ─────────────────────────────────────────────────────────────────────────────
// lib/eke/scheduler.ts
//
// Spacing scheduler. A deterministic Leitner-box state machine over
// previously-attempted problems. Right answers promote a problem one box;
// any non-correct, non-skipped attempt demotes it to box 1.
//
// Why Leitner and not FSRS in v1
// ──────────────────────────────
//   • Deterministic. No fitted parameters. No model file to ship. No
//     surprise regressions when the parameter file changes.
//   • Parent-explainable in one sentence: *"Problems your child gets
//     wrong come back tomorrow; problems they get right come back next
//     week, then in a fortnight, then in a month."* That is the entire
//     algorithm. No LLM, no opaque scoring, no per-learner bias.
//   • Auditable: a learner or teacher can read the on-device JSON and
//     replay the entire history in their head.
//   • FSRS-lite is a strict upgrade on the same data shape and can
//     replace this module in a later phase without changing callers.
//
// Why not "spaced repetition" with continuous half-life models in v1
// ───────────────────────────────────────────────────────────────────
// Continuous models are mathematically nicer but they give a 41-year-old
// parent in Limerick a perfectly opaque answer to *"why is my kid seeing
// this problem today?"* The Leitner answer ("they got it wrong on
// Tuesday, that puts it in box 1, box 1 is daily") is the answer that
// keeps the structural-safety story coherent.
//
// Practice-mode interaction
// ─────────────────────────
// The scheduler **does** record attempts made during private-practice
// mode (v1.4.3). The scheduler is a learner-facing tool — the learner's
// own queue of what to review next — not a teacher reporting surface.
// The practice contract is about teacher visibility (Integrity Ledger),
// not learner-self visibility (this module + error-bank.ts).
//
// Privacy contract
// ────────────────
//   • Per-problem state is keyed by an opaque `problemId` provided by the
//     caller. No learner free-form text and no expected value is ever
//     persisted here. The only payload is `{ problemId, box, dueAt,
//     attempts, lastSeen, lastResult }` where `lastResult` is one of the
//     `AnswerCategory` strings already used elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

import type { AnswerCategory } from "@/lib/validation/answer-checker";

const STORAGE_KEY = "evenkeel.eke.scheduler";
const LEGACY_STORAGE_KEY = "keellearn.kele.scheduler";

/** Number of Leitner boxes. Box 1 is the freshest / most-frequently due. */
export const NUM_BOXES = 5;

/**
 * Days between attempts for each box. Indexed by box-1 (so `BOX_INTERVALS_DAYS[0]`
 * is the interval for box 1). Standard Leitner cadence: 1, 3, 7, 14, 30.
 *
 * Exposed so the UI can show a learner-comprehensible *"next review in N
 * days"* string without re-deriving the schedule.
 */
export const BOX_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SchedulerEntry {
  /** Caller-supplied opaque id. Never derived from learner text. */
  problemId: string;
  /** 1..NUM_BOXES inclusive. */
  box: number;
  /** Epoch ms at which the problem next becomes due. */
  dueAt: number;
  /** Total number of recorded attempts (correct + non-correct). */
  attempts: number;
  /** Epoch ms of the last recorded attempt. */
  lastSeen: number;
  /** AnswerCategory of the last attempt that drove a state change. */
  lastResult: AnswerCategory;
}

type Listener = (entries: SchedulerEntry[]) => void;
const listeners = new Set<Listener>();

let migrated = false;

function migrateLegacy(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && !window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
    }
    if (legacy !== null) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // privacy mode / quota — proceed without migration
  }
}

function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  migrateLegacy();
}

function isEntry(value: unknown): value is SchedulerEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SchedulerEntry>;
  return (
    typeof v.problemId === "string" &&
    v.problemId.length > 0 &&
    typeof v.box === "number" &&
    Number.isFinite(v.box) &&
    v.box >= 1 &&
    v.box <= NUM_BOXES &&
    typeof v.dueAt === "number" &&
    Number.isFinite(v.dueAt) &&
    typeof v.attempts === "number" &&
    Number.isFinite(v.attempts) &&
    v.attempts >= 0 &&
    typeof v.lastSeen === "number" &&
    Number.isFinite(v.lastSeen) &&
    typeof v.lastResult === "string"
  );
}

function readRaw(): SchedulerEntry[] {
  ensureMigrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive: drop entries from an older or corrupt schema rather than
    // crash the UI. The bank is non-essential demo state.
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function writeRaw(entries: SchedulerEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota — ignore; in-memory notify still fires
  }
}

function notify(entries: SchedulerEntry[]): void {
  listeners.forEach((fn) => {
    try {
      fn(entries);
    } catch {
      // a bad subscriber must not poison the rest
    }
  });
}

function intervalMsForBox(box: number): number {
  // Clamp defensively even though `nextBox()` keeps `box` in [1, NUM_BOXES].
  const idx = Math.min(Math.max(1, box), NUM_BOXES) - 1;
  return BOX_INTERVALS_DAYS[idx]! * MS_PER_DAY;
}

/**
 * Pure function: given a current box and an `AnswerCategory`, return the
 * next box. `correct` promotes (capped at NUM_BOXES); any other category
 * other than `no_attempt` demotes to box 1. `no_attempt` is a no-op
 * (caller should skip the record entirely; see `recordAttempt`).
 *
 * Exposed so unit tests and downstream tooling can verify the rule
 * without going through the storage path.
 */
export function nextBox(currentBox: number, category: AnswerCategory): number {
  if (category === "no_attempt") return currentBox;
  if (category === "correct") return Math.min(NUM_BOXES, currentBox + 1);
  return 1;
}

/** Returns a snapshot of every scheduler entry. */
export function getAllStates(): SchedulerEntry[] {
  return readRaw();
}

/** Returns a single entry, or `undefined` if the problem has never been attempted. */
export function getProblemState(problemId: string): SchedulerEntry | undefined {
  return readRaw().find((e) => e.problemId === problemId);
}

/**
 * Returns every entry whose `dueAt <= now`, ordered by `dueAt` ascending
 * (most-overdue first). A freshly-recorded entry is **not** due — it has
 * just been scheduled forward — so this returns only entries the learner
 * actually owes a review on.
 */
export function getDueProblems(now: number = Date.now()): SchedulerEntry[] {
  return readRaw()
    .filter((e) => e.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * Records an attempt and updates the per-problem state. Returns the
 * updated entry, or `null` for `no_attempt` (which is a deliberate no-op
 * so callers can pass through every category without branching).
 */
export function recordAttempt(
  problemId: string,
  category: AnswerCategory,
  now: number = Date.now(),
): SchedulerEntry | null {
  if (typeof problemId !== "string" || problemId.length === 0) return null;
  if (category === "no_attempt") return null;

  const entries = readRaw();
  const existing = entries.find((e) => e.problemId === problemId);
  const currentBox = existing?.box ?? 1;
  const nextBoxValue = nextBox(currentBox, category);
  const updated: SchedulerEntry = {
    problemId,
    box: nextBoxValue,
    dueAt: now + intervalMsForBox(nextBoxValue),
    attempts: (existing?.attempts ?? 0) + 1,
    lastSeen: now,
    lastResult: category,
  };

  const next = entries.filter((e) => e.problemId !== problemId);
  next.push(updated);
  writeRaw(next);
  notify(next);
  return updated;
}

/**
 * Clears the entire scheduler. Useful for tests and for a future
 * "reset my reviews" learner control.
 */
export function clearScheduler(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  notify([]);
}

/** Subscribes to entry-list updates. Returns an unsubscribe function. */
export function subscribeScheduler(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: re-arm legacy migration so it can be re-exercised. */
export const __resetMigrationFlagForTests = (): void => {
  migrated = false;
};
