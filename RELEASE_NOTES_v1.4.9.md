# Even Keel Learning — v1.4.9 Release Notes

> **Tag candidate:** `v1.4.9`
> **Cycle:** Week 2 of the Phase-1 honesty-and-controls roadmap.
> **Generated:** 2026-04-27.

This release closes Week 2 of the Phase-1 roadmap. Three coordinated
features turn the prototype into something a school's procurement
officer, DSL, and DPO can each verify offline:

- **Reproducibility manifest** (v1.4.7) — every governed source file +
  governance doc hashed under SHA-256, with a single quoteable
  `aggregateSha256`.
- **DSL escalation pipeline + KCSIE 2025 / Prevent / DfE F&M control
  map** (v1.4.8) — when the Decision Gate fires a `crisis_response`
  block, a category-only signed envelope is enqueued and (optionally)
  POSTed to a school-configured HTTPS endpoint. 13 named controls are
  pinned to verifiable evidence in this codebase.
- **Transparency bundle** (v1.4.9) — a single ECDSA-signed JSON
  artefact aggregating governance, control map, repro manifest, and
  audit manifest. One-click download + one-click in-browser
  signature verification.

---

## What you can hand to whom

| Recipient | Artefact | One-line claim |
|---|---|---|
| Regulator / DfE auditor | `evidence/transparency-bundle.json` | "Bundle's components verify; bundle's signature verifies" |
| Procurement officer | Same bundle, served from `/transparency-bundle.json` | "Download. Verify. Done — no account, no server" |
| DSL / safeguarding lead | `/compliance` → "Safeguarding" tab | "Signed crisis-event queue with category-only payload; HTTPS webhook to your endpoint" |
| Engineer auditing reproducibility | `evidence/reproducibility-manifest.json` | "102 files, 7/7 governance docs, aggregate sha pinned" |

---

## Pipeline state at this tag

Re-derive any of these locally from the repo root:

| Gate | Command | Result at v1.4.9 |
|---|---|---|
| TypeScript | `npm run typecheck` | clean |
| Lint (strict, 0 warnings) | `npm run lint:strict` | clean |
| Unit tests | `npm run test:run` | **241 / 241** across 23 files |
| Audit (offline) | `npm run audit:offline` | passes |
| Audit (strict, with HTTP) | `npm run audit:strict` | **28 passed / 0 failed / 0 skipped** |
| Repro manifest build | `npm run repro:build` | 102 files + 7/7 governance |
| Repro manifest verify | `npm run repro:verify` | 0 mismatches |
| Transparency bundle build | `npm run transparency:build` | signed ECDSA P-256 |
| Transparency bundle verify | `npm run transparency:verify` | governance × 7 / controlMap / repro / audit / componentDigest / signature all OK |

---

## Honest scope

### What is built (Phase 1)
- Categorised crisis lexicon — 17 patterns across 5 families
  (`direct_self_harm`, `temporal_escalation`, `indirect_distress`,
  `cyberbullying_acronym`, `emoji_affect`). Pinned by tests.
- Signed escalation queue with structurally-enforced privacy contract:
  the `EnqueueInput` interface accepts NO `text` parameter, so a future
  contributor cannot accidentally widen the contract without a
  TypeScript error.
- HTTPS-only webhook delivery (with `localhost`/`127.0.0.1` permitted
  for dev). 8000 ms timeout, hard cap at 3 attempts. Receiver verifies
  the envelope offline using the embedded `X-EvenKeel-PublicKey`
  header — no key exchange.
- 13-control map (KCSIE 2025 × 5, Prevent Duty × 3, DfE F&M × 3,
  GDPR Art. 25 × 1). Each control declares `phase1Status`
  (`supported` / `partial` / `phase2`), evidence paths, and an explicit
  `phase2Gap`. CI fails if any cited path no longer exists.
- Transparency bundle — four component streams hashed and digested,
  then ECDSA-signed end-to-end. Verifies offline in any modern browser
  via `SubtleCrypto`.

### What is **not** built (Phase 2, documented honestly)
- **No email / SMS / push-notification provider integration.** The
  Phase-1 contract is HTTPS-only with the school's chosen ingest
  endpoint. Phase 2 requires a Twilio / SendGrid / FCM key and a
  school billing relationship.
- **No retry-on-schedule for failed webhook deliveries.** The
  Compliance Officer manually re-attempts after a `failed` mark.
- **No long-term WORM retention** on the escalation queue. Bounded at
  200 entries, oldest-first eviction.
- **The transparency-bundle signing key is ephemeral.** Generated,
  used once, discarded. `signature.keyType: "ephemeral-build-time"`
  records this in every bundle. The bundle proves *internal
  consistency* — it does **not** prove "Even Keel Learning" or any
  specific institution signed it. Phase-2 swap is a KMS-backed
  institution key or a WebAuthn-passkey-derived signature.
- **DSL identity is not authenticated cryptographically.** The
  Compliance Officer surface is passphrase-gated; WebAuthn is Phase 2.
- **Crisis lexicon is English-only and regex-only.** No locale variants
  and no multi-turn analysis. Phase 2.

All of the above are documented in `HONESTY.md` §3.2 and §4.2, and in
`SAFEGUARDING.md` §1.8 / §1.9.

---

## Cryptographic primitives in use

| Surface | Key lifetime | Algorithm | Verifier |
|---|---|---|---|
| Compliance Resolution Tray signed envelopes | per-tab session | ECDSA P-256 + SHA-256 | `lib/crypto/signing.ts` `verifyEnvelope()` |
| Signed Learning Receipts | per-tab session | ECDSA P-256 + SHA-256 | `app/receipt/[id]/page.tsx`, in-browser `SubtleCrypto` |
| DSL escalation envelopes | per-tab session | ECDSA P-256 + SHA-256 | Receiver verifies offline using embedded `X-EvenKeel-PublicKey` |
| Transparency bundle | **ephemeral build-time** | ECDSA P-256 + SHA-256 (`ieee-p1363`) | `scripts/verify-transparency-bundle.mjs` (Node) and the `/compliance` "Transparency" tab (browser, `SubtleCrypto`) |

All four use the same primitive (`signPayload` / `verifyEnvelope` or its
`ieee-p1363` variant) so a bug in any one of them surfaces in the rest.

---

## Pre-tag stabilisation note

Caught and fixed at tag time: the repro manifest was hashing
`public/transparency-bundle.json`, but the transparency bundle is
*regenerated* on every `npm run transparency:build`. That created a
circular hash dependency — every transparency rebuild silently
invalidated the most recent repro manifest. Fix: added `EXCLUDE_FILES`
to `scripts/build-repro-manifest.mjs` with the bundle path as its sole
entry. Pinned by a regression test in `tests/unit/repro-manifest.test.ts`.

The bundle is already cryptographically anchored by its own ECDSA
signature; double-anchoring through the repro hash chain was
redundant *and* broke pipeline determinism. v1.4.9 ships without the
circularity.

---

## Verifying this release end-to-end

```powershell
# Clone and install
npm ci

# Re-derive every gate
npm run typecheck
npm run lint:strict
npm run test:run
npm run audit:strict          # writes a fresh evidence/test-manifest-*.json
npm run repro:build           # writes evidence/reproducibility-manifest.json
npm run transparency:build    # writes evidence/transparency-bundle.json + public copy

# Verify the artefacts independently
npm run repro:verify          # 0 mismatches expected
npm run transparency:verify   # all components OK + signature OK
```

The `audit:strict` gate already runs `transparency:verify` inline, so
a CI that runs `audit:strict` will fail if the transparency bundle is
stale relative to the codebase.

---

## Next

Week 3 is queued: WebAuthn passkey binding (replaces the ephemeral
build-time key), KMS-backed institution key, multi-turn crisis
analysis, locale-variant crisis lexicons. See `EVEN_KEEL_BIBLE.md` §11.
