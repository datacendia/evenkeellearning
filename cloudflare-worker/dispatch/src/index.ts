// ─────────────────────────────────────────────────────────────────────────────
// cloudflare-worker/dispatch/src/index.ts
//
// v1.6.9 — Even Keel dispatch Worker.
//
// PURPOSE
// ───────
// A trusted middlebox between the browser and a school's DSL endpoint.
// The browser POSTs a signed `SignedEnvelope<EscalationPayload>` here;
// the Worker:
//
//   1. Rejects oversized / malformed requests.
//   2. Checks the X-EvenKeel-Issuer-PubKey header against an allowlist.
//   3. Checks the X-EvenKeel-Target header against a destination
//      allowlist (this is the school's own DSL endpoint).
//   4. Enforces a per-issuer sliding-window rate limit.
//   5. Verifies the envelope's ECDSA-P256 signature.
//   6. Forwards the verified envelope to the destination over HTTPS.
//   7. Returns a structured receipt to the browser. The receipt is
//      then re-published on the bus as the audit record.
//
// WHY A WORKER (vs direct browser → school endpoint)
// ──────────────────────────────────────────────────
//   • Many school MIS/pastoral endpoints don't accept browser CORS.
//   • Many schools want a single hardened URL to allowlist in their
//     firewall, not "every browser the platform runs in".
//   • A central rate-limit gate protects a fragile downstream from
//     accidental runaway loops, and gives the platform operator
//     central visibility into delivery health.
//   • Server-side signature verification means the school endpoint
//     can be a dumb "accept JSON, store in DB" service — it doesn't
//     need to import a crypto library.
//
// WHAT THIS WORKER IS NOT
// ───────────────────────
//   • Not a queue. If the destination is down, we report
//     `transient_destination_failure` and let the BROWSER retry on its
//     own schedule (driven by `lib/safeguarding/retry-scheduler`).
//     Keeping retry state in the Worker would mean per-tenant Durable
//     Objects, which is out of scope for v1.
//   • Not a content inspector. We verify the SIGNATURE; we do NOT
//     inspect the payload semantics. The payload is opaque (already
//     audited at the source: no learner free-text, only category +
//     jurisdiction + age-band).
//   • Not a long-lived store. Worker memory is per-isolate, not
//     persistent. Audit lives on the browser bus and on the school's
//     endpoint, not here.
// ─────────────────────────────────────────────────────────────────────────────

import { isEnvelopeLike, verifyEnvelope } from "./envelope";
import {
  createRateLimiter,
  DEFAULT_POLICY,
  parseList,
  precheck,
  type DispatchPolicyConfig,
  type RateLimiter,
} from "./policy";

/** Cloudflare environment bindings. Configured in wrangler.toml. */
export interface Env {
  /** Comma-separated issuer pubkey prefixes. */
  ISSUER_ALLOWLIST?: string;
  /** Comma-separated destination URLs. */
  DESTINATION_ALLOWLIST?: string;
  /** Optional override for the rate-limit window (ms). */
  RATE_LIMIT_WINDOW_MS?: string;
  /** Optional override for the rate-limit cap. */
  RATE_LIMIT_MAX?: string;
  /** Optional override for the max body size in bytes. */
  MAX_BODY_BYTES?: string;
}

/** Receipt the Worker returns to the browser. */
export interface DispatchReceipt {
  receiptId: string;
  dispatchedAtIso: string;
  // The verb is "dispatched_to_destination" once the Worker has
  // forwarded the request and the destination returned an HTTP 2xx.
  // Other outcomes use the "rejected" or "failed" verbs with a
  // structured reason; the bus consumer uses the verb to choose UI
  // tone (success vs warning vs error).
  outcome:
    | "dispatched_to_destination"
    | "rejected_by_policy"
    | "rejected_by_signature"
    | "transient_destination_failure"
    | "permanent_destination_failure";
  /** Stable reason identifier when outcome is anything but success. */
  reason?: string;
  /** HTTP status from the destination, when applicable. */
  destinationStatus?: number;
  /** The envelope's content digest, echoed back for receipt-to-envelope pinning. */
  envelopeContentDigestB64url?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-isolate rate limiter. A single Map shared across requests handled by
// this isolate. See policy.ts for the production caveat.
// ─────────────────────────────────────────────────────────────────────────────
let limiter: RateLimiter | null = null;
let limiterConfigKey = "";

function getLimiter(policy: DispatchPolicyConfig): RateLimiter {
  const key = `${policy.rateLimitWindowMs}:${policy.rateLimitMaxRequests}`;
  if (!limiter || key !== limiterConfigKey) {
    limiter = createRateLimiter(
      policy.rateLimitWindowMs,
      policy.rateLimitMaxRequests,
    );
    limiterConfigKey = key;
  }
  return limiter;
}

/** Resolve env vars into a DispatchPolicyConfig. */
export function policyFromEnv(env: Env): DispatchPolicyConfig {
  const numOr = (s: string | undefined, fallback: number) => {
    if (!s) return fallback;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    issuerAllowlist: parseList(env.ISSUER_ALLOWLIST),
    destinationAllowlist: parseList(env.DESTINATION_ALLOWLIST),
    rateLimitWindowMs: numOr(env.RATE_LIMIT_WINDOW_MS, DEFAULT_POLICY.rateLimitWindowMs),
    rateLimitMaxRequests: numOr(env.RATE_LIMIT_MAX, DEFAULT_POLICY.rateLimitMaxRequests),
    maxBodyBytes: numOr(env.MAX_BODY_BYTES, DEFAULT_POLICY.maxBodyBytes),
  };
}

// ── Cheap reject helper ────────────────────────────────────────────────────
function reject(
  status: number,
  reason: string,
  receiptIdSeed?: string,
): Response {
  const receipt: DispatchReceipt = {
    receiptId: receiptIdSeed ?? newReceiptId(),
    dispatchedAtIso: new Date().toISOString(),
    outcome:
      reason === "bad_signature" ||
      reason === "content_digest_mismatch" ||
      reason === "bad_public_key" ||
      reason === "verify_threw" ||
      reason === "unsupported_algorithm"
        ? "rejected_by_signature"
        : "rejected_by_policy",
    reason,
  };
  return new Response(JSON.stringify(receipt), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function newReceiptId(): string {
  // crypto.randomUUID is available in Workers and modern browsers.
  return `dispatch-${crypto.randomUUID()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fetch handler, exported for testability. Pure-ish — its only
// side effect is the rate-limit map mutation (testable independently).
// ─────────────────────────────────────────────────────────────────────────────
export async function handle(request: Request, env: Env): Promise<Response> {
  // ── Method gate ──
  if (request.method === "OPTIONS") {
    // Permit CORS preflight from any origin — the per-request gate is
    // the signature, not the Origin header.
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, X-EvenKeel-Issuer-PubKey, X-EvenKeel-Target",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (request.method !== "POST") {
    return reject(405, "method_not_allowed");
  }
  if (new URL(request.url).pathname !== "/dispatch") {
    return reject(404, "unknown_path");
  }

  const policy = policyFromEnv(env);

  const issuerPubKey = request.headers.get("X-EvenKeel-Issuer-PubKey") ?? "";
  const destination = request.headers.get("X-EvenKeel-Target") ?? "";

  // ── Body read ──
  const bodyText = await request.text();
  const bodyByteLength = new TextEncoder().encode(bodyText).byteLength;

  // ── Pre-flight policy ──
  const pre = precheck(
    { issuerPubKey, destination, bodyByteLength },
    policy,
  );
  if (!pre.ok) {
    return reject(400, pre.reason);
  }

  // ── Rate limit ──
  const lim = getLimiter(policy).check(issuerPubKey);
  if (!lim.allowed) {
    const r: DispatchReceipt = {
      receiptId: newReceiptId(),
      dispatchedAtIso: new Date().toISOString(),
      outcome: "rejected_by_policy",
      reason: "rate_limited",
    };
    return new Response(JSON.stringify(r), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": Math.ceil((lim.resetAt - Date.now()) / 1000).toString(),
        "X-EvenKeel-RateLimit-Remaining": "0",
        "X-EvenKeel-RateLimit-Reset": String(lim.resetAt),
      },
    });
  }

  // ── Envelope parse + structural check ──
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return reject(400, "body_not_json");
  }
  if (!isEnvelopeLike(parsed)) {
    return reject(400, "body_not_envelope");
  }

  // ── Issuer / envelope pubkey pin ──
  // The X-EvenKeel-Issuer-PubKey header MUST match a prefix of the
  // envelope's publicKeyB64url. Without this pin, an attacker who
  // owns one allowlisted issuer key could submit envelopes signed by
  // a different (un-allowlisted) key by setting the header to a
  // matching prefix.
  if (!parsed.publicKeyB64url.startsWith(issuerPubKey.slice(0, 64))) {
    return reject(400, "issuer_pubkey_header_mismatch_envelope");
  }

  // ── Signature verification ──
  const v = await verifyEnvelope(parsed);
  if (!v.ok) {
    return reject(400, v.reason);
  }

  // ── Forward to destination ──
  let dest: Response;
  try {
    dest = await fetch(pre.destinationUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EvenKeel-PublicKey": parsed.publicKeyB64url,
        "X-EvenKeel-Algorithm": parsed.algorithm,
        "X-EvenKeel-Forwarded-Via": "evenkeel-dispatch-worker",
      },
      body: bodyText,
    });
  } catch (e) {
    const r: DispatchReceipt = {
      receiptId: newReceiptId(),
      dispatchedAtIso: new Date().toISOString(),
      outcome: "transient_destination_failure",
      reason: sanitiseError(e),
      envelopeContentDigestB64url: parsed.contentDigestB64url,
    };
    return new Response(JSON.stringify(r), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const receipt: DispatchReceipt = {
    receiptId: newReceiptId(),
    dispatchedAtIso: new Date().toISOString(),
    outcome:
      dest.status >= 200 && dest.status < 300
        ? "dispatched_to_destination"
        : dest.status >= 500
        ? "transient_destination_failure"
        : "permanent_destination_failure",
    destinationStatus: dest.status,
    envelopeContentDigestB64url: parsed.contentDigestB64url,
  };
  return new Response(JSON.stringify(receipt), {
    status:
      receipt.outcome === "dispatched_to_destination"
        ? 200
        : receipt.outcome === "transient_destination_failure"
        ? 502
        : 400,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function sanitiseError(e: unknown): string {
  if (e instanceof Error) {
    // Trim to the error name only; messages can contain target URL,
    // which we already log via destinationStatus and don't want to
    // surface back to the browser body.
    return e.name || "fetch_error";
  }
  return "fetch_error";
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker fetch export. This is the only line of magic the
// runtime cares about; everything else is plain TS.
// ─────────────────────────────────────────────────────────────────────────────
export default {
  fetch: handle,
};
