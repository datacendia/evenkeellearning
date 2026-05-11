// ─────────────────────────────────────────────────────────────────────────────
// lib/data-bus.ts
//
// Cross-surface event bus. The point is to let the student / parent / teacher
// / compliance surfaces react to each other in real time without a server.
//
// IMPLEMENTATION
// ──────────────
// Two transport layers, chosen at runtime:
//
//  1. BroadcastChannel — fires across every open tab in the same browser on
//     the same origin. Used as the primary transport when available.
//  2. localStorage "storage" events — used as a compatibility fallback; the
//     `storage` event fires on *other* tabs when a key is written, which
//     gives us a best-effort notification channel on browsers that do not
//     support BroadcastChannel.
//
// We *also* always write the event into a bounded localStorage ring buffer
// (`evenkeel.bus.log`) so that a surface which mounts *after* an event was
// published can still replay recent history. This is what powers the "a
// student cleared a gate 14s ago" card on the parent feed when you open it
// for the first time.
//
// HONESTY
// ───────
// • Scope: one browser, one device. This is not a network. If you want two
//   laptops to see each other, you need a server — see EVENKEEL_BIBLE.md §8.
// • v1.6.0 — audit M-3: the localStorage ring buffer is now AES-GCM
//   encrypted with a non-extractable device key stored in IndexedDB.
//   See `lib/bus-at-rest.ts` for the threat model. The in-memory mirror
//   and the cross-tab BroadcastChannel are still plaintext JSON (they
//   live in process memory on the same origin — encryption there would
//   be theatre). The at-rest encryption closes the profile-dump, backup-
//   leak, and shared-device threat vectors.
// • Subscribers are called synchronously on receipt. Do not block.
//
// TYPED EVENT CATALOGUE
// ─────────────────────
// The `BusEvent` union is the single contract between producers and
// consumers. Add new events there. Everything else is schema-validated by
// TypeScript at compile time.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BUS_LOG_STORAGE_KEY,
  readBusLog,
  writeBusLog,
} from "@/lib/bus-at-rest";

/**
 * All event types that flow on the bus. Add new members here rather than
 * using free-form strings, so consumers get exhaustive switch coverage.
 *
 * v1.5.5 — audit M-5: clarification of the two CRT-signing events.
 *
 * `student.crt.signed` — fires from `EkeChat.tsx` once per learner
 * submission. Carries an envelope summary (digest + signature prefix +
 * keyType + per-attempt fields like `inputDigestB64url`, `inputChars`,
 * trust). Read by the Compliance Integrity Ledger and Parent feed.
 *
 * `student.crt.session.finalized` — fires from `lib/crt/bank.ts` once
 * per CRT session, when the EkeChat component unmounts (or the
 * `problemId` prop changes). Carries aggregated session metadata
 * (eventCount, deletionCount, pivotCount, durationMs, contentDigest).
 * Marks the moment the WHOLE-SESSION envelope landed in the local CRT
 * bank.
 *
 * The two are NOT duplicates — they live at different granularities and
 * a session may emit many `student.crt.signed` events but exactly one
 * `student.crt.session.finalized`. Consumers that care about "did
 * anything happen on this problem" should listen for the session-
 * finalized event; consumers that want every attempt should listen for
 * the per-submission event.
 */
export type BusEventType =
  | "student.problem.started"       // a student began a problem
  | "student.gate.cleared"          // a student cleared a comprehension gate
  | "student.hint.requested"        // a student asked Eke for a hint
  | "student.answer.validated"      // a student's numeric answer attempt was diagnosed (v1.4.0)
  | "student.error.observed"        // a non-correct answer category was added to the learner's personal error-bank (v1.4.2)
  | "student.practice.session"      // private-practice-mode session bracket — only metadata, never contents (v1.4.3)
  | "student.paste.blocked"         // IPA blocked a paste attempt
  | "student.submit"                // a student submitted reasoning
  | "student.crt.signed"            // a per-submission CRT was signed (one event per learner submit)
  | "teacher.logic_bridge.pushed"   // teacher pushed a Logic Bridge to class
  | "teacher.honors.pushed"         // teacher pushed an honors prompt
  | "compliance.conflict.resolved"  // a regulatory conflict was signed off
  | "safeguarding.escalation.requested" // Decision Gate fired a crisis match — category only, never text (v1.4.8)
  | "student.session.paused"        // SafetyGate paused the /student surface (bedtime or daily cap) (v1.5.4)
  | "student.session.resumed"       // SafetyGate released a previously-paused session (v1.5.4)
  | "parent.erasure.completed"      // GDPR Art. 17 erasure ran; payload reports counts (v1.5.4)
  | "student.crt.session.finalized" // a per-problem CRT session was finalized + signed (v1.5.4 follow-up)
  | "roster.import.committed"       // teacher committed a CSV roster import; payload is counts + digest only, never PII (v1.6.6)
  | "system.ping";                  // heartbeat, mostly for tests

/** Shape of a single bus event. `ts` and `id` are set by `publish()`. */
export interface BusEvent<P = Record<string, unknown>> {
  /** Event type; see BusEventType. */
  type: BusEventType;
  /** Payload; arbitrary JSON. */
  payload: P;
  /** Epoch milliseconds at publish time. */
  ts: number;
  /** Unique per event. */
  id: string;
  /** Origin surface that published this event ("student", "teacher", …). */
  source: string;
}

type Listener = (event: BusEvent) => void;

const CHANNEL_NAME = "evenkeel.bus";
const MAX_LOG_ENTRIES = 50;

// ─── Runtime state ───────────────────────────────────────────────────────────
// All browser-only. Kept at module scope so repeated imports share one bus.

let bc: BroadcastChannel | null = null;
let initialised = false;
const listeners = new Set<Listener>();

/**
 * In-memory mirror of the encrypted on-disk ring buffer. Exists so that
 * `recentEvents()` can stay synchronous even though the on-disk read
 * path is async (AES-GCM decrypt + IndexedDB fetch). Hydrated during
 * init(); written-through on every publish().
 *
 * On first load this starts empty and backfills after hydration — the
 * window is typically <50ms and the only observable effect is that the
 * parent feed flashes "no recent events" briefly. Consumers that need
 * the hydrated log synchronously should `await whenReady()` first.
 */
let memoryMirror: BusEvent[] = [];
let hydrationPromise: Promise<void> | null = null;
/** Serialises the async flush queue so concurrent publishes don't race. */
let flushChain: Promise<void> = Promise.resolve();

/**
 * One-time localStorage key migration from the legacy `keellearn.*`
 * namespace to `evenkeel.*` (rename in v1.4.1). Runs idempotently and
 * silently — failure is ignored because demo state is non-essential.
 */
function migrateLegacyKeys(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem("keellearn.bus.log");
    if (legacy && !window.localStorage.getItem(BUS_LOG_STORAGE_KEY)) {
      window.localStorage.setItem(BUS_LOG_STORAGE_KEY, legacy);
    }
    if (legacy !== null) {
      window.localStorage.removeItem("keellearn.bus.log");
    }
  } catch {
    // Quota / privacy mode — proceed without history.
  }
}

function init(): void {
  if (initialised || typeof window === "undefined") return;
  initialised = true;
  migrateLegacyKeys();

  // Hydrate the in-memory mirror from encrypted storage. If a legacy
  // plaintext log exists we read it once and re-persist encrypted.
  hydrationPromise = (async () => {
    try {
      const { events, wasLegacyPlaintext } = await readBusLog<BusEvent>();
      memoryMirror = events.slice(-MAX_LOG_ENTRIES);
      if (wasLegacyPlaintext) {
        await writeBusLog(memoryMirror);
      }
    } catch {
      // Decryption / storage failed — the bus still works in-memory,
      // the ring buffer just doesn't rehydrate. Honest degradation.
      memoryMirror = [];
    }
  })();

  // Primary transport: BroadcastChannel.
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (ev: MessageEvent<BusEvent>) => {
        // Mirror cross-tab events locally so recentEvents() reflects them.
        memoryMirror.push(ev.data);
        while (memoryMirror.length > MAX_LOG_ENTRIES) memoryMirror.shift();
        dispatch(ev.data);
      };
    }
  } catch {
    bc = null;
  }

  // Fallback transport: storage events. The value is an encrypted
  // envelope, so we kick off an async re-hydrate and dispatch the delta
  // on completion.
  window.addEventListener("storage", (ev) => {
    if (ev.key !== BUS_LOG_STORAGE_KEY || !ev.newValue) return;
    void (async () => {
      try {
        const { events } = await readBusLog<BusEvent>();
        const seen = new Set(memoryMirror.map((e) => e.id));
        const fresh = events.filter((e) => !seen.has(e.id));
        if (fresh.length === 0) return;
        memoryMirror = events.slice(-MAX_LOG_ENTRIES);
        for (const e of fresh) dispatch(e);
      } catch {
        // corrupt or unreadable — ignore
      }
    })();
  });
}

/**
 * Resolves once the encrypted on-disk ring buffer has been decrypted
 * into the in-memory mirror. Safe to call before init() — it triggers
 * init() and then waits. Useful for tests and for consumers that want
 * to backfill a feed only after hydration.
 */
export function whenReady(): Promise<void> {
  init();
  return hydrationPromise ?? Promise.resolve();
}

/**
 * Calls every local subscriber with the event. Swallows subscriber errors so
 * that one bad listener cannot poison the channel for the rest.
 */
function dispatch(event: BusEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[data-bus] listener threw:", err);
    }
  });
}

/**
 * Appends the event to the in-memory mirror (sync, authoritative for
 * this tab) and schedules an async flush to the encrypted localStorage
 * ring buffer. Flushes are serialised through `flushChain` so two
 * concurrent publishes can't clobber each other's write.
 *
 * Bounded to `MAX_LOG_ENTRIES` in both the mirror and the on-disk log.
 */
function appendToLog(event: BusEvent): void {
  memoryMirror.push(event);
  while (memoryMirror.length > MAX_LOG_ENTRIES) memoryMirror.shift();
  if (typeof window === "undefined") return;

  flushChain = flushChain.then(async () => {
    try {
      // Take a snapshot of the mirror at flush time. We do NOT read
      // back from disk here — the mirror is authoritative for this tab,
      // and cross-tab merges happen via the `storage` event listener.
      await writeBusLog(memoryMirror.slice());
    } catch {
      // Encryption / storage failed — the bus still works in-memory.
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Publishes an event to every subscriber in every tab. Returns the fully
 * hydrated `BusEvent` (including id and ts) for local consumption.
 *
 * The event fires locally *and* on other tabs; a publisher will always see
 * its own event in any listeners it has registered.
 */
export function publish<P extends Record<string, unknown>>(
  type: BusEventType,
  payload: P,
  source: string
): BusEvent<P> {
  init();
  const event: BusEvent<P> = {
    type,
    payload,
    ts: Date.now(),
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    source,
  };
  try {
    bc?.postMessage(event);
  } catch {
    // channel closed unexpectedly; fall back to the storage event only
  }
  appendToLog(event as BusEvent);
  dispatch(event as BusEvent);
  return event;
}

/**
 * Subscribes to every event. Returns an unsubscribe function.
 *
 * Typical usage inside a React client component:
 * ```ts
 * useEffect(() => subscribe((e) => { if (e.type === "student.gate.cleared") setCount(c => c+1); }), []);
 * ```
 */
export function subscribe(listener: Listener): () => void {
  init();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Returns the current ring-buffer of recent events, newest last. Served
 * synchronously from the in-memory mirror. On cold start the mirror may
 * be empty for the ~50ms window between `init()` and hydration complete;
 * callers that must have the hydrated log should `await whenReady()`.
 */
export function recentEvents(limit = MAX_LOG_ENTRIES): BusEvent[] {
  init();
  return memoryMirror.slice(-limit);
}

/**
 * Clears the ring buffer. Useful for tests and for a future "reset demo"
 * button. Does not cancel in-flight subscribers. Flushes the cleared
 * state to encrypted storage so a subsequent reload sees the same view.
 */
export function clearHistory(): void {
  memoryMirror = [];
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BUS_LOG_STORAGE_KEY);
  } catch {
    // ignore
  }
}
