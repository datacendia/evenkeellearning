// ─────────────────────────────────────────────────────────────────────────────
// cloudflare-worker/dispatch/src/policy.ts
//
// Policy layer — pure functions used by the fetch handler. Keeping
// policy decisions in pure functions means every reject path can be
// unit-tested without spinning up a Worker runtime.
//
// What this module decides
// ────────────────────────
//   1. Whether the request's submitting origin (X-EvenKeel-Issuer-PubKey
//      header) matches at least one prefix in the issuer allowlist.
//   2. Whether the requested target URL (X-EvenKeel-Target header)
//      matches at least one entry in the destination allowlist.
//   3. Whether the requesting origin's recent request rate exceeds the
//      sliding-window cap.
//
// What this module does NOT do
// ────────────────────────────
//   - signature verification (lives in `./envelope`)
//   - actual forwarding (lives in `./index`)
//   - persistence (lives in `./index`, where Durable Objects could be
//     introduced for production-grade rate-limiting; v1 keeps the
//     limiter in-memory per Worker isolate, documented in the README)
// ─────────────────────────────────────────────────────────────────────────────

/** Config the handler resolves from environment variables. */
export interface DispatchPolicyConfig {
  /** Comma-separated allowlist of issuer public-key prefixes. A
   *  request's X-EvenKeel-Issuer-PubKey header must START WITH at
   *  least one of these. Prefix matching (rather than exact) so a
   *  school can rotate keys without rotating the worker config. */
  issuerAllowlist: string[];
  /** Allowlist of HTTPS destination URLs. Exact match (origin + path). */
  destinationAllowlist: string[];
  /** Sliding-window length in milliseconds (default 60_000). */
  rateLimitWindowMs: number;
  /** Max requests per issuer per window (default 60). */
  rateLimitMaxRequests: number;
  /** Max envelope body size in bytes. Hard reject above this. */
  maxBodyBytes: number;
}

export const DEFAULT_POLICY: DispatchPolicyConfig = {
  issuerAllowlist: [],
  destinationAllowlist: [],
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 60,
  maxBodyBytes: 32 * 1024, // 32 KB; a single envelope is well under 4 KB
};

/** Parse a comma-separated env var into a trimmed string array. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Check the issuer pubkey against the prefix allowlist. The
 * comparison is exact-prefix (no wildcards), and a full match is also
 * accepted (a prefix can be the whole key).
 */
export function issuerAllowed(
  issuerPubKey: string,
  allowlist: string[],
): boolean {
  if (allowlist.length === 0) return false;
  for (const prefix of allowlist) {
    if (issuerPubKey.length >= prefix.length && issuerPubKey.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Check the requested destination URL against the allowlist. Exact
 * string match — the school is responsible for entering the destination
 * URL precisely in the Worker config.
 */
export function destinationAllowed(target: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  for (const allowed of allowlist) {
    if (target === allowed) return true;
  }
  return false;
}

/** Validate the requested destination as an HTTPS URL with no userinfo
 *  / query strings that could exfiltrate data. */
export function validateDestinationShape(target: string):
  | { ok: true; url: URL }
  | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, reason: "destination_not_a_url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "destination_must_be_https" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "destination_must_not_have_userinfo" };
  }
  return { ok: true, url };
}

// ─── Rate limiter ──────────────────────────────────────────────────────────

/**
 * A simple per-isolate sliding-window rate limiter.
 *
 * For production scale (many concurrent Worker isolates) a Cloudflare
 * Durable Object would be the right home for this state. For the
 * pilot, per-isolate counters give "good enough" protection:
 *   • A burst from a single browser will pin to one isolate.
 *   • Adversarial bursts that distribute across many isolates are
 *     mitigated by Cloudflare's edge-level WAF; this counter is the
 *     second line of defence, not the only line.
 *
 * The limiter is exposed as a factory so tests can drive it
 * deterministically with a `now()` injection.
 */
export interface RateLimiter {
  check(key: string): { allowed: boolean; remaining: number; resetAt: number };
}

export function createRateLimiter(
  windowMs: number,
  maxRequests: number,
  nowFn: () => number = () => Date.now(),
): RateLimiter {
  // key -> array of timestamps within the current window
  const buckets = new Map<string, number[]>();
  return {
    check(key: string) {
      const now = nowFn();
      const cutoff = now - windowMs;
      const bucket = buckets.get(key) ?? [];
      // Drop entries outside the window.
      let i = 0;
      while (i < bucket.length && bucket[i] < cutoff) i++;
      const live = bucket.slice(i);
      if (live.length >= maxRequests) {
        buckets.set(key, live);
        return {
          allowed: false,
          remaining: 0,
          resetAt: live[0] + windowMs,
        };
      }
      live.push(now);
      buckets.set(key, live);
      return {
        allowed: true,
        remaining: maxRequests - live.length,
        resetAt: now + windowMs,
      };
    },
  };
}

// ─── Combined precheck ─────────────────────────────────────────────────────

export interface PrecheckInput {
  issuerPubKey: string;
  destination: string;
  bodyByteLength: number;
}

export type PrecheckResult =
  | { ok: true; destinationUrl: URL }
  | { ok: false; reason: string };

/**
 * Combined input gate that runs every cheap rejection BEFORE any crypto
 * work. Order matters: cheapest rejections first, so a flood of bad
 * requests can be turned away without spending CPU on signature
 * verification.
 */
export function precheck(
  input: PrecheckInput,
  policy: DispatchPolicyConfig,
): PrecheckResult {
  if (input.bodyByteLength > policy.maxBodyBytes) {
    return { ok: false, reason: "body_too_large" };
  }
  if (!input.issuerPubKey || input.issuerPubKey.length < 16) {
    return { ok: false, reason: "missing_issuer_pubkey" };
  }
  if (!issuerAllowed(input.issuerPubKey, policy.issuerAllowlist)) {
    return { ok: false, reason: "issuer_not_allowed" };
  }
  const shape = validateDestinationShape(input.destination);
  if (!shape.ok) return shape;
  if (!destinationAllowed(input.destination, policy.destinationAllowlist)) {
    return { ok: false, reason: "destination_not_allowed" };
  }
  return { ok: true, destinationUrl: shape.url };
}
