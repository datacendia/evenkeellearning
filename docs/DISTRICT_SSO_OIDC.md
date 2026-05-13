# District SSO — OIDC (Google + generic OpenID Connect)

**Feature ticket**: `d2-sso-oidc`
**Status**: Phase-A complete (pilot). Reviewed against:

- OIDC Core 1.0 — §3.1 (Authorization Code Flow) and §3.1.3.7 (ID Token validation)
- RFC 6749 (OAuth 2.0)
- RFC 7636 (PKCE)
- RFC 7517 / 7518 (JWK / JWA)
- NIST SP 800-63B authenticator-assurance considerations

This document explains how the platform integrates an arbitrary OpenID
Connect provider (Google, Microsoft Entra ID, Okta, Keycloak, Auth0,
generic OP) into the district session model. The OIDC layer is the
source of **verified upstream identity**; session establishment (incl.
passkey-bound refresh tokens) remains the job of
`lib/district/auth.ts`.

---

## 1. High-level flow

```
 ┌──────────┐      ┌────────────────────────┐      ┌─────────┐
 │ Browser  │─1──▶ │  /auth/sso/oidc/start  │─2──▶ │   IdP   │
 │ (user)   │      │  (server)              │      │ (Google)│
 └────┬─────┘      └─────────┬──────────────┘      └────┬────┘
      │ 6                    │ 3 (set Set-Cookie)       │
      │                      │                          │
      │◀───────────────5─────┴──────────4───────────────┘
      │          (signed state cookie + IdP redirect)
      │
      │     ┌────────────────────────────┐
      └─7─▶ │ /auth/sso/oidc/callback/   │─8 verify & exchange───▶ IdP
            │  :tenantId/:providerId     │◀── id_token ───────────
            └─────────┬──────────────────┘
                      │ 9  resolveOidcIdentity (store)
                      │ 10 establishSession (passkey-bound)
                      ▼
                  district access / refresh cookies
```

**Step 2 — `start`**: server generates `state`, `nonce`,
`codeVerifier`, seals them into a signed HttpOnly cookie, and redirects
the browser to the provider's `authorization_endpoint`.

**Step 8 — `callback`**: browser returns with `?code&state`. Server
verifies cookie signature + expiry, matches `state`, exchanges the code
with the provider using the PKCE verifier, then verifies the returned
`id_token` against the provider's JWKS + our stored
`clientId` / `issuer` / `nonce`.

**Steps 9–10**: verified identity → tenant-user resolution (upsert on
`${providerId}:${sub}`) → `establishSession` binds a refresh token to
the user's passkey credential. An OIDC-first user who has never
enrolled a passkey is redirected into the passkey-enrollment flow
before `establishSession` is called.

---

## 2. Module layout

```
lib/district/oidc/
├── pkce.ts         — RFC 7636 verifier/challenge helpers (S256 only)
├── state.ts        — signed HttpOnly state cookie with payload:
│                     { v, state, nonce, codeVerifier, tenantId,
│                       providerId, returnTo?, iat, exp }
├── provider.ts     — per-tenant OidcProviderConfig type + scope defaults
├── discovery.ts    — /.well-known/openid-configuration fetcher + cache
├── flow.ts         — authorize-URL builder + /token code exchange
├── id-token.ts     — OIDC-specific claim validation on top of generic JWT
├── callback.ts     — the end-to-end orchestrator (`completeOidcCallback`)
│                     and identity resolver (`resolveOidcIdentity`)
└── index.ts        — public barrel
```

Supporting generic primitives (extracted from the LTI layer so both
LTI and OIDC share them):

```
lib/jwt/
├── jwks.ts         — JWK→CryptoKey import, alg negotiation
├── jwt.ts          — compact-JWT signature + exp/nbf/iat verification
└── jwks-fetcher.ts — TTL-cached JWKS endpoint fetcher
```

The LTI modules (`lib/lti/jwks.ts`, etc.) are now thin re-export shims
preserving backward-compatible names (`SupportedLtiAlgorithm`).

---

## 3. Security controls (what, and why)

### 3.1 PKCE (RFC 7636, S256)

Every authorize-request includes `code_challenge` +
`code_challenge_method=S256`. The `code_verifier` is random 64 bytes
(86 chars after base64url) — well above the RFC minimum. Plain-PKCE is
**refused**: it's indistinguishable from no PKCE against the attacks it
exists to stop.

### 3.2 Signed state cookie

- Signing key: `ROLE_GUARD_SECRET + "::oidc-state"` (HMAC-SHA-256).
  Tag-chained so key rotation propagates to OIDC state atomically.
- Attributes: `HttpOnly; SameSite=Lax; Secure` (in prod); `Path=/`;
  `Max-Age` = 10 min.
- Payload carries (`state`, `nonce`, `codeVerifier`, `tenantId`,
  `providerId`, optional `returnTo`, `iat`, `exp`) — opaque to the
  browser; validated on callback.
- `SameSite=Lax` (not `Strict`) is required so the top-level redirect
  from the IdP carries the cookie.

### 3.3 CSRF / state binding

The query-param `state` is compared byte-for-byte against the sealed
cookie's `state`. The sealed `tenantId` / `providerId` are compared
against the URL-path ones — prevents a compromised callback route
from being redirected to a different tenant.

### 3.4 ID token validation (OIDC Core §3.1.3.7)

1. Signature via `lib/jwt/jwt.verifyJwt` against the provider's JWKS.
2. `iss` must equal the configured issuer byte-for-byte.
3. `aud` must contain the configured `client_id`; if `aud` is
   multi-valued, `azp` is **required** and must equal `client_id`.
4. `exp` / `nbf` / `iat` time checks with 60 s skew.
5. `nonce` must equal the value we sealed into the state cookie.
6. `sub` must be present and non-empty.
7. Optional `maxAuthAgeSeconds` enforces freshness of `iat`.

All failures emit a **stable reason code** — consumers (audit log,
admin console) can key off the reason without screen-scraping free
text.

### 3.5 Discovery validation

- HTTPS enforced for the issuer URL (localhost allowed in dev).
- The returned document's `issuer` must match the URL we fetched from.
- `authorization_endpoint`, `token_endpoint`, `jwks_uri` must all be
  present and HTTPS (or dev-localhost).
- `id_token_signing_alg_values_supported`, when present, must overlap
  with ours (`RS256`, `RS384`, `RS512`, `ES256`) — otherwise we
  couldn't verify any token the provider issues and refuse up front.
- Discovery result is cached for 10 min. `resetDiscoveryCache()` is
  the test hook.

### 3.6 Token exchange

- Default client auth: `client_secret_basic` (HTTP Basic). We URL-
  encode user info / password so secrets with `:` or `+` don't break
  framing.
- `client_secret_post` is selectable for providers that mandate it.
- Public-client (PKCE-only, no secret) flows are supported —
  `tokenAuthMethod` defaults to `"none"` when no `clientSecret` is
  present on the provider config.
- The `/token` endpoint URL and the JWKS URL are taken from either
  the provider config (pinned) or the discovery document. Pinning
  endpoints is safer for air-gapped tests and providers with flaky
  discovery.

---

## 4. Operator configuration

A tenant-bound provider config is stored in the district store's
(forthcoming) `oidc_providers` table and loaded by the route handler.
Shape:

```ts
interface OidcProviderConfig {
  id: string;                 // "google" | "azure-ad" | "okta-school" | ...
  label: string;              // login-page button text
  issuer: string;             // e.g. "https://accounts.google.com"
  clientId: string;
  clientSecret?: string;      // omitted → public client (PKCE-only)
  scopes?: string[];          // default: ["openid", "email", "profile"]
  authorizationEndpoint?: string;  // pin to skip discovery
  tokenEndpoint?: string;
  jwksUri?: string;
  endSessionEndpoint?: string;     // optional RP-initiated logout
  maxAuthAgeSeconds?: number;      // force recent upstream re-auth
}
```

Redirect-URI convention (register exactly this at the provider):

```
https://<host>/api/district/auth/sso/oidc/callback/<tenantId>/<providerId>
```

---

## 5. Integration points

### 5.1 Identity resolution

`resolveOidcIdentity` upserts on `externalId = "${providerId}:${sub}"`.
This namespaces `sub`s across providers so a user who logs in via
Google and a tenant-local Keycloak gets **two distinct** district
user rows (which is what an admin expects — they are different
identity contexts). `displayName` / `email` are refreshed on every
login so upstream changes propagate.

`autoProvision=false` mode (strict, roster-gated) rejects unknown
users with `unknown_user` — suitable for pilots where the roster
is the source of truth and OIDC is only a credentialing mechanism.

### 5.2 Session establishment

The OIDC orchestrator intentionally stops short of issuing session
cookies. The route handler decides:

- **Has the user enrolled a passkey on this device?**
  Call `establishSession` with the existing credentialId.
- **No passkey yet?** Render `/auth/enroll-passkey`, post-enrol call
  `establishSession` with the newly-created credentialId.

This keeps the passkey-bound refresh guarantee intact across SSO
surfaces (SAML / Clever / ClassLink will follow the same pattern).

---

## 6. Audit events

| Action                              | When                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| `district.session.established`      | After `establishSession` succeeds (detail includes `source=sso.oidc.*`) |
| `district.sso.oidc.callback_failed` | Reserved for the route handler when `completeOidcCallback` returns `!ok` |
| `district.user.created_via_oidc`    | Reserved for `resolveOidcIdentity` auto-provision (route handler emits) |

Audit rows are append-only per `docs/DISTRICT_BACKEND.md`.

---

## 7. Testing

| Module         | Test file                                     | Count |
| -------------- | --------------------------------------------- | ----- |
| PKCE + state   | `tests/unit/district-oidc-pkce-state.test.ts` | 24    |
| id-token       | `tests/unit/district-oidc-id-token.test.ts`   | 19    |
| discovery      | `tests/unit/district-oidc-discovery.test.ts`  | 15    |
| flow           | `tests/unit/district-oidc-flow.test.ts`       | 19    |
| callback + E2E | `tests/unit/district-oidc-callback.test.ts`   | 19    |
| **Total**      |                                               | **96** |

The callback tests spin up an in-process IdP simulator (real ECDSA
keys, real `/token` + `/jwks` + `/.well-known` responses) routed
through a `vi.fn`-wrapped fetcher, then assert both the success path
and each documented failure stage.

---

## 8. Known limitations / follow-ups

1. **Front-channel RP-Initiated Logout (OIDC §5)** is not yet wired.
   The discovery doc's `end_session_endpoint` is captured; the
   logout route will emit a signed `id_token_hint` in a later
   pass.
2. **Dynamic Client Registration (RFC 7591)** is not supported —
   operators must pre-register client credentials with the provider.
3. **`acr` / `amr` step-up** flows are out of scope for Phase-A.
   Callers can inspect `identity.payload.acr` / `.amr` directly if
   they need to.
4. **Multi-issuer federation** (one client accepting tokens from
   many issuers at the same RP) is not supported; a provider is
   identified one-to-one with an issuer.
5. **JWE (encrypted ID tokens)** — we only support JWS. If a
   provider insists on encrypted tokens, that's a future feature.

---

## 9. Source index

- `lib/district/oidc/pkce.ts`
- `lib/district/oidc/state.ts`
- `lib/district/oidc/provider.ts`
- `lib/district/oidc/discovery.ts`
- `lib/district/oidc/flow.ts`
- `lib/district/oidc/id-token.ts`
- `lib/district/oidc/callback.ts`
- `lib/district/oidc/index.ts`
- `lib/jwt/jwks.ts`, `lib/jwt/jwt.ts`, `lib/jwt/jwks-fetcher.ts` — shared primitives
- `lib/lti/jwks.ts`, `lib/lti/jwt.ts`, `lib/lti/jwks-fetcher.ts` — compatibility shims
- `tests/unit/district-oidc-*.test.ts`
