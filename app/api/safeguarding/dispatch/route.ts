import { NextResponse } from "next/server";

/**
 * v1.5.5 — DISABLED.
 *
 * An earlier iteration of this route accepted any escalation envelope from
 * any caller, logged the category to the server console, and returned
 * `{ ok: true, deliveredAt }` — which the SMS / email / push adapters
 * then reported back to the Compliance UI as a successful out-of-band
 * delivery. No SMS, email, or push notification was ever sent. That is
 * exactly the kind of "looks delivered, isn't delivered" defect a
 * safeguarding platform cannot have.
 *
 * Until a real server-side relay exists (with a real Twilio / SendGrid /
 * FCM credential held server-side, real rate-limiting, real auth, and
 * real signature verification on the envelope), this endpoint refuses
 * the call and tells the client to use the configured HTTPS webhook
 * provider instead. Tracked under SAFEGUARDING.md §1.
 *
 * Any future re-enablement of this route MUST:
 *   1. Authenticate the caller (server session bound to an enrolled DSL
 *      passkey, or a school-issued API key).
 *   2. Verify `entry.envelope.signatureB64url` against
 *      `entry.envelope.publicKeyB64url` server-side before any outbound
 *      provider call.
 *   3. Rate-limit per school (escalation volume should be small; a flood
 *      indicates either an attack or a stuck retry loop).
 *   4. Be covered by an integration test that pins each provider's
 *      `delivered` outcome to an actual provider call, not a `console.log`.
 */
export async function POST(_req: Request) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Server-side safeguarding dispatch is not implemented in v1.5.4. " +
        "Use the configured HTTPS webhook provider, or wait for the Phase-2 " +
        "server-side relay. See SAFEGUARDING.md §1. " +
        "Note (v1.7.1 merge): the production-ready replacement now lives in " +
        "the Cloudflare Worker at cloudflare-worker/dispatch/ — signed " +
        "envelope verification, allowlist + rate-limit, structured receipts.",
    },
    { status: 501 },
  );
}
