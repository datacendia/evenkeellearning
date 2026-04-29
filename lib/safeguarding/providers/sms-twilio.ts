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
  isImplemented: false,
  async deliver(_entry: EscalationEntry): Promise<ProviderOutcome> {
    return {
      kind: "provider_key_required",
      providerName: "Twilio",
      configHelp:
        "Phase 2: requires a Twilio account SID + auth token, a verified sending number, and a relay endpoint. SMS body would be a deep-link only — the signed envelope cannot fit in 160 characters. See HONESTY.md §3.2.",
    };
  },
};
