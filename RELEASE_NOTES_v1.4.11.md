# Release Notes — v1.4.11

**Week-3 theme: identity-bound signatures.**
Release date: 2026-05-04.

## One-line summary

v1.4.11 adds **optional WebAuthn passkey binding** to the Signed
Learning Receipt pipeline. Unenroled learners keep the session-key
path they've always had; enroled learners sign receipts with a real
device-bound passkey (TPM / Secure Enclave / security key). The
verifier page labels every receipt honestly with the key type that
actually signed it.

## Why this release

Since v1.4.6 shipped Signed Learning Receipts, `HONESTY.md` §4.4 has
carried an open item:

> **Crypto keys are not stored.** Each page load generates a new
> ECDSA keypair. Signatures verify within a session; nothing is
> verifiable across sessions or across devices.

That is fine for a demo — a teacher can watch a receipt verify live
on their screen — but it is not fine for anyone who asks *"can this
learner actually own this credential?"* The answer in v1.4.10 was
*"no, the key is a per-tab ephemeral."* The answer in v1.4.11 is
*"yes, if they enrol a passkey; and the UI says so."*

This release closes that entry without pretending the remaining
Phase-2 gaps (institution-issued credentials, revocation, cross-device
on a non-synced browser) are solved. Those stay on the roadmap and
stay documented.

## What shipped

### Cryptographic primitives (risk-bearing, so built first)

- **`lib/crypto/cbor-min.ts`** — a hand-rolled minimal CBOR decoder
  scoped to the WebAuthn subset. Unsigned / negative ints, byte /
  text strings, arrays, maps. Throws `CborDecodeError` on malformed
  input; no "best effort" parsing. A test-only encoder synthesises
  COSE_Key fixtures from real `SubtleCrypto` keys so the test suite
  signs against a known keypair instead of hard-coded bytes.
- **`lib/crypto/cose-to-spki.ts`** — converts a WebAuthn COSE_Key
  public key to SPKI DER for `SubtleCrypto.importKey`. Validates
  `kty=2` (EC2), `alg=-7` (ES256), `crv=1` (P-256), 32-byte `x` and
  `y`; rejects anything else. Emits a fixed 91-byte blob.

Both modules are covered by **17 round-trip assertions** in
`tests/unit/cbor-cose.test.ts`, including an end-to-end signature
verification using a real browser keypair.

### Passkey ceremony helpers

- **`lib/crypto/passkey.ts`** —
  - `isPasskeySupported()` — honest feature detection.
  - `enrolPasskey({ displayName })` — runs
    `navigator.credentials.create()`, parses attestation, derives
    SPKI, persists `{ credentialIdB64url, publicKeyB64url,
    displayName, enrolledAtIso }` in `localStorage`.
  - `signPayloadWithPasskey(payload)` — runs
    `navigator.credentials.get()`, DER→raw converts the ES256
    signature, returns the envelope fields (`contentDigestB64url`,
    `signatureB64url`, `publicKeyB64url`, `webauthn: { ... }`).
  - `verifyPasskeyEnvelope(envelope)` — re-checks the payload
    digest against `clientDataJSON`, imports SPKI, runs ECDSA P-256
    verify over `authenticatorData || SHA-256(clientDataJSON)`.
  - Subscriber API (`getEnrolment` / `subscribeEnrolment` /
    `removeEnrolment`) so UI cards stay in sync.
  - Typed `PasskeyError` surface with discriminated `kind`:
    `not-supported`, `no-enrolment`, `user-cancelled`,
    `assertion-failed`, `invalid-public-key`.
  - **No silent fallback anywhere.** A cancelled or failed
    ceremony throws; callers decide.

**15 unit assertions** in `tests/unit/passkey.test.ts` cover feature
detection, DER→raw conversion, authenticator-data parsing,
enrolment, signing, verification, tamper detection, and back-compat
with the session-key envelope shape.

### Signing-envelope extension

- **`lib/crypto/signing.ts`** gains two optional fields on
  `SignedEnvelope`:
  - `keyType?: "session-demo" | "passkey-derived" |
    "ephemeral-build-time"` (optional so v1.4.10 envelopes still
    parse).
  - `webauthn?: WebauthnAttestation` — present iff
    `keyType === "passkey-derived"`.
- `signPayload` gains a `SignKeySource` parameter. Default
  `{ source: "session" }` is back-compatible; `{ source: "passkey" }`
  drives the passkey ceremony and embeds the attestation.
- `verifyEnvelope` branches on `envelope.webauthn`: passkey
  envelopes dispatch to `verifyPasskeyEnvelope`; session envelopes
  keep the existing ECDSA-SPKI path.

All **269 prior signing / receipt / transparency tests still pass**
unchanged.

### UI — explicit two-button UX

- **`components/shared/PasskeyEnrolCard.tsx`** — mounted on
  `/student`. Four states:
  - `unsupported` → button disabled, explicit "WebAuthn not
    supported in this browser" caption.
  - `ready` → one-button "Enrol a passkey" that drives the OS
    prompt.
  - `enrolling` → spinner + cancellable.
  - `error` → typed error message, no silent recovery.
  Also offers a one-button "Remove this device's passkey" when
  enrolled.
- **`components/shared/IssueReceiptCard.tsx`** — refactored to a
  named state machine:
  - States: `ready` | `signing-session` | `signing-passkey` |
    `passkey-failed` | `issued`.
  - UI: **two buttons**, "Sign with passkey" and "Sign with
    session key". Passkey button is disabled (with an honest reason)
    when no passkey is enrolled or when the browser lacks WebAuthn.
  - A failed passkey ceremony parks the UI in `passkey-failed` and
    shows the specific error. **The user must then deliberately
    click "Sign with session key" if they want to proceed** — the
    platform never silently downgrades.
  - Footer copy flips based on whether a passkey is enrolled.
- **`app/receipt/[id]/page.tsx`** — verifier:
  - Renders a `keyType` badge next to the algorithm label. Passkey
    receipts show a highlighted "passkey" pill; session receipts
    show a muted "session key" pill.
  - Surfaces the short credential id (first 12 chars) for passkey
    receipts.
  - Replaces the single Phase-1 footer with an identity-bound-vs-
    not-bound copy chosen by `envelope.keyType`:
    - Passkey: *"Identity binding is as strong as the learner's
      device / authenticator."*
    - Session: *"not bound to a persistent learner identity … for
      identity-bound receipts, the learner can enrol a passkey."*

### Privacy contract (unchanged)

- No learner free-form text is ever signed into a passkey receipt
  (the payload shape is the same as v1.4.6 — category counts,
  trust score, problem id, initials, jurisdiction).
- `navigator.credentials.create/get` is the only code path that
  leaves the browser sandbox, and it only talks to the local
  authenticator; no network.

## Pipeline lane

All gates stay green:

```text
npm run typecheck       # tsc --noEmit                → 0 errors
npm run lint:strict     # eslint --max-warnings 0     → 0 warnings
npm run test:run        # vitest                      → 301 passed
npm run audit:offline   # manifest + greps + asserts  → pass
npm run repro:build     # reproducibility manifest
npm run transparency:build
npm run audit:strict    # gates on bundle + manifest  → pass
npm run repro:verify    # re-derives all hashes       → pass
npm run transparency:verify                            → pass
```

`package.json` has been bumped to **1.4.11**.

## Governance deltas

- `HONESTY.md` — header updated; §2.1 gains a "WebAuthn passkey
  binding for receipts" row; §2.1 ECDSA row gains the optional
  passkey-signing description; §4.2 adds a "passkey binding is
  optional" entry; §4.4 rewrites the "crypto keys are not stored"
  bullet to distinguish session keys from passkeys.
- `CHANGELOG.md` — full v1.4.11 entry.
- `PROPOSAL_TRUTH_PACK.md` §A — item 18 logs the receipt-key
  identity-binding closure.

## What v1.4.11 still does **not** do

- **Institution-issued passkeys.** A learner can enrol a passkey
  under any `learnerInitials`. Phase 2 ties enrolment to a school
  roster and makes the compliance officer the credential
  administrator (KMS-backed list, revocation, rotation).
- **Server-side revocation / rotation.** Losing the device loses
  the private key. Phase 2 adds a credential list a school can
  invalidate against.
- **Cross-device verification outside the synced-passkey cluster.**
  A learner on a non-synced browser will need to re-issue.

These remain on the Phase-2 roadmap and stay in `HONESTY.md` §4.2.

## Verification commands a sceptical reader can run

```text
# Rebuild and re-verify everything from a clean checkout:
npm install
npm run typecheck
npm run test:run
npm run repro:build && npm run repro:verify
npm run transparency:build && npm run transparency:verify
npm run audit:strict
```

Then in the browser:

1. `/student` → click **Enrol a passkey** → accept the OS prompt.
2. Solve a problem, click **Sign with passkey** on the Issue card.
3. Open the receipt URL → click **Verify signature**.
4. The badge should read **passkey** and the footer should read
   *"Passkey-bound signature …"*.
5. Remove the passkey, re-issue → badge flips to **session key**
   and the footer flips to *"Session-key signature …"*.
