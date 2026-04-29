// ─────────────────────────────────────────────────────────────────────────────
// lib/safeguarding/webhook-config.ts
//
// Stores the school-provided DSL (Designated Safeguarding Lead) webhook
// endpoint URL. Phase-1 scope (v1.4.8):
//
//   • One endpoint, on-device, set by the Compliance Officer via the
//     "Safeguarding Escalations" card on /compliance.
//   • HTTPS-only at runtime, with a `localhost`/`127.0.0.1` exception for
//     local development of receiver stubs.
//   • No multi-tenant routing yet; that's Phase 2 (per-school config keyed
//     off the absorption result's jurisdiction).
//   • No authentication scheme negotiation (HMAC vs ECDSA vs OAuth) yet —
//     the signed envelope from `escalation-queue.ts` carries its own
//     ECDSA P-256 signature and the public key is forwarded in
//     `X-EvenKeel-PublicKey`. Schools can verify without prior config.
//
// PRIVACY: this module persists a URL and nothing else. No learner data,
// no log of past attempts (those live on the queue entries themselves).
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "evenkeel.safeguarding.webhook.v1";

export interface WebhookValidationOk {
  ok: true;
  url: string;
}
export interface WebhookValidationError {
  ok: false;
  reason: string;
}
export type WebhookValidation = WebhookValidationOk | WebhookValidationError;

/**
 * Validate a candidate URL for use as a DSL endpoint. Accepts:
 *   • https:// scheme
 *   • http://localhost or http://127.0.0.1 (dev convenience; explicit)
 * Rejects everything else, including http to public hosts (would leak a
 * signed envelope in plaintext).
 */
export function validateWebhookEndpoint(raw: string): WebhookValidation {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "URL cannot be empty." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.protocol === "https:") {
    return { ok: true, url: url.toString() };
  }
  if (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return { ok: true, url: url.toString() };
  }
  return {
    ok: false,
    reason:
      "Endpoint must use https:// (or http://localhost for development).",
  };
}

/**
 * Returns the configured webhook endpoint, or null if none is set or the
 * stored value fails validation. Defensive — corrupted storage produces
 * null, never a throw.
 */
export function getWebhookEndpoint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const url = (parsed as { url?: unknown }).url;
    if (typeof url !== "string") return null;
    const v = validateWebhookEndpoint(url);
    return v.ok ? v.url : null;
  } catch {
    return null;
  }
}

/**
 * Store a validated endpoint. Returns the validation result so the UI
 * can surface errors without re-running validation.
 */
export function setWebhookEndpoint(raw: string): WebhookValidation {
  const v = validateWebhookEndpoint(raw);
  if (!v.ok) return v;
  if (typeof window === "undefined") return v;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: v.url }));
  } catch {
    return { ok: false, reason: "Could not write to local storage." };
  }
  return v;
}

/** Remove any configured endpoint. Subsequent attempts go to `no_endpoint`. */
export function clearWebhookEndpoint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
