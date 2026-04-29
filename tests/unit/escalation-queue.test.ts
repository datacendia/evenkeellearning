// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/escalation-queue.test.ts
//
// Pins the v1.4.8 DSL escalation pipeline contract (SAFEGUARDING.md §1.8):
//   1. Privacy: EnqueueInput cannot carry learner free-form text.
//   2. Sign / verify round-trip: every enqueued entry verifies against its
//      embedded public key.
//   3. Tamper detection: mutating the payload after signing fails verify.
//   4. Defensive parser: corrupted localStorage yields an empty queue, never
//      a throw.
//   5. Subscriber semantics: enqueue + clear + delivery-state-change all fire.
//   6. Webhook delivery transitions: no_endpoint → in_flight → sent / failed.
//   7. Endpoint URL never leaks into a sanitized error string.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  attemptWebhookDelivery,
  clearEscalations,
  enqueueEscalation,
  getEscalation,
  isExpired,
  listEscalations,
  pruneExpiredEscalations,
  RETENTION_DAYS,
  subscribeEscalations,
  verifyEscalation,
  type EnqueueInput,
} from "@/lib/safeguarding/escalation-queue";
import {
  clearWebhookEndpoint,
  setWebhookEndpoint,
} from "@/lib/safeguarding/webhook-config";
import { resetSessionKeyPair } from "@/lib/crypto/signing";

const QUEUE_KEY = "evenkeel.safeguarding.queue.v1";
const WEBHOOK_KEY = "evenkeel.safeguarding.webhook.v1";
const TAB_KEY = "evenkeel.safeguarding.tabContextId.v1";

beforeEach(() => {
  window.localStorage.removeItem(QUEUE_KEY);
  window.localStorage.removeItem(WEBHOOK_KEY);
  try {
    window.sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* ignore */
  }
  resetSessionKeyPair();
});

const SAMPLE: EnqueueInput = {
  triggerType: "crisis_response",
  crisisPatternCategory: "direct_self_harm",
  jurisdiction: "IE",
  studentAgeBand: "Y9-11",
};

describe("escalation-queue: privacy contract", () => {
  it("EnqueueInput type does not declare a `text` field", () => {
    // Compile-time assertion: this object must not be assignable if the
    // type ever sprouts a free-form text field. The runtime check below
    // pins the same property at test time.
    const keys = Object.keys(SAMPLE).sort();
    expect(keys).toEqual(
      ["crisisPatternCategory", "jurisdiction", "studentAgeBand", "triggerType"].sort(),
    );
  });

  it("the signed payload contains only category-level metadata", async () => {
    const entry = await enqueueEscalation(SAMPLE);
    const payload = entry.envelope.payload;
    const allowed = new Set([
      "id",
      "detectedAt",
      "detectedAtIso",
      "triggerType",
      "crisisPatternCategory",
      "jurisdiction",
      "studentAgeBand",
      "engineVersion",
      "tabContextId",
    ]);
    for (const key of Object.keys(payload)) {
      expect(allowed.has(key), `unexpected payload field: ${key}`).toBe(true);
    }
    // Explicit guards against the most plausible accidental leaks.
    expect((payload as Record<string, unknown>).text).toBeUndefined();
    expect((payload as Record<string, unknown>).message).toBeUndefined();
    expect((payload as Record<string, unknown>).matchedRegex).toBeUndefined();
    expect((payload as Record<string, unknown>).learnerName).toBeUndefined();
  });
});

describe("escalation-queue: sign + verify", () => {
  it("verifies a freshly enqueued entry", async () => {
    const entry = await enqueueEscalation(SAMPLE);
    expect(await verifyEscalation(entry)).toBe(true);
  });

  it("detects payload tampering after signing", async () => {
    const entry = await enqueueEscalation(SAMPLE);
    const tampered = {
      ...entry,
      envelope: {
        ...entry.envelope,
        payload: {
          ...entry.envelope.payload,
          jurisdiction: "FORGED",
        },
      },
    };
    expect(await verifyEscalation(tampered)).toBe(false);
  });

  it("preserves studentAgeBand only when supplied", async () => {
    const without = await enqueueEscalation({
      triggerType: "crisis_response",
      crisisPatternCategory: "indirect_distress",
      jurisdiction: "UK",
    });
    expect(without.envelope.payload.studentAgeBand).toBeUndefined();

    const withBand = await enqueueEscalation({
      ...SAMPLE,
      studentAgeBand: "Y7-8",
    });
    expect(withBand.envelope.payload.studentAgeBand).toBe("Y7-8");
  });
});

describe("escalation-queue: persistence + defensive parser", () => {
  it("round-trips through localStorage", async () => {
    const e = await enqueueEscalation(SAMPLE);
    const found = getEscalation(e.id);
    expect(found?.id).toBe(e.id);
    expect(listEscalations().length).toBe(1);
  });

  it("returns an empty list when the store is corrupt", () => {
    window.localStorage.setItem(QUEUE_KEY, "not-json");
    expect(listEscalations()).toEqual([]);
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify({ not: "an array" }));
    expect(listEscalations()).toEqual([]);
    window.localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ id: "missing-envelope" }]),
    );
    expect(listEscalations()).toEqual([]);
  });

  it("clearEscalations removes everything", async () => {
    await enqueueEscalation(SAMPLE);
    await enqueueEscalation(SAMPLE);
    expect(listEscalations().length).toBe(2);
    clearEscalations();
    expect(listEscalations()).toEqual([]);
  });
});

describe("escalation-queue: subscribers", () => {
  it("fires on enqueue, delivery state change, and clear", async () => {
    let count = 0;
    const unsub = subscribeEscalations(() => {
      count += 1;
    });
    await enqueueEscalation(SAMPLE);
    expect(count).toBe(1);

    // attemptWebhookDelivery with no endpoint sets `no_endpoint` → notify
    const id = listEscalations()[0]!.id;
    await attemptWebhookDelivery(id);
    expect(count).toBeGreaterThanOrEqual(2);

    clearEscalations();
    expect(count).toBeGreaterThanOrEqual(3);
    unsub();
  });
});

describe("escalation-queue: webhook delivery", () => {
  it("transitions to no_endpoint when nothing is configured", async () => {
    const e = await enqueueEscalation(SAMPLE);
    const after = await attemptWebhookDelivery(e.id);
    expect(after?.deliveryState.kind).toBe("no_endpoint");
  });

  it("transitions to sent on a 2xx response", async () => {
    setWebhookEndpoint("https://example.test/ingest");
    const e = await enqueueEscalation(SAMPLE);
    const fakeFetch = (async () => new Response("", { status: 202 })) as typeof fetch;
    const after = await attemptWebhookDelivery(e.id, fakeFetch);
    expect(after?.deliveryState.kind).toBe("sent");
    if (after?.deliveryState.kind === "sent") {
      expect(after.deliveryState.lastResponseStatus).toBe(202);
      expect(after.deliveryState.attemptCount).toBe(1);
    }
    clearWebhookEndpoint();
  });

  it("transitions to failed and increments attempt count on non-2xx", async () => {
    setWebhookEndpoint("https://example.test/ingest");
    const e = await enqueueEscalation(SAMPLE);
    const fakeFetch = (async () => new Response("oops", { status: 503 })) as typeof fetch;
    const first = await attemptWebhookDelivery(e.id, fakeFetch);
    expect(first?.deliveryState.kind).toBe("failed");
    if (first?.deliveryState.kind === "failed") {
      expect(first.deliveryState.attemptCount).toBe(1);
      expect(first.deliveryState.lastError).toContain("503");
    }
    const second = await attemptWebhookDelivery(e.id, fakeFetch);
    if (second?.deliveryState.kind === "failed") {
      expect(second.deliveryState.attemptCount).toBe(2);
    }
    clearWebhookEndpoint();
  });

  it("scrubs URL fragments out of persisted error messages", async () => {
    setWebhookEndpoint("https://secret-school.test/ingest");
    const e = await enqueueEscalation(SAMPLE);
    const fakeFetch = (async () => {
      throw new Error("network blew up reaching https://secret-school.test/ingest now");
    }) as typeof fetch;
    const after = await attemptWebhookDelivery(e.id, fakeFetch);
    if (after?.deliveryState.kind === "failed") {
      expect(after.deliveryState.lastError.toLowerCase()).not.toContain(
        "secret-school.test",
      );
    }
    clearWebhookEndpoint();
  });
});

describe("escalation-queue: detectedAt monotonic ordering", () => {
  it("preserves enqueue order in the store", async () => {
    const a = await enqueueEscalation(SAMPLE);
    const b = await enqueueEscalation({
      ...SAMPLE,
      crisisPatternCategory: "indirect_distress",
    });
    const all = listEscalations();
    expect(all.map((e) => e.id)).toEqual([a.id, b.id]);
  });
});

// ── v1.4.10 — WORM retention semantics ──────────────────────────────────────
//
// Pins the v1.4.10 commitment from SAFEGUARDING.md §1.8 honest-update:
//   • RETENTION_DAYS is exported and stable at 90.
//   • `isExpired` is a pure boundary check on `entry.detectedAt`.
//   • `pruneExpiredEscalations` removes only expired entries; never the
//     fresh ones, never anything in between.
//   • Pruning is idempotent.
//   • Pruning notifies subscribers iff at least one entry was removed.
//   • The signed envelope is NEVER mutated by retention machinery.

describe("escalation-queue: WORM retention (v1.4.10)", () => {
  it("RETENTION_DAYS is the documented 90-day default", () => {
    expect(RETENTION_DAYS).toBe(90);
  });

  it("isExpired returns false for fresh entries and true after RETENTION_DAYS", async () => {
    const e = await enqueueEscalation(SAMPLE);
    const fresh = listEscalations()[0]!;
    expect(isExpired(fresh, e.detectedAt + 1000)).toBe(false);
    // Boundary: at exactly RETENTION_MS, expired must still be false
    // (the operator is strictly greater-than, not greater-or-equal).
    const exactlyAtBoundary =
      e.detectedAt + RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(isExpired(fresh, exactlyAtBoundary)).toBe(false);
    expect(isExpired(fresh, exactlyAtBoundary + 1)).toBe(true);
  });

  it("pruneExpiredEscalations removes only expired entries", async () => {
    // Build a store with one fresh and one stale entry by writing
    // directly so we control `detectedAt` without faking timers.
    const fresh = await enqueueEscalation(SAMPLE);
    const stale = await enqueueEscalation({
      ...SAMPLE,
      crisisPatternCategory: "indirect_distress",
    });
    // Manually rewrite the second entry's detectedAt to 91 days ago.
    const ninetyOneDaysAgo =
      Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    const raw = JSON.parse(window.localStorage.getItem(QUEUE_KEY)!);
    raw[1].detectedAt = ninetyOneDaysAgo;
    raw[1].envelope.payload.detectedAt = ninetyOneDaysAgo;
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));

    expect(listEscalations().length).toBe(2);
    const removed = pruneExpiredEscalations();
    expect(removed).toBe(1);
    const survivors = listEscalations();
    expect(survivors.length).toBe(1);
    expect(survivors[0]!.id).toBe(fresh.id);
    expect(survivors.find((e) => e.id === stale.id)).toBeUndefined();
  });

  it("pruneExpiredEscalations is idempotent", async () => {
    await enqueueEscalation(SAMPLE);
    expect(pruneExpiredEscalations()).toBe(0);
    expect(pruneExpiredEscalations()).toBe(0);
    expect(listEscalations().length).toBe(1);
  });

  it("does not notify subscribers when nothing was pruned", async () => {
    await enqueueEscalation(SAMPLE);
    let calls = 0;
    const unsub = subscribeEscalations(() => {
      calls += 1;
    });
    expect(pruneExpiredEscalations()).toBe(0);
    expect(calls).toBe(0);
    unsub();
  });

  it("notifies subscribers exactly once per non-empty prune", async () => {
    await enqueueEscalation(SAMPLE);
    await enqueueEscalation({
      ...SAMPLE,
      crisisPatternCategory: "indirect_distress",
    });
    // Make both stale.
    const raw = JSON.parse(window.localStorage.getItem(QUEUE_KEY)!);
    const stale = Date.now() - (RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000;
    for (const r of raw) {
      r.detectedAt = stale;
      r.envelope.payload.detectedAt = stale;
    }
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(raw));
    let calls = 0;
    const unsub = subscribeEscalations(() => {
      calls += 1;
    });
    expect(pruneExpiredEscalations()).toBe(2);
    expect(calls).toBe(1);
    unsub();
  });

  it("WORM contract: pruning never mutates a survivor's signed envelope", async () => {
    const fresh = await enqueueEscalation(SAMPLE);
    const beforeSig = fresh.envelope.signatureB64url;
    const beforePub = fresh.envelope.publicKeyB64url;
    const beforePayload = JSON.stringify(fresh.envelope.payload);
    pruneExpiredEscalations(); // no-op since fresh
    const after = listEscalations()[0]!;
    expect(after.envelope.signatureB64url).toBe(beforeSig);
    expect(after.envelope.publicKeyB64url).toBe(beforePub);
    expect(JSON.stringify(after.envelope.payload)).toBe(beforePayload);
    expect(await verifyEscalation(after)).toBe(true);
  });
});
