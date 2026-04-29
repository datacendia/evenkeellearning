// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/providers/types.ts
//
// v1.4.10 — Provider adapter contract for the DSL escalation pipeline.
//
// In v1.4.8 the only delivery channel for a signed escalation envelope was
// an HTTPS webhook (the school configures the URL; we POST the envelope).
// That's a sound Phase-1 default but not the only one a school will ask
// for. The Phase-2 channels investors and procurement officers cite by
// name are: email (SendGrid), SMS (Twilio), and push (Firebase Cloud
// Messaging).
//
// We do NOT ship working email / SMS / push providers in v1.4.10 because
// each one requires a paid third-party API key plus a billing relationship
// with the school. Saying "we have email integration" without those would
// be exactly the kind of overclaim HONESTY.md exists to prevent.
//
// What we *do* ship in v1.4.10 is a structurally honest SCAFFOLD: the
// `ProviderAdapter` interface below, a real `webhook` adapter that wraps
// the existing v1.4.8 fetch path, and three stub adapters
// (`email-sendgrid`, `sms-twilio`, `push-fcm`) that return a typed
// "provider-key-required" outcome with a configHelp string. The UI on
// `/compliance` Safeguarding tab can therefore enumerate every provider
// the platform *could* support and tell a school exactly what is needed
// to enable each — without pretending any of them work today.
//
// Every Phase-2 expansion will land as a new file in this directory plus
// an entry in the registry at `./index.ts`. The interface below is
// stable in v1.4.10.
// ─────────────────────────────────────────────────────────────────────────────

import type { EscalationEntry } from "../escalation-queue";

/** Discriminator for the four supported provider channels. */
export type ProviderId =
  | "webhook"
  | "email-sendgrid"
  | "sms-twilio"
  | "push-fcm";

/** What a provider returns from `deliver()`. Shape mirrors `DeliveryState`. */
export type ProviderOutcome =
  | { kind: "delivered"; statusCode: number; deliveredAt: number }
  | {
      kind: "transient_failure";
      reason: string; // sanitised; no URLs, no payload data
      retryAdvisedAt?: number;
    }
  | {
      kind: "permanent_failure";
      reason: string;
    }
  | {
      kind: "provider_key_required";
      providerName: string;
      configHelp: string; // human-readable: "set EVENKEEL_SENDGRID_KEY"
    };

/** Adapter contract. All adapters are pure async functions of the entry. */
export interface ProviderAdapter {
  /** Stable identifier; matches `ProviderId`. */
  readonly id: ProviderId;
  /** Human-friendly display name for the Compliance Officer surface. */
  readonly displayName: string;
  /**
   * True when the adapter is wired through to a working backend. False
   * when it is a stub waiting on a key / billing relationship. The
   * Compliance UI badges these differently.
   */
  readonly isImplemented: boolean;
  /**
   * Deliver a single signed entry. MUST NOT mutate the entry's signed
   * envelope. May read `entry.envelope.payload` only for routing
   * metadata (jurisdiction, category) — never to enrich the body with
   * non-signed data.
   */
  deliver(entry: EscalationEntry): Promise<ProviderOutcome>;
}
