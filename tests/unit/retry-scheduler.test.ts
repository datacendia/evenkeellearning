// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/retry-scheduler.test.ts
//
// Pins the v1.4.10 retry scheduler:
//   1. `computeBackoffMs` is a pure deterministic table — exact values per
//      attemptCount up to the 24 h cap.
//   2. `shouldRetry` returns true only when the entry is `failed`, has not
//      exhausted attempts, and the backoff window has elapsed.
//   3. `runRetryTick` calls webhook delivery for every due failed entry,
//      records counters, and runs the WORM prune as a side effect.
//   4. `runRetryTick` never throws even if the underlying fetch / sign
//      paths reject.
//   5. `startRetryScheduler` is idempotent (double-start returns the
//      same handle).
//   6. `stopRetryScheduler` works after a real start.
// ─────────────────────────────────────────────────────────────────────────────

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  computeBackoffMs,
  isRetrySchedulerRunning,
  runRetryTick,
  shouldRetry,
  startRetryScheduler,
  stopRetryScheduler,
} from "@/lib/safeguarding/retry-scheduler";
import {
  enqueueEscalation,
  clearEscalations,
  listEscalations,
  MAX_DELIVERY_ATTEMPTS,
  type EnqueueInput,
  type EscalationEntry,
} from "@/lib/safeguarding/escalation-queue";
import {
  setWebhookEndpoint,
  clearWebhookEndpoint,
} from "@/lib/safeguarding/webhook-config";
import { resetSessionKeyPair } from "@/lib/crypto/signing";

const QUEUE_KEY = "evenkeel.safeguarding.queue.v1";
const WEBHOOK_KEY = "evenkeel.safeguarding.webhook.v1";
const TAB_KEY = "evenkeel.safeguarding.tabContextId.v1";

const SAMPLE: EnqueueInput = {
  triggerType: "crisis_response",
  crisisPatternCategory: "direct_self_harm",
  jurisdiction: "IE",
};

beforeEach(() => {
  window.localStorage.removeItem(QUEUE_KEY);
  window.localStorage.removeItem(WEBHOOK_KEY);
  try {
    window.sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* ignore */
  }
  resetSessionKeyPair();
  stopRetryScheduler();
});

afterEach(() => {
  stopRetryScheduler();
  clearEscalations();
  clearWebhookEndpoint();
});

// ─── computeBackoffMs ────────────────────────────────────────────────────────

describe("retry-scheduler: computeBackoffMs", () => {
  it("returns the base delay for attemptCount 1", () => {
    expect(computeBackoffMs(1)).toBe(BACKOFF_BASE_MS);
  });

  it("doubles for each subsequent attempt", () => {
    expect(computeBackoffMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(computeBackoffMs(3)).toBe(BACKOFF_BASE_MS * 4);
    expect(computeBackoffMs(4)).toBe(BACKOFF_BASE_MS * 8);
  });

  it("is capped at BACKOFF_CAP_MS no matter how many attempts", () => {
    // 11 attempts → 60 000 * 2^10 = 61 440 000 ms ≈ 17 hours, still under cap
    // 12 attempts → 60 000 * 2^11 ≈ 34 hours, capped to 24 hours
    expect(computeBackoffMs(11)).toBeLessThan(BACKOFF_CAP_MS);
    expect(computeBackoffMs(12)).toBe(BACKOFF_CAP_MS);
    expect(computeBackoffMs(20)).toBe(BACKOFF_CAP_MS);
    expect(computeBackoffMs(100)).toBe(BACKOFF_CAP_MS);
  });

  it("treats non-positive attemptCount as the base delay", () => {
    expect(computeBackoffMs(0)).toBe(BACKOFF_BASE_MS);
    expect(computeBackoffMs(-3)).toBe(BACKOFF_BASE_MS);
  });
});

// ─── shouldRetry ─────────────────────────────────────────────────────────────

describe("retry-scheduler: shouldRetry", () => {
  function makeFailedEntry(
    attemptCount: number,
    lastFailedAt: number,
  ): EscalationEntry {
    return {
      id: "esc_test",
      detectedAt: lastFailedAt - 1000,
      envelope: {
        algorithm: "ECDSA-P256-SHA256",
        publicKeyB64url: "stub",
        contentDigestB64url: "stub",
        signatureB64url: "stub",
        signedAtIso: new Date(lastFailedAt).toISOString(),
        payload: {} as never,
      } as EscalationEntry["envelope"],
      deliveryState: {
        kind: "failed",
        attemptCount,
        lastError: "stub",
        lastFailedAt,
      },
    };
  }

  it("returns false for non-failed states", () => {
    const queued = makeFailedEntry(1, 0);
    (queued as unknown as { deliveryState: unknown }).deliveryState = {
      kind: "queued",
    };
    expect(shouldRetry(queued, 999_999)).toBe(false);
  });

  it("returns true after backoff window has elapsed", () => {
    const lastFailed = 1_000_000;
    const e = makeFailedEntry(1, lastFailed);
    expect(shouldRetry(e, lastFailed + BACKOFF_BASE_MS - 1)).toBe(false);
    expect(shouldRetry(e, lastFailed + BACKOFF_BASE_MS)).toBe(true);
    expect(shouldRetry(e, lastFailed + BACKOFF_BASE_MS * 10)).toBe(true);
  });

  it("returns false once attempts have been exhausted", () => {
    const e = makeFailedEntry(MAX_DELIVERY_ATTEMPTS, 0);
    expect(shouldRetry(e, BACKOFF_CAP_MS * 100)).toBe(false);
  });

  it("respects exponential backoff per attemptCount", () => {
    const e2 = makeFailedEntry(2, 0);
    expect(shouldRetry(e2, BACKOFF_BASE_MS * 2 - 1)).toBe(false);
    expect(shouldRetry(e2, BACKOFF_BASE_MS * 2)).toBe(true);
  });
});

// ─── runRetryTick ────────────────────────────────────────────────────────────

describe("retry-scheduler: runRetryTick", () => {
  it("returns zeroed counters on an empty queue", async () => {
    const r = await runRetryTick();
    expect(r.attempted).toBe(0);
    expect(r.succeeded).toBe(0);
    expect(r.stillFailed).toBe(0);
    expect(r.pruned).toBe(0);
    expect(typeof r.tickAt).toBe("number");
  });

  it("attempts only failed-due entries, leaves the rest alone", async () => {
    setWebhookEndpoint("https://example.test/ingest");
    // Stub fetch so the mock 503 reliably transitions to `failed`.
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("oops", { status: 503 });
    }) as typeof fetch;

    try {
      // Enqueue two; only the first will be marked failed-and-due.
      const a = await enqueueEscalation(SAMPLE);
      await enqueueEscalation({
        ...SAMPLE,
        crisisPatternCategory: "indirect_distress",
      });

      // Simulate that the first entry already failed once, long enough
      // ago for its backoff window to have elapsed. Rewrite localStorage
      // to set up the state — same pattern as the WORM tests.
      const raw = JSON.parse(window.localStorage.getItem(QUEUE_KEY)!);
      raw[0].deliveryState = {
        kind: "failed",
        attemptCount: 1,
        lastError: "HTTP 503",
        lastFailedAt: Date.now() - BACKOFF_BASE_MS - 1000,
      };
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));

      const result = await runRetryTick();
      expect(result.attempted).toBe(1);
      expect(result.stillFailed + result.succeeded).toBe(1);

      // The second entry, still in `queued`, must not have been touched.
      const after = listEscalations().find((e) => e.id !== a.id)!;
      expect(after.deliveryState.kind).toBe("queued");
    } finally {
      globalThis.fetch = realFetch;
      clearWebhookEndpoint();
    }
    // sanity: at least one fetch happened
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("never throws even if delivery sub-paths reject", async () => {
    setWebhookEndpoint("https://example.test/ingest");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network exploded");
    }) as typeof fetch;
    try {
      await enqueueEscalation(SAMPLE);
      // Force into a failed-and-due state.
      const raw = JSON.parse(window.localStorage.getItem(QUEUE_KEY)!);
      raw[0].deliveryState = {
        kind: "failed",
        attemptCount: 1,
        lastError: "HTTP 0",
        lastFailedAt: Date.now() - BACKOFF_BASE_MS - 1000,
      };
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));

      const r = await runRetryTick();
      expect(r.attempted).toBe(1);
      expect(r.stillFailed).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
      clearWebhookEndpoint();
    }
  });
});

// ─── start / stop / idempotency ─────────────────────────────────────────────

describe("retry-scheduler: lifecycle", () => {
  it("startRetryScheduler is idempotent", () => {
    vi.useFakeTimers();
    try {
      const a = startRetryScheduler({ tickIntervalMs: 60_000 });
      const b = startRetryScheduler({ tickIntervalMs: 60_000 });
      expect(a).toBe(b);
      expect(isRetrySchedulerRunning()).toBe(true);
    } finally {
      stopRetryScheduler();
      vi.useRealTimers();
    }
  });

  it("stopRetryScheduler stops the singleton", () => {
    vi.useFakeTimers();
    try {
      startRetryScheduler({ tickIntervalMs: 60_000 });
      expect(isRetrySchedulerRunning()).toBe(true);
      stopRetryScheduler();
      expect(isRetrySchedulerRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runNow drives a tick outside the interval", async () => {
    vi.useFakeTimers();
    try {
      const ticks: number[] = [];
      const handle = startRetryScheduler({
        tickIntervalMs: 60_000,
        onTick: (r) => ticks.push(r.attempted),
      });
      await handle.runNow();
      expect(ticks.length).toBe(1);
    } finally {
      stopRetryScheduler();
      vi.useRealTimers();
    }
  });
});
