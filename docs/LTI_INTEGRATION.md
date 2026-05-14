# LTI 1.3 Integration Guide

Even Keel supports launching from any LTI 1.3-compliant Learning Management System (Canvas, Moodle, Schoology, Blackboard, Brightspace, etc.). This document explains how to register Even Keel as a tool inside your LMS and what to expect once a launch succeeds.

## Architecture

The launch flow follows the standard LTI 1.3 / OIDC implicit grant pattern with `response_mode=form_post`:

```
LMS                                     Even Keel
 │  POST /api/lti/login (OIDC initiate) │
 │ ───────────────────────────────────► │
 │                                      │  validate iss + client_id
 │                                      │  generate nonce + signed state
 │  302 → LMS authorize endpoint        │
 │ ◄─────────────────────────────────── │
 │                                      │
 │  user authenticates / SSO at LMS     │
 │                                      │
 │  POST /api/lti/launch (id_token)     │
 │ ───────────────────────────────────► │
 │                                      │  verify state, fetch JWKS,
 │                                      │  verify id_token signature,
 │                                      │  validate LTI claims,
 │                                      │  match nonce
 │  303 → target_link_uri               │
 │ ◄─────────────────────────────────── │
```

## Endpoints

Once Even Keel is deployed, configure your LMS with the following:

| Field | Value |
|-------|-------|
| **OIDC login initiation URL** | `https://YOUR-EVENKEEL-DOMAIN/api/lti/login` |
| **Launch URL (redirect URI)** | `https://YOUR-EVENKEEL-DOMAIN/api/lti/launch` |
| **Public key URL / JWKS** | *(pending — Advantage support not yet implemented)* |
| **Default target_link_uri** | `https://YOUR-EVENKEEL-DOMAIN/lti/launched` |

Your school can override the target by setting a more specific `target_link_uri` on the LMS link — for example `https://evenkeel.org/learner` or `https://evenkeel.org/teacher`. The launch handler will refuse any target outside of Even Keel's own origin.

## Platform registration

Even Keel needs to be told about each LMS deployment before it will accept launches from it. In production, set the `LTI_PLATFORMS_JSON` environment variable to a JSON array of platform records:

```json
[
  {
    "id": "your-school-canvas",
    "label": "Your School Canvas",
    "issuer": "https://canvas.instructure.com",
    "clientId": "10000000000001",
    "deploymentIds": ["1:abcdef0123456789"],
    "authLoginUrl": "https://canvas.instructure.com/api/lti/authorize_redirect",
    "jwksUrl": "https://canvas.instructure.com/api/lti/security/jwks",
    "tokenUrl": "https://canvas.instructure.com/login/oauth2/token"
  }
]
```

Each field:

- **`id`** — a stable name you choose for your records. Not transmitted to the LMS.
- **`issuer`** — the LMS's stable `iss` claim. Canvas uses `https://canvas.instructure.com` (or your self-hosted Canvas instance's domain). Moodle uses its base URL.
- **`clientId`** — the OAuth2 client ID the LMS assigned when you registered the tool.
- **`deploymentIds`** — one or more deployment IDs (an LMS may host the same tool in multiple courses; each gets a separate deployment).
- **`authLoginUrl`** — the LMS endpoint we redirect the browser to during OIDC.
- **`jwksUrl`** — where the LMS publishes its signing-key JWKS.
- **`tokenUrl`** — *(optional)* OAuth2 token endpoint. Reserved for LTI Advantage services.

In development, a fixture of two illustrative platforms (`dev-canvas`, `dev-moodle`) is used. Set `NODE_ENV=production` plus `LTI_PLATFORMS_JSON` to disable the fixture.

## Roles

LTI roles are mapped to Even Keel internal roles as follows:

| LTI role URI | Even Keel role |
|---|---|
| `Administrator` (any namespace) | `admin` |
| `Instructor`, `Faculty`, `TeachingAssistant` | `teacher` |
| `Learner`, `Student` | `learner` |
| anything else | `unknown` (no privileged session issued) |

If a user has multiple roles, the highest-privilege role wins (`admin` > `teacher` > `learner`).

## Custom parameters

Any `custom` claim values the LMS forwards are made available verbatim on the launch object. We currently surface them in the diagnostic page but do not enforce semantics — your school can wire custom parameters to choose a specific content pack or course-level setting in future versions.

## Session

A successful launch issues an HttpOnly, signed cookie called `evk_lti_session` valid for 2 hours. It carries the launched platform, deployment, user sub, role, and resource-link id. The cookie is set with `SameSite=None` so it survives the cross-origin iframe context most LMSes use.

## Limitations (pilot)

- **No LTI Advantage services yet.** Names and Roles Provisioning Service (NRPS), Assignment and Grade Services (AGS), and Deep Linking are deferred to a later milestone.
- **No tool key publication.** The tool does not currently sign requests *back* to the LMS (which is what Advantage services require). LMSes that demand it will reject the registration; LMSes that just need launch will accept.
- **In-memory revocation only.** A logged-out session's `jti` is held in process memory, not a shared store. A multi-instance deploy needs a database hook here (see todo `d1-backend`).
- **Static registration.** New LMS deployments require an env-var change + redeploy. A self-service admin console comes later.

## Verifying a deployment

After configuring Even Keel inside your LMS, click the tool link as an instructor. You should land on `/lti/launched` showing your platform id, role, and resource-link id. If you see a `400 LTI launch rejected: …` message, the trailing reason code maps to the failure path:

| Reason | What it means | Fix |
|---|---|---|
| `state_bad_signature` | Login → launch round-trip used a state we did not issue | check that both endpoints share `ROLE_GUARD_SECRET` |
| `unknown_platform` | issuer/client_id/deployment_id triple is not registered | add to `LTI_PLATFORMS_JSON` |
| `jwks_bad_status` | LMS JWKS endpoint returned non-2xx | check LMS health |
| `jwt_unknown_kid` | LMS rotated keys after we cached them | resolves on next TTL expiry (10 min) |
| `jwt_bad_signature` | id_token cannot be verified against the JWKS | LMS / registration mismatch — re-register |
| `nonce_mismatch` | nonce in id_token doesn't echo the one we issued | possible replay attack; rare in practice |
| `launch_unsafe_redirect` | target_link_uri points outside Even Keel's origin | fix the link in the LMS |

## Source

The launch handler lives in `app/api/lti/launch/route.ts`; the pure helpers are in `lib/lti/`:

- `lib/lti/config.ts` — platform registry
- `lib/lti/oidc.ts` — login initiation parsing + auth-URL building
- `lib/lti/jwks.ts` — JWK → CryptoKey conversion
- `lib/lti/jwks-fetcher.ts` — TTL-cached JWKS fetcher
- `lib/lti/jwt.ts` — signature + time-claim verifier
- `lib/lti/launch.ts` — LTI claim validator
- `lib/lti/state.ts` — signed state binding
- `lib/lti/session.ts` — launched-user session cookie

All have unit tests under `tests/unit/lti-*.test.ts`.
