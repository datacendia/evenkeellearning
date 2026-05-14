# District Auth — Passkey-Bound Refresh Tokens

**Status:** v1.8.3 — pilot scope. In-memory persistence (via the v1.8.2 DistrictStore). The Postgres adapter (d1-backend-pg) and route handlers (separate commits) will follow.

## Why passkey-bound refresh tokens?

A district-scale deployment needs sessions that survive a browser tab close, but a 30-day cookie that is just a bearer token is a fat liability: anyone who exfiltrates that cookie owns the account for a month. We bind the refresh token to a specific passkey credential and require a fresh WebAuthn assertion every time the access token expires (~15 min). An exfiltrated cookie is then useless without the user's authenticator.

## Architecture

```
SSO/LTI                 Even Keel API                       Browser
   │                       │                                   │
   │ user authenticates    │                                   │
   │──────────────────────►│                                   │
   │                       │ establishSession()                │
   │                       │   ─ insert refresh row in store   │
   │                       │   ─ Set-Cookie: refresh + access  │
   │                       │◄──────────────────────────────────│
   │                       │                                   │ ... 15 minutes pass ...
   │                       │                                   │
   │                       │   ◄── 401 (access expired)
   │                       │                                   │
   │                       │ POST /api/district/auth/refresh   │
   │                       │   { passkey assertion }           │
   │                       │◄──────────────────────────────────│
   │                       │ refreshAccessToken()              │
   │                       │   ─ verify refresh cookie HMAC    │
   │                       │   ─ look up store row             │
   │                       │   ─ verify WebAuthn assertion     │
   │                       │   ─ ratchet signCount             │
   │                       │   ─ mint new access token         │
   │                       │   ─ Set-Cookie: new access        │
   │                       │──────────────────────────────────►│
```

## Modules

| File | Purpose |
|------|---------|
| `lib/district/types.ts` | `PasskeyCredential`, `RefreshTokenRecord` shapes |
| `lib/district/store.ts` | Store interface: passkey-credential + refresh-token CRUD |
| `lib/district/in-memory-store.ts` | Pilot implementation with FIDO signCount ratchet |
| `lib/district/passkey-verify.ts` | Strict server-side WebAuthn assertion verifier |
| `lib/district/tokens.ts` | HMAC refresh + access token issuance |
| `lib/district/auth.ts` | Orchestrator: `establishSession`, `refreshAccessToken`, `revokeSession` |

## Token shapes

**Refresh token** (HMAC-signed, 30-day TTL, opaque-to-client cookie):

```json
{
  "v": 1,
  "tenantId": "uuid",
  "userId": "uuid",
  "credentialIdB64url": "...",
  "jti": "...",
  "exp": 1748000000000
}
```

**Access token** (HMAC-signed, 15-min TTL, opaque cookie):

```json
{
  "v": 1,
  "tenantId": "uuid",
  "userId": "uuid",
  "roles": ["teacher", "compliance_officer"],
  "exp": 1748000900000,
  "jti": "..."
}
```

Both use distinct HMAC keys (`ROLE_GUARD_SECRET + "::district-refresh"` vs `"::district-access"`) so a refresh token cannot be replayed as an access token and vice-versa.

## Server-side WebAuthn verification

The verifier in `lib/district/passkey-verify.ts` performs the full IETF / W3C-recommended checks:

| Check | Failure code |
|---|---|
| `clientDataJSON.type === "webauthn.get"` | `wrong_type` |
| `clientDataJSON.challenge` matches server-issued challenge | `wrong_challenge` |
| `clientDataJSON.origin` is in `allowedOrigins` | `untrusted_origin` |
| `authenticatorData.rpIdHash` == SHA-256(rpId) | `wrong_rp_id` |
| `authenticatorData.flags & UP` set | `user_not_present` |
| ECDSA-P256 signature verifies over `authData || sha256(clientData)` | `bad_signature` |
| signCount strictly increases (handled by store) | `signcount_replay` |

The signCount ratchet detects authenticator cloning: if a stolen credential is used elsewhere, its signCount diverges from the server's view and the next refresh from the real device gets rejected (or vice-versa). Either way the breach is detected.

## Audit events

Every auth operation appends to `audit_events`:

| Action | Trigger |
|---|---|
| `district.session.established` | SSO/LTI callback issued initial pair |
| `district.session.refreshed` | Refresh succeeded |
| `district.session.refresh_failed` | Refresh rejected for any reason (with `detail.reason` carrying the specific failure code) |
| `district.session.revoked` | Logout / admin revocation |

## Limitations (pilot)

- **In-memory store only.** Process restart loses every refresh row. The Postgres adapter is tracked as `d1-backend-pg`.
- **No automatic refresh rotation.** Refresh tokens reuse the same `jti` for the entire 30-day window. Rotation-on-use is a desirable hardening that the next iteration will add (it bounds the value of a stolen refresh token to a single refresh).
- **No CSRF token.** The refresh endpoint will need a double-submit CSRF cookie or `Sec-Fetch-Site` enforcement when the route handler is added. The HttpOnly + SameSite=Strict refresh cookie provides baseline protection but is not sufficient for a publicly-readable origin.
- **Access tokens are stateless.** They cannot be revoked individually — the 15-min TTL is the revocation window. The refresh path is the chokepoint where revocation actually takes effect.

## Source

All code lives in `lib/district/`. Tests:

- `tests/unit/district-store-auth-extensions.test.ts` — 15 tests for the new store methods
- `tests/unit/district-passkey-verify.test.ts` — 11 tests for the WebAuthn verifier
- `tests/unit/district-tokens.test.ts` — 14 tests for refresh + access token round-trip
- `tests/unit/district-auth.test.ts` — 13 end-to-end tests for the orchestrator
