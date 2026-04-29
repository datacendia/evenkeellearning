// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/retry-scheduler.ts
//
// v1.4.10 — Background retry-on-schedule for the DSL escalation queue.
//
// In v1.4.8 a `failed` escalation entry sat in the queue until a Compliance
// Officer manually clicked "Re-attempt" on the `/compliance` Safeguarding
// tab. That was honest about Phase-1 limits but brittle: a failed delivery
// could be missed for hours.
//
// v1.4.10 ships a deterministic retry scheduler. It is browser-only —
// `setInterval`-driven, so the page must be open. Documented honestly:
// this module **does not** turn the prototype into a server-side reliable
// queue. It does, however, make a plausibly-attended Compliance dashboard
// re-attempt failed deliveries automatically on a published cadence.
//
// Design choices and their honesty:
//   • Backoff is exponential with a fixed base (60 000 ms) and cap
//     (24 hours). After `MAX_DELIVERY_ATTEMPTS` is reached, the entry
//     stays `failed` forever — never silently retried into an off-by-one
//     attempt count.
//   • The scheduler operates on the *unsigned* `deliveryState`. The
//     signed envelope is never mutated. WORM contract preserved.
//   • A single instance per tab. `start` is idempotent; double-calling
//     it returns the existing handle.
//   • `runRetryTick` is exposed and pure-ish (it depends on
//     `Date.now()` and the queue) so tests can drive it deterministically
//     with `vi.useFakeTimers()` + `vi.setSystemTime()`.
//
// Privacy contract: no entry payload data leaves this module. We log
// counters only, not ids, not categories, not timestamps. The bus
// already has an event for "delivery happened" (the existing
// `safeguarding.escalation.requested` is for *enqueue*; we deliberately
// do NOT add a new bus event for retries — counters are local).
// ─────────────────────────────────────────────────────────────────────────────

import {
  attemptWebhookDelivery,
  listEscalations,
  MAX_DELIVERY_ATTEMPTS,
  pruneExpiredEscalations,
  type EscalationEntry,
} from "./escalation-queue";

/** Default tick interval — 60 s. Tests override via the start options. */
export const DEFAULT_TICK_INTERVAL_MS = 60_000;

/** Base delay for the first retry, doubling each subsequent attempt. */
export const BACKOFF_BASE_MS = 60_000;

/** Hard ceiling on the exponential backoff (24 hours). */
export const BACKOFF_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * Pure helper — returns the wait, in ms, that should elapse after
 * `lastFailedAt` before the next retry is attempted, given how many
 * attempts have already been made (1-based).
 *
 * Schedule: 1m, 2m, 4m, 8m, 16m, 32m, 1h4m, 2h8m, 4h16m, 8h32m, 17h, 24h…
 *
 * Capped at `BACKOFF_CAP_MS` so a long-running tab does not push the
 * next attempt absurdly far into the future. Pure / deterministic so
 * the unit tests can pin the table exactly.
 */
export function computeBackoffMs(attemptCount: number): number {
  if (attemptCount < 1) return BACKOFF_BASE_MS;
  const exp = Math.min(attemptCount - 1, 30); // guard against overflow
  const raw = BACKOFF_BASE_MS * Math.pow(2, exp);
  return Math.min(raw, BACKOFF_CAP_MS);
}

/**
 * Pure helper — given an entry, returns true iff a retry attempt is
 * due *now*. Uses the entry's `deliveryState.lastFailedAt` against the
 * computed backoff. Returns false for any non-`failed` state, for
 * entries that have already exhausted `MAX_DELIVERY_ATTEMPTS`, and for
 * entries whose backoff window has not yet elapsed.
 *
 * Exposed for tests; production calls `runRetryTick()`.
 */
export function shouldRetry(
  entry: EscalationEntry,
  now: number = Date.now(),
): boolean {
  if (entry.deliveryState.kind !== "failed") return false;
  const { attemptCount, lastFailedAt } = entry.deliveryState;
  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) return false;
  const wait = computeBackoffMs(attemptCount);
  return now - lastFailedAt >= wait;
}

/** Counters returned by `runRetryTick` — pure metadata, no payload. */
export interface RetryTickResult {
  /** Wall-clock ms when this tick began. */
  tickAt: number;
  /** Number of failed-but-due entries this tick attempted. */
  attempted: number;
  /** Of those attempts, how many transitioned to `sent`. */
  succeeded: number;
  /** Of those attempts, how many remained in `failed`. */
  stillFailed: number;
  /** Number of expired entries pruned by this tick. */
  pruned: number;
}

/**
 * Walks the queue once and re-attempts every `failed` entry whose
 * backoff window has elapsed. Also runs the WORM time-prune so an
 * always-on Compliance dashboard self-maintains.
 *
 * Returns counters only. Errors inside `attemptWebhookDelivery` are
 * already absorbed into the entry's `deliveryState`; this function
 * never throws.
 */
export async function runRetryTick(
  now: number = Date.now(),
): Promise<RetryTickResult> {
  const result: RetryTickResult = {
    tickAt: now,
    attempted: 0,
    succeeded: 0,
    stillFailed: 0,
    pruned: 0,
  };
  // 1. WORM prune. Run first so a retry isn't wasted on something that
  //    is about to expire anyway.
  result.pruned = pruneExpiredEscalations(now);

  // 2. Retry pass.
  const queue = listEscalations();
  for (const entry of queue) {
    if (!shouldRetry(entry, now)) continue;
    result.attempted += 1;
    const after = await attemptWebhookDelivery(entry.id);
    if (!after) continue;
    if (after.deliveryState.kind === "sent") result.succeeded += 1;
    else if (after.deliveryState.kind === "failed") result.stillFailed += 1;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Process-wide single instance
// ─────────────────────────────────────────────────────────────────────────────

interface RetrySchedulerHandle {
  /** Stop the scheduler. Idempotent. */
  stop: () => void;
  /** True between `start()` and `stop()`. */
  isRunning: () => boolean;
  /** Force a single tick now, outside the regular cadence. Returns counters. */
  runNow: () => Promise<RetryTickResult>;
}

let active: RetrySchedulerHandle | null = null;

export interface StartRetrySchedulerOptions {
  /** Override the default 60 s tick. Useful in tests. */
  tickIntervalMs?: number;
  /**
   * Optional listener invoked after every tick with the counters
   * object. Defaults to a no-op. Errors thrown from the listener are
   * absorbed so a misbehaving caller cannot stop the scheduler.
   */
  onTick?: (result: RetryTickResult) => void;
}

/**
 * Start the singleton retry scheduler. If one is already running, the
 * existing handle is returned (idempotent — double-calling does NOT
 * create overlapping intervals).
 */
export function startRetryScheduler(
  options: StartRetrySchedulerOptions = {},
): RetrySchedulerHandle {
  if (active) return active;
  if (typeof window === "undefined") {
    // Headless env (SSR, vitest without happy-dom). Return a no-op
    // handle so callers don't have to branch.
    return {
      stop: () => {},
      isRunning: () => false,
      runNow: async () => ({
        tickAt: Date.now(),
        attempted: 0,
        succeeded: 0,
        stillFailed: 0,
        pruned: 0,
      }),
    };
  }

  const interval = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const onTick = options.onTick ?? (() => {});

  const fire = async () => {
    let result: RetryTickResult;
    try {
      result = await runRetryTick();
    } catch {
      // Defensive: should never happen, since runRetryTick swallows
      // its own errors, but a misbehaving fetch polyfill could throw
      // synchronously. Keep the scheduler alive.
      return;
    }
    try {
      onTick(result);
    } catch {
      // listener errors must not propagate.
    }
  };

  const handle = window.setInterval(fire, interval);
  let running = true;

  active = {
    stop: () => {
      if (!running) return;
      running = false;
      window.clearInterval(handle);
      active = null;
    },
    isRunning: () => running,
    runNow: async () => {
      const r = await runRetryTick();
      try {
        onTick(r);
      } catch {
        // ignore
      }
      return r;
    },
  };
  return active;
}

/** Stops the singleton scheduler if running; otherwise a no-op. */
export function stopRetryScheduler(): void {
  if (active) active.stop();
}

/** True when a singleton scheduler is currently running in this tab. */
export function isRetrySchedulerRunning(): boolean {
  return Boolean(active && active.isRunning());
}
