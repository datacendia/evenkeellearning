// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/providers/webhook.ts
//
// v1.4.10 — The one fully-implemented provider adapter. Wraps the
// existing `attemptWebhookDelivery` path from `lib/safeguarding/escalation-
// queue.ts` (which was the v1.4.8 default) into the new `ProviderAdapter`
// contract so it sits alongside the email / SMS / push stubs in the
// registry.
//
// No new code paths — this file is a thin shim. The fetch / sign / verify
// machinery already lives in `escalation-queue.ts` and is exhaustively
// tested in `tests/unit/escalation-queue.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  attemptWebhookDelivery,
  type EscalationEntry,
} from "../escalation-queue";
import type { ProviderAdapter, ProviderOutcome } from "./types";

export const webhookProvider: ProviderAdapter = {
  id: "webhook",
  displayName: "HTTPS webhook (school-configured endpoint)",
  isImplemented: true,
  async deliver(entry: EscalationEntry): Promise<ProviderOutcome> {
    const after = await attemptWebhookDelivery(entry.id);
    if (!after) {
      return {
        kind: "permanent_failure",
        reason: "entry not found in queue",
      };
    }
    const ds = after.deliveryState;
    switch (ds.kind) {
      case "sent":
        return {
          kind: "delivered",
          statusCode: ds.lastResponseStatus,
          deliveredAt: ds.lastSucceededAt,
        };
      case "no_endpoint":
        return {
          kind: "provider_key_required",
          providerName: "Webhook",
          configHelp:
            "Configure the school's HTTPS endpoint in /compliance → Safeguarding → Webhook URL",
        };
      case "failed":
        return {
          kind: "transient_failure",
          reason: ds.lastError,
        };
      case "in_flight":
      case "queued":
        return {
          kind: "transient_failure",
          reason: "delivery still in flight",
        };
    }
  },
};
