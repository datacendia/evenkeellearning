// ─────────────────────────────────────────────────────────────────────────────
// lib/eke/practice-mode.ts
//
// Private practice mode. The single architectural decision this module
// implements: a learner can choose to practise without their per-event
// behaviour streaming into the Teacher Integrity Ledger. The teacher is
// told *whether* practice happened — never *what* went wrong in it.
//
// Why this exists (PROPOSAL_TRUTH_PACK.md, the consolidated review):
//   • The architectural choice that "every interaction feeds the Integrity
//     Ledger" is a surveillance choice, not a neutral default. For
//     anxious, SEN, previously-shamed, or simply self-conscious learners,
//     surveillance is the thing that prevents engagement with the practice
//     they need most. Lifting that surveillance — under a contract the
//     teacher can see and trust — is one of the highest-leverage pedagogy
//     moves available on this architecture.
//
// Contract
// ────────
//   • While practice mode is active, every `student.*` bus event carries
//     `{ practiceMode: true, practiceSessionId: <id> }` in its payload.
//     Consumers (the Teacher Integrity Ledger) are responsible for
//     filtering these out from the per-event view. They are NOT removed
//     from the bus — they remain on the localStorage ring so the
//     learner's own surfaces (parent feed, error-bank) still see them.
//   • A separate bus event `student.practice.session` is emitted on
//     enable (`{ active: true, sessionId }`) and on disable
//     (`{ active: false, sessionId, durationMs }`). This is the ONLY
//     practice-related event the teacher view shows, and its payload
//     deliberately contains no contents — just session metadata.
//   • The personal error-bank (`lib/eke/error-bank.ts`) STILL records
//     during practice. The contract is about teacher visibility, not
//     learner-self visibility; the learner's private journal is theirs
//     either way.
//
// Phase-1 honesty (HONESTY.md)
// ────────────────────────────
// Filtering is enforced at the consumer (the teacher's `Ledger` component),
// not by separate per-role transport. A curious teacher inspecting
// `evenkeel.bus.log` in localStorage on the same browser could see filtered
// events. Phase 2 fix is per-role buses or encrypted practice payloads. The
// pilot deployment of this prototype is single-device demo, so the consumer
// filter is a credible Phase-1 contract — but it is not a security boundary.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "evenkeel.eke.practiceMode";
const LEGACY_STORAGE_KEY = "keellearn.kele.practiceMode";

export interface PracticeState {
  /** True iff a practice session is currently active. */
  active: boolean;
  /** Stable id for the current session; undefined when inactive. */
  sessionId?: string;
  /** Epoch ms when the current session began; undefined when inactive. */
  startedAt?: number;
}

type Listener = (state: PracticeState) => void;
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

function readRaw(): PracticeState {
  ensureMigrated();
  if (typeof window === "undefined") return { active: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { active: false };
    const parsed = JSON.parse(raw) as Partial<PracticeState>;
    if (typeof parsed?.active !== "boolean") return { active: false };
    if (!parsed.active) return { active: false };
    // Defensive: an "active" record with no sessionId is corrupt; treat as off.
    if (typeof parsed.sessionId !== "string" || parsed.sessionId.length === 0) {
      return { active: false };
    }
    return {
      active: true,
      sessionId: parsed.sessionId,
      startedAt:
        typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt)
          ? parsed.startedAt
          : Date.now(),
    };
  } catch {
    return { active: false };
  }
}

function writeRaw(state: PracticeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota — ignore; in-memory notify still fires
  }
}

function notify(state: PracticeState): void {
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      // a bad subscriber must not poison the rest
    }
  });
}

function makeSessionId(): string {
  // Short, opaque, not seeded with anything identifying. Same shape as the
  // ids the data bus generates for events.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns the current state. Cheap; reads localStorage. */
export function getPracticeState(): PracticeState {
  return readRaw();
}

/** Convenience predicate. */
export function isPracticeActive(): boolean {
  return readRaw().active;
}

/**
 * Begins a practice session if one is not already active. Returns the
 * (possibly pre-existing) session id for the caller to forward into bus
 * events. Idempotent: calling while already active is a no-op that returns
 * the existing session id.
 */
export function startPracticeSession(): string {
  const current = readRaw();
  if (current.active && current.sessionId) return current.sessionId;
  const next: PracticeState = {
    active: true,
    sessionId: makeSessionId(),
    startedAt: Date.now(),
  };
  writeRaw(next);
  notify(next);
  return next.sessionId!;
}

/**
 * Ends the active practice session and returns the session id and
 * duration so the caller can emit the closing `student.practice.session`
 * bus event. Returns `null` when no session was active. Idempotent.
 */
export function endPracticeSession(): {
  sessionId: string;
  durationMs: number;
} | null {
  const current = readRaw();
  if (!current.active || !current.sessionId) return null;
  const startedAt = current.startedAt ?? Date.now();
  const closing = {
    sessionId: current.sessionId,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  writeRaw({ active: false });
  notify({ active: false });
  return closing;
}

/**
 * Subscribes to state changes. Returns an unsubscribe function. The
 * callback fires synchronously after each start/end.
 */
export function subscribePracticeMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Test-only: reset the in-module migration flag so the legacy-migration
 * path can be re-exercised within a single test process.
 */
export const __resetMigrationFlagForTests = (): void => {
  migrated = false;
};
