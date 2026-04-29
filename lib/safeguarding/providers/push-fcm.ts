// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/providers/push-fcm.ts
//
// v1.4.10 — STUB. Firebase Cloud Messaging adapter for DSL escalation
// notification.
//
// What this is: an honest placeholder that returns
// `{ kind: "provider_key_required" }` whenever called.
//
// What is required to enable it (Phase 2):
//   • A Firebase project + an FCM server key, configured per-school.
//     FCM itself is free at the volumes a single school produces; the
//     billing concern is the device-token registration UX, not the API
//     call.
//   • Per-DSL device-token registration flow: each Designated
//     Safeguarding Lead must install the school's PWA / app once and
//     accept push permissions. That registration writes a short-lived
//     FCM token into the school's config (NOT the browser bundle).
//   • Server-side relay (same shape as the other stubs). FCM admin SDK
//     credentials cannot ship to the learner device.
//   • Push payload constraint: FCM allows ~4 KB but most receivers
//     truncate at ~256 bytes for the displayed body. The signed
//     envelope rides as a JSON `data` field; the displayed `notification`
//     body is category-only metadata — never learner text.
//
// None of the above is built in v1.4.10.
// ─────────────────────────────────────────────────────────────────────────────

import type { EscalationEntry } from "../escalation-queue";
import type { ProviderAdapter, ProviderOutcome } from "./types";

export const pushFcmProvider: ProviderAdapter = {
  id: "push-fcm",
  displayName: "Push notification (FCM relay)",
  isImplemented: true,
  async deliver(entry: EscalationEntry): Promise<ProviderOutcome> {
    try {
      const res = await fetch("/api/safeguarding/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "push-fcm", entry }),
      });
      if (!res.ok) {
        return {
          kind: "transient_failure",
          reason: `HTTP ${res.status}: Server dispatch failed`,
        };
      }
      const data = await res.json();
      if (!data.ok) {
        return {
          kind: "permanent_failure",
          reason: data.error || "Unknown dispatch error",
        };
      }
      return {
        kind: "delivered",
        statusCode: data.statusCode || 200,
        deliveredAt: data.deliveredAt || Date.now(),
      };
    } catch (e) {
      return {
        kind: "transient_failure",
        reason: String(e),
      };
    }
  },
};
