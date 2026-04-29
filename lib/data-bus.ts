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
// • Payloads are plain JSON and are NOT encrypted. Anything written here is
//   readable by any JavaScript on the same origin — treat it like session
//   storage.
// • Subscribers are called synchronously on receipt. Do not block.
//
// TYPED EVENT CATALOGUE
// ─────────────────────
// The `BusEvent` union is the single contract between producers and
// consumers. Add new events there. Everything else is schema-validated by
// TypeScript at compile time.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All event types that flow on the bus. Add new members here rather than
 * using free-form strings, so consumers get exhaustive switch coverage.
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
  | "student.crt.signed"            // a CRT was cryptographically signed
  | "teacher.logic_bridge.pushed"   // teacher pushed a Logic Bridge to class
  | "teacher.honors.pushed"         // teacher pushed an honors prompt
  | "compliance.conflict.resolved"  // a regulatory conflict was signed off
  | "safeguarding.escalation.requested" // Decision Gate fired a crisis match — category only, never text (v1.4.8)
  | "student.session.paused"        // SafetyGate paused the /student surface (bedtime or daily cap) (v1.5.4)
  | "student.session.resumed"       // SafetyGate released a previously-paused session (v1.5.4)
  | "parent.erasure.completed"      // GDPR Art. 17 erasure ran; payload reports counts (v1.5.4)
  | "student.crt.session.finalized" // a per-problem CRT session was finalized + signed (v1.5.4 follow-up)
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
const LOG_STORAGE_KEY = "evenkeel.bus.log";
const MAX_LOG_ENTRIES = 50;

// ─── Runtime state ───────────────────────────────────────────────────────────
// All browser-only. Kept at module scope so repeated imports share one bus.

let bc: BroadcastChannel | null = null;
let initialised = false;
const listeners = new Set<Listener>();

/**
 * One-time localStorage key migration from the legacy `keellearn.*`
 * namespace to `evenkeel.*` (rename in v1.4.1). Runs idempotently and
 * silently — failure is ignored because demo state is non-essential.
 */
function migrateLegacyKeys(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem("keellearn.bus.log");
    if (legacy && !window.localStorage.getItem(LOG_STORAGE_KEY)) {
      window.localStorage.setItem(LOG_STORAGE_KEY, legacy);
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

  // Primary transport: BroadcastChannel.
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (ev: MessageEvent<BusEvent>) => dispatch(ev.data);
    }
  } catch {
    bc = null;
  }

  // Fallback transport: localStorage storage events across tabs.
  window.addEventListener("storage", (ev) => {
    if (ev.key !== LOG_STORAGE_KEY || !ev.newValue) return;
    try {
      const parsed = JSON.parse(ev.newValue) as BusEvent[];
      const last = parsed[parsed.length - 1];
      if (last) dispatch(last);
    } catch {
      // corrupt log — ignore
    }
  });
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
 * Appends the event to the bounded localStorage ring buffer so late-mounting
 * surfaces can replay history. Bounded to `MAX_LOG_ENTRIES`.
 */
function appendToLog(event: BusEvent): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY);
    const current: BusEvent[] = raw ? JSON.parse(raw) : [];
    current.push(event);
    while (current.length > MAX_LOG_ENTRIES) current.shift();
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // quota exceeded or disabled — ignore; transport still works
  }
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
 * Returns the current ring-buffer of recent events, newest last. Useful for
 * surfaces that mount *after* something interesting happened and want to
 * backfill a feed with the last N events.
 */
export function recentEvents(limit = MAX_LOG_ENTRIES): BusEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BusEvent[];
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Clears the ring buffer. Useful for tests and for a future "reset demo"
 * button. Does not cancel in-flight subscribers.
 */
export function clearHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOG_STORAGE_KEY);
  } catch {
    // ignore
  }
}
