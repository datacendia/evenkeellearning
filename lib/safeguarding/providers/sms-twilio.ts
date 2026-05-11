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

// v1.5.5 — HONEST STUB.
//
// An earlier iteration of this adapter POSTed to /api/safeguarding/dispatch
// (which itself was a no-op that console.log'd and returned ok:true) and
// reported `delivered`. The file header has always claimed "STUB. Returns
// provider_key_required whenever called." — the body did not match the
// claim. A Designated Safeguarding Lead would have seen a green "delivered"
// badge for a crisis escalation that no human ever received, which is the
// single worst kind of safeguarding lie.
//
// This file is now what its header says it is: a structurally honest stub
// that refuses to claim delivery. `isImplemented: false` so the Compliance
// surface lists it under "Phase 2 — configuration required" instead of
// alongside the working webhook adapter.
export const smsTwilioProvider: ProviderAdapter = {
  id: "sms-twilio",
  displayName: "SMS (Twilio relay)",
  isImplemented: false,
  async deliver(_entry: EscalationEntry): Promise<ProviderOutcome> {
    return {
      kind: "provider_key_required",
      providerName: "Twilio SMS",
      configHelp:
        "Configure a Twilio account SID, auth token, and verified sender " +
        "number on a server-side relay. The browser must NOT see the auth " +
        "token. SMS bodies should carry category-only metadata plus a " +
        "deep-link to the verifier page — never learner text. Not built " +
        "in v1.5.4; tracked under SAFEGUARDING.md §1.",
    };
  },
};
