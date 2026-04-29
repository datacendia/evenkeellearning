// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/providers/index.ts
//
// v1.4.10 — Provider adapter registry. The Compliance Officer surface
// reads from `listProviders()` to enumerate every channel the platform
// could route a DSL escalation through, and shows the `isImplemented`
// flag honestly so a stub is never confused for a working pipeline.
//
// Phase 2 lands new providers by adding a file in this directory and an
// entry below — no other call site should need to change.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProviderAdapter, ProviderId } from "./types";
import { webhookProvider } from "./webhook";
import { emailSendgridProvider } from "./email-sendgrid";
import { smsTwilioProvider } from "./sms-twilio";
import { pushFcmProvider } from "./push-fcm";

const PROVIDERS: readonly ProviderAdapter[] = Object.freeze([
  webhookProvider,
  emailSendgridProvider,
  smsTwilioProvider,
  pushFcmProvider,
]);

/** Every registered adapter, in stable display order. */
export function listProviders(): readonly ProviderAdapter[] {
  return PROVIDERS;
}

/** Single adapter by id, or null if none. */
export function getProvider(id: ProviderId): ProviderAdapter | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Adapters that are wired through to a working backend. */
export function listImplementedProviders(): readonly ProviderAdapter[] {
  return PROVIDERS.filter((p) => p.isImplemented);
}

/** Adapters still waiting on a provider key / billing relationship. */
export function listStubProviders(): readonly ProviderAdapter[] {
  return PROVIDERS.filter((p) => !p.isImplemented);
}

export type { ProviderAdapter, ProviderId, ProviderOutcome } from "./types";
