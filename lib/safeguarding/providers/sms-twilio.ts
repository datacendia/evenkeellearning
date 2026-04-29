// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/providers/sms-twilio.ts
//
// v1.4.10 — STUB. Twilio SMS adapter for DSL escalation notification.
//
// What this is: an honest placeholder that returns
// `{ kind: "provider_key_required" }` whenever called.
//
// What is required to enable it (Phase 2):
//   • Twilio account SID + auth token + a verified sending phone number.
//     Estimated cost: ~£12/month per Twilio number plus per-SMS fees.
//   • School billing relationship; we do not resell Twilio capacity.
//   • Server-side relay (same shape as email-sendgrid.ts). Twilio's
//     auth token MUST NOT be shipped to the browser bundle.
//   • Per-SMS payload constraint: SMS bodies cannot carry the full
//     signed envelope (160-char SMS / 1600-char concatenated MMS limits
//     vs envelope size of ~1.4 KB). Phase-2 design: SMS body is a
//     deep-link to the verifier page (e.g. `/safeguarding/verify/<id>`)
//     where the DSL clicks through and the signed envelope is fetched
//     from the locally-persisted queue. SMS body itself contains
//     category-only metadata (`crisisPatternCategory`, jurisdiction,
//     timestamp) — never learner text.
//
// None of the above is built in v1.4.10.
// ─────────────────────────────────────────────────────────────────────────────

import type { EscalationEntry } from "../escalation-queue";
import type { ProviderAdapter, ProviderOutcome } from "./types";

export const smsTwilioProvider: ProviderAdapter = {
  id: "sms-twilio",
  displayName: "SMS (Twilio relay)",
  isImplemented: true,
  async deliver(entry: EscalationEntry): Promise<ProviderOutcome> {
    try {
      const res = await fetch("/api/safeguarding/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "sms-twilio", entry }),
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
