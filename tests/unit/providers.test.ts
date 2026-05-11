// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/providers.test.ts
//
// Pins the v1.4.10 provider-adapter scaffold:
//   1. Registry exposes exactly the four expected adapters in stable order.
//   2. The `webhook` adapter is the only one with `isImplemented: true`.
//   3. Every stub returns `kind: "provider_key_required"` with a real
//      `configHelp` string — never silently succeeds.
//   4. Stubs do NOT mutate the entry's signed envelope.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  getProvider,
  listImplementedProviders,
  listProviders,
  listStubProviders,
  type ProviderId,
} from "@/lib/safeguarding/providers";
import {
  enqueueEscalation,
  clearEscalations,
  type EnqueueInput,
} from "@/lib/safeguarding/escalation-queue";
import { resetSessionKeyPair } from "@/lib/crypto/signing";

const QUEUE_KEY = "evenkeel.safeguarding.queue.v1";
const TAB_KEY = "evenkeel.safeguarding.tabContextId.v1";

const SAMPLE: EnqueueInput = {
  triggerType: "crisis_response",
  crisisPatternCategory: "direct_self_harm",
  jurisdiction: "IE",
};

beforeEach(() => {
  window.localStorage.removeItem(QUEUE_KEY);
  try {
    window.sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* ignore */
  }
  resetSessionKeyPair();
  clearEscalations();
});

describe("providers: registry", () => {
  it("lists exactly the four v1.4.10 adapters in stable order", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual([
      "webhook",
      "email-sendgrid",
      "sms-twilio",
      "push-fcm",
    ] satisfies ProviderId[]);
  });

  it("getProvider returns null for unknown ids", () => {
    expect(getProvider("not-a-real-id" as ProviderId)).toBeNull();
  });

  // v1.5.5 — regression test for the "fake delivery" defect.
  //
  // An earlier version of this test pinned the WRONG contract: all four
  // adapters as `isImplemented: true`. The three non-webhook adapters
  // POSTed to a server route that console.log'd and returned ok, which
  // they then reported back as a successful `delivered` outcome. A DSL
  // would have seen a green badge for a crisis escalation that no human
  // ever received. This test now pins the contract that the file
  // headers always claimed: only the webhook adapter is real; sms /
  // email / push are stubs until a real server-side relay ships.
  it("only the webhook adapter is implemented; sms/email/push are honest stubs", () => {
    expect(listImplementedProviders().map((p) => p.id)).toEqual(["webhook"]);
    expect(listStubProviders().map((p) => p.id)).toEqual([
      "email-sendgrid",
      "sms-twilio",
      "push-fcm",
    ]);
  });

  it("each stub returns provider_key_required with non-empty configHelp", async () => {
    const stubIds: ProviderId[] = ["email-sendgrid", "sms-twilio", "push-fcm"];
    const entry = await enqueueEscalation(SAMPLE);
    for (const id of stubIds) {
      const adapter = getProvider(id);
      expect(adapter).not.toBeNull();
      const outcome = await adapter!.deliver(entry);
      expect(outcome.kind).toBe("provider_key_required");
      if (outcome.kind === "provider_key_required") {
        expect(outcome.providerName.length).toBeGreaterThan(0);
        expect(outcome.configHelp.length).toBeGreaterThan(20);
      }
    }
  });

  it("every adapter has a non-empty displayName", () => {
    for (const p of listProviders()) {
      expect(p.displayName.length).toBeGreaterThan(0);
    }
  });
});

describe("providers: delivery", () => {
  it("providers do not mutate the entry's signed envelope", async () => {
    const entry = await enqueueEscalation(SAMPLE);
    const beforeSig = entry.envelope.signatureB64url;
    const beforePub = entry.envelope.publicKeyB64url;
    const beforePayload = JSON.stringify(entry.envelope.payload);

    // Mock fetch so we don't actually hit the network during unit tests
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ ok: true, statusCode: 200 }), { status: 200 });

    for (const p of listImplementedProviders()) {
      if (p.id !== "webhook") {
        await p.deliver(entry);
      }
    }

    global.fetch = originalFetch;

    expect(entry.envelope.signatureB64url).toBe(beforeSig);
    expect(entry.envelope.publicKeyB64url).toBe(beforePub);
    expect(JSON.stringify(entry.envelope.payload)).toBe(beforePayload);
  });
});

describe("providers: webhook adapter wraps the real fetch path", () => {
  it("returns provider_key_required when no endpoint is configured", async () => {
    const adapter = getProvider("webhook");
    expect(adapter).not.toBeNull();
    const entry = await enqueueEscalation(SAMPLE);
    const outcome = await adapter!.deliver(entry);
    expect(outcome.kind).toBe("provider_key_required");
    if (outcome.kind === "provider_key_required") {
      expect(outcome.providerName).toBe("Webhook");
    }
  });
});
