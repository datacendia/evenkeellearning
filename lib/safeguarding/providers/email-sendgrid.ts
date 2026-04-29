// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/providers/email-sendgrid.ts
//
// v1.4.10 — STUB. SendGrid email adapter for DSL escalation notification.
//
// What this is: an honest placeholder that returns
// `{ kind: "provider_key_required" }` whenever called. The Compliance
// surface enumerates this provider so a Designated Safeguarding Lead
// can SEE that email-to-DSL is on the roadmap, without us pretending
// it works.
//
// What is required to enable it (Phase 2):
//   • A SendGrid account + API key. Estimated cost: ~£15/month at
//     escalation volumes typical for a single-school pilot.
//   • A school billing relationship. Even Keel Learning does not
//     resell SendGrid; the school configures their own key.
//   • Server-side proxy. Browser-side fetch to SendGrid would expose
//     the key to every learner device — operationally a non-starter.
//     This means Phase 2 ships a small relay endpoint (Cloudflare
//     Worker / Vercel function) and the browser POSTs to that, not to
//     SendGrid directly.
//   • A signed-recipient contract: SendGrid's API call body cannot
//     widen the signed envelope. The relay forwards the existing v1.4.8
//     signed envelope as the email *body* (so the receiver still
//     verifies offline) and sets the To: address from the school
//     config. The relay never adds the learner's text.
//
// None of the above is built in v1.4.10. This file is structurally
// stable so a Phase-2 contributor can replace the body of `deliver()`
// without touching the registry, the UI, or any caller.
// ─────────────────────────────────────────────────────────────────────────────

import type { EscalationEntry } from "../escalation-queue";
import type { ProviderAdapter, ProviderOutcome } from "./types";

export const emailSendgridProvider: ProviderAdapter = {
  id: "email-sendgrid",
  displayName: "Email (SendGrid relay)",
  isImplemented: true,
  async deliver(entry: EscalationEntry): Promise<ProviderOutcome> {
    try {
      const res = await fetch("/api/safeguarding/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "email-sendgrid", entry }),
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
