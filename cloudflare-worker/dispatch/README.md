# Even Keel — crisis-dispatch Cloudflare Worker

**v1.6.9** — A trusted middlebox between the browser and the school's
DSL (Designated Safeguarding Lead) endpoint. The Worker accepts a
signed `SignedEnvelope<EscalationPayload>` from the browser,
verifies it, rate-limits, and forwards to an allowlisted destination.

## What this Worker does

1. **Pre-flight policy**: rejects oversized bodies, missing/short
   issuer pubkey headers, non-HTTPS / userinfo-laden destinations,
   and any destination not on the configured allowlist.
2. **Issuer allowlist**: the `X-EvenKeel-Issuer-PubKey` header must
   match a prefix in `ISSUER_ALLOWLIST` *and* must match a prefix of
   the envelope's own `publicKeyB64url` (pin-check).
3. **Rate limit**: per-issuer sliding window. Defaults to 60 requests
   per 60 seconds. State lives in Worker isolate memory; for
   production-scale tenants a Cloudflare Durable Object would be the
   right home (see *Limits*).
4. **Signature verification**: ECDSA P-256 with SHA-256, matching
   `lib/crypto/signing.ts` in the main app. Failure stops the request
   with `outcome: "rejected_by_signature"`.
5. **Forward**: HTTPS POST to the allowlisted destination, mirroring
   the original body, with `X-EvenKeel-PublicKey`,
   `X-EvenKeel-Algorithm`, and `X-EvenKeel-Forwarded-Via` headers.
6. **Receipt**: returns a structured `DispatchReceipt` JSON to the
   browser. The browser publishes a counts-only summary on the bus.

## What this Worker does NOT do

- **Not a queue.** If the destination is down, the Worker reports
  `transient_destination_failure` and the browser retries on its own
  schedule (driven by `lib/safeguarding/retry-scheduler`). The Worker
  is stateless beyond the in-memory rate limiter.
- **Not a content inspector.** The signature is verified; the payload
  is opaque. (The payload is already audited at the source: no learner
  free-text, only category + jurisdiction + age-band.)
- **Not a long-lived store.** Worker memory is per-isolate, not
  persistent. Audit lives on the browser bus and on the school's
  endpoint, not here.

## Configuration

All config is via Cloudflare Worker environment variables. See
`wrangler.toml`.

| Var | Default | Purpose |
|---|---|---|
| `ISSUER_ALLOWLIST` | *(required)* | Comma-separated base64url prefixes (>= 16 chars) of permitted issuer signing public keys. |
| `DESTINATION_ALLOWLIST` | *(required)* | Comma-separated `https://…` URLs the Worker is permitted to forward to. Exact-match. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding-window length in ms. |
| `RATE_LIMIT_MAX` | `60` | Max requests per issuer per window. |
| `MAX_BODY_BYTES` | `32768` | Hard reject above this; a single envelope is well under 4 KB. |

## Deployment

```bash
cd cloudflare-worker/dispatch
npm install
npx wrangler login
npx wrangler secret put ISSUER_ALLOWLIST       # paste comma list
npx wrangler secret put DESTINATION_ALLOWLIST  # paste comma list
npx wrangler deploy
```

Then in the school's `/compliance` Safeguarding Webhook URL field:

```
https://evenkeel-dispatch.<your-sub>.workers.dev/dispatch
```

The browser will send the original target URL in
`X-EvenKeel-Target`, which the Worker validates against
`DESTINATION_ALLOWLIST`.

## Threat model and limits

- **In-memory rate limiter.** State is per Worker isolate. A burst
  from a single browser will pin to one isolate, so the limit
  applies. An adversary distributing requests across many isolates
  bypasses the counter, but in practice Cloudflare's edge-level WAF
  is the first line of defence; this Worker counter is defence in
  depth, not the only line. For production-scale, swap in a Durable
  Object; the policy module is structured to make that a localised
  change.
- **No persistent audit.** The browser bus carries the receipt; the
  Worker does not log per-request bodies. Cloudflare access logs
  (status code only) provide a coarse-grained external audit.
- **CORS.** Preflight is permitted from any origin; the per-request
  gate is the signature, not the Origin header. This is intentional:
  the school may want to forward from staff devices on multiple
  domains.

## Tests

```bash
npm test
```

Unit tests cover:

- Pre-check rejections (oversized body, bad issuer, bad destination)
- Rate-limit behaviour with deterministic clock injection
- Envelope verification round-trip
- 405 / 404 routing
- 502 on destination-side throw
- Receipt shape (outcome, reason, destination status echoed)
