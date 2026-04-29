// ─────────────────────────────────────────────────────────────────────────────
// lib/eke/error-bank.ts
//
// Personal "my patterns" journal for the learner. This is a deliberate
// wellbeing-intervention-disguised-as-pedagogy feature (see
// PROPOSAL_TRUTH_PACK.md §A compounding-architecture claim + the
// named-error / error-bank rationale in HONESTY.md §3):
//
//   • A learner who has been told "you flipped the sign — that's one of the
//     five most common maths errors and here's the cue that catches it"
//     experiences a fundamentally different emotional state than one who's
//     been told "wrong, try again". Converting frustration into pattern
//     recognition is the intervention.
//
// Contract
// ────────
//   • Category-only. The learner's free-form text is NEVER persisted here,
//     and neither is the expected value for the problem. Only the
//     AnswerCategory, a monotonic timestamp, and an optional coarse
//     `problemTitle` for grouping are stored. This is the same privacy
//     contract the cross-surface bus uses for `student.answer.validated`.
//
//   • Learner-owned. The bank persists to localStorage under an
//     `evenkeel.*` key, scoped to the browser. A "clear my journal" control
//     wipes it without side-effects. The bank does not feed the teacher
//     Integrity Ledger; the teacher sees validated-answer categories via
//     the bus in real time, but the learner's personal history is theirs.
//
//   • Bounded. At most MAX_ENTRIES entries; oldest are dropped first so
//     the bank reflects recent-pattern drift, not a permanent record.
//
//   • Deterministic. No LLM, no network call. Pure state machine over
//     localStorage + in-memory subscribers.
// ─────────────────────────────────────────────────────────────────────────────

import type { AnswerCategory } from "@/lib/validation/answer-checker";

const STORAGE_KEY = "evenkeel.eke.errorBank";
const LEGACY_STORAGE_KEY = "keellearn.kele.errorBank";
const MAX_ENTRIES = 50;

/** Categories we record in the bank. `correct` and `no_attempt` are excluded:
 *  a correct answer is not a pattern, and no_attempt carries no signal.
 */
export type TrackedCategory = Exclude<AnswerCategory, "correct" | "no_attempt">;

export interface ErrorBankEntry {
  /** Monotonic epoch ms. */
  ts: number;
  /** The error category. */
  category: TrackedCategory;
  /**
   * Coarse problem title for grouping (e.g. "Linear equations"). Never
   * the learner's text, never the expected value.
   */
  problemTitle?: string;
}

/**
 * Presentation data for a named pattern. These strings are the entire
 * learner-facing surface of the error-bank and are intentionally written
 * in plain, non-judgemental English. They do NOT name-and-shame; they
 * name-and-catch.
 */
export interface PatternDetail {
  title: string;
  /** One short sentence explaining the pattern in concrete terms. */
  explanation: string;
  /** One short sentence the learner can use as a cue next time. */
  cue: string;
}

const PATTERNS: Record<TrackedCategory, PatternDetail> = {
  sign_flipped: {
    title: "Sign-flip",
    explanation:
      "You got the right magnitude with the wrong sign. This usually happens when a term is moved across the equals and its sign is not flipped.",
    cue: "Before you commit an answer, replay the last move-across-equals out loud and check the sign changed.",
  },
  off_by_one: {
    title: "Off-by-one",
    explanation:
      "Your answer was one away from correct. This is almost always a miscount in an addition or subtraction step, not a misunderstanding.",
    cue: "Recount the last additive step out loud. Off-by-one is a counting slip, not a thinking slip.",
  },
  doubled: {
    title: "Doubled a coefficient",
    explanation:
      "You multiplied where you should have halved (or similar). A coefficient was doubled instead of divided through.",
    cue: "At the isolation step, ask: am I dividing by the coefficient, or am I multiplying by it?",
  },
  halved: {
    title: "Halved a term",
    explanation:
      "You divided where you should have isolated, which usually means a step was applied on only one side of the equation.",
    cue: "Every operation has to be applied to both sides. Spell out the operation before you perform it.",
  },
  wrong: {
    title: "Method drift",
    explanation:
      "Your answer wasn't close to any of the common error shapes — the chain of steps likely went off-path somewhere in the middle.",
    cue: "Re-read the original problem, then walk through your steps one operation at a time.",
  },
};

/** The five patterns, ordered for stable UI presentation. */
export const TRACKED_CATEGORIES: TrackedCategory[] = [
  "sign_flipped",
  "off_by_one",
  "doubled",
  "halved",
  "wrong",
];

/** Returns the presentation detail for a tracked category. */
export function getPatternDetail(category: TrackedCategory): PatternDetail {
  return PATTERNS[category];
}

type Listener = (entries: ErrorBankEntry[]) => void;
const listeners = new Set<Listener>();

/**
 * One-time localStorage migration from the legacy `keellearn.*` key.
 * Runs idempotently and silently; demo state is non-essential.
 */
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
    // quota / privacy-mode — proceed without migration
  }
}

let migrated = false;
function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  migrateLegacy();
}

function readRaw(): ErrorBankEntry[] {
  ensureMigrated();
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Defensive filter — a stale entry from an older schema must not
    // crash the UI. We drop anything whose shape we don't recognise.
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is ErrorBankEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ErrorBankEntry>;
  return (
    typeof v.ts === "number" &&
    typeof v.category === "string" &&
    (TRACKED_CATEGORIES as string[]).includes(v.category)
  );
}

function writeRaw(entries: ErrorBankEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota — ignore; the in-memory notify still fires
  }
}

function notify(entries: ErrorBankEntry[]): void {
  listeners.forEach((fn) => {
    try {
      fn(entries);
    } catch {
      // a bad subscriber must not poison the rest
    }
  });
}

/** Returns a snapshot of the current bank, newest last. */
export function readErrorBank(): ErrorBankEntry[] {
  return readRaw();
}

/**
 * Records an observed error. Returns the updated bank snapshot so callers
 * can update UI without a separate read. Silently ignores `correct` and
 * `no_attempt` to keep the contract obvious at the call site.
 */
export function recordError(
  category: AnswerCategory,
  problemTitle?: string,
): ErrorBankEntry[] {
  if (category === "correct" || category === "no_attempt") {
    return readRaw();
  }
  const entry: ErrorBankEntry = {
    ts: Date.now(),
    category,
    ...(problemTitle ? { problemTitle } : {}),
  };
  const next = [...readRaw(), entry];
  while (next.length > MAX_ENTRIES) next.shift();
  writeRaw(next);
  notify(next);
  return next;
}

/**
 * Clears the learner's journal entirely. This is a learner-controlled
 * action; the UI wires it to an explicit "clear my journal" button.
 */
export function clearErrorBank(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  notify([]);
}

/**
 * Subscribes to updates. Returns an unsubscribe function. The callback
 * fires on every recordError / clearErrorBank call in the same tab;
 * cross-tab sync is via the existing data bus, not here.
 */
export function subscribeErrorBank(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Aggregates the bank into per-category counts for UI presentation.
 * Returned array is filtered to categories with at least one observation
 * and sorted by frequency descending, then by recency descending.
 */
export interface PatternSummary {
  category: TrackedCategory;
  detail: PatternDetail;
  count: number;
  lastSeen: number;
}

export function summariseErrorBank(
  entries: ErrorBankEntry[] = readRaw(),
): PatternSummary[] {
  const counts = new Map<TrackedCategory, { count: number; lastSeen: number }>();
  for (const e of entries) {
    const prev = counts.get(e.category);
    if (prev) {
      prev.count += 1;
      if (e.ts > prev.lastSeen) prev.lastSeen = e.ts;
    } else {
      counts.set(e.category, { count: 1, lastSeen: e.ts });
    }
  }
  return Array.from(counts.entries())
    .map(([category, { count, lastSeen }]) => ({
      category,
      detail: PATTERNS[category],
      count,
      lastSeen,
    }))
    .sort(
      (a, b) => b.count - a.count || b.lastSeen - a.lastSeen,
    );
}

/** Test-only: reset the in-module migration flag. Exported for unit tests that
 *  want to simulate a fresh module load without reloading the whole module. */
export const __resetMigrationFlagForTests = (): void => {
  migrated = false;
};
