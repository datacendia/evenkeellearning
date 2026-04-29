# Even Keel Learning — Safeguarding Policy

> **Audience:** school IT leads, designated safeguarding leads (DSLs),
> data-protection officers, and engineers maintaining Even Keel Learning.
> **Status:** policy is authoritative for the codebase as of 2026-04-27.
> Where the code does not yet meet a clause, this document marks it
> **Phase 2** with a tracking pointer.

This file is the single place a school can read to understand:

1. What safeguards are **active in code today** (with tests as evidence).
2. What safeguards are **promised but not yet implemented** (Phase 2).
3. What a teacher / DSL / parent should do when a flag fires.
4. Who is accountable and how to escalate.

It is intentionally short, enumerated, and traceable. Every numbered clause
links to the code (or to the gap) by absolute path.

---

## 1. Crisis-language interception

**Active.** Every learner message passes through the Decision Gate before
Eke replies. Matches short-circuit to a Childline-style response and the
Eke engine never sees the input.

| Coverage | Example trigger | Tested by |
|---|---|---|
| Direct self-harm verbs | "kill myself", "end it all", "want to die" | `tests/unit/decision-gate.test.ts` (`blocks crisis-language content`) |
| Obfuscated direct verbs | "k\*ll myself", "k1ll myself", "kil1 myself", "kys" | `tests/unit/decision-gate.test.ts` (`catches obfuscated …`) |
| Indirect distress idioms | "don't want to wake up", "no point in anything", "nobody would miss me", "if I was gone", "better off without me" | same suite (`catches indirect distress phrases`) |
| Emoji + negative-affect pairing | 🔪 / 💊 / 🩸 / 🪢 / 🔫 alongside "hopeless", "empty", "numb", "alone", "everything is dark", … | same suite (`catches single-emoji distress signals`) |
| Academic-context preservation | "the theme of suicide in Shakespeare" / "sliced onions with the chef's knife 🔪" must NOT block | same suite (`does NOT false-positive …`) |

**Implementation:** `@c:\Users\Stu\New folder\lib\regulatory-absorb\decision-gate.ts`
**User-facing message:** non-AI, non-Socratic. Names a real helpline
(Childline 1800 66 66 66 in IE; the production deployment must localise this
per jurisdiction — Phase 2).

### Known limits
- Regex lexicon, not ML. **Will miss** novel slang, multi-turn distress,
  sarcasm, and language other than English. Future extension: locale-specific
  lexicons + a small classifier.
- Single-message scope. Does not consider the conversation history.
- Match list is in source. Production deployments must be able to update it
  centrally — Phase 2 (`lib/regulatory-absorb/adapter-mock.ts` will become
  an HTTP adapter).

### 1.5 Assistive-input equity (SEN exoneration)

**Active.** The Interaction Pattern Analyser (`@c:\Users\Stu\New folder\lib\vertolearn\ipa-analyzer.ts`)
honours an `assistiveInput` flag that suppresses cadence-based mimicry
detection. This protects students who use eye-gaze, switch, dictation,
sticky-keys, word-prediction, or alternative keyboards — whose typing
cadence is regular *by design* — from being misclassified as AI-mimicking.

| Behaviour | Without `assistiveInput` | With `assistiveInput` |
|---|---|---|
| Paste-attempt counts | applied | applied (still penalised) |
| Focus-loss volatility | applied | applied (still penalised) |
| `isTooFast` cadence check | applied | **suppressed** |
| `isTooConsistent` cadence check | applied | **suppressed** |
| `assistiveInputDeclared` on the emitted `InteractionPattern` | `false` | `true` (audit-explainable) |

**Where the user declares it.** Two surfaces:

1. **`@c:\Users\Stu\New folder\components\shared\AgeBandGate.tsx`** — first
   visit to `/student` shows a checkbox alongside the age-band picker.
2. **`@c:\Users\Stu\New folder\components\shared\AccessibilitySettingsPanel.tsx`**
   — every surface exposes the universal accessibility-settings button in
   its top bar; the toggle can be flipped at any time.

**Persistence.** The flag lives in `lib/a11y/settings.ts` under the
`evenkeel/a11y/v1` localStorage key. No server is involved. When the flag
is true, every `InteractionPattern` emitted carries
`assistiveInputDeclared: true` so audit replays remain explainable
("the trust meter stayed quiet because the learner declared assistive
input use, not because the engine ignored evidence").

**Why this matters.** A 2023 Stanford study found that mainstream
AI-detectors classify 61% of TOEFL essays as AI-generated; the same
class of false positive systematically affects students with dyslexia,
dysgraphia, and motor differences who use assistive technology. The CRT
+ `assistiveInputDeclared` field gives a teacher reviewing a flag the
information they need to **exonerate** rather than accuse. See
EVENKEEL_BIBLE.md §22 and HONESTY.md §3.

**Tests.** `@c:\Users\Stu\New folder\tests\unit\ipa-analyzer.test.ts`
covers four assertions for this exemption:

- `isAssistiveInput()` reports the constructor flag faithfully.
- A flat-cadence stream that would otherwise trip both `isTooFast` and
  `isTooConsistent` produces a strictly lower score under the exemption,
  and zero in the absence of paste / focus-loss signals.
- Paste pressure still raises the score under the exemption.
- The emitted `InteractionPattern.assistiveInputDeclared` mirrors the
  constructor flag.

### 1.6 Accessibility commitments (WCAG 2.2 AA)

**Active.** v1.3.0 introduces an accessibility settings layer:

| Setting | What it does | File |
|---|---|---|
| Dyslexia-friendly typeface | Swaps Fraunces serif and Geist sans for [Atkinson Hyperlegible](https://brailleinstitute.org/freefont) | `lib/a11y/settings.ts`, `app/globals.css` |
| Wider letter & line spacing | Increases letter-spacing, word-spacing, line-height | `app/globals.css` |
| Larger text | +12.5% base font-size, tightens dim greys | `app/globals.css` |
| Higher contrast | Strengthens text/background contrast (also auto-applies on `prefers-contrast: more`) | `app/globals.css` |
| Focus mode | Hides rail meters and goal cards on `/student`; collapses to single column | `app/student/page.tsx`, `app/globals.css` |
| Literal, idiom-free tone | Swaps mentor warmth for plain phrasing (helps autistic and EAL learners). Wired through `getEffectiveTone()` so Eke's greeting, hint prefix, and encouragements all switch when the toggle is on. The toggle is sampled when the chat mounts; toggling mid-session takes effect on the next chat mount. | `lib/eke/personality.ts`, `components/shared/EkeChat.tsx` |
| Speech-to-text dictation | Optional voice input for severe dysgraphia / motor impairment. The mic opens an explicit consent dialog before recognition starts (browser may send audio to a remote service). Only **final** transcripts are inserted; speech results are excluded from cadence statistics. | `lib/a11y/speech.ts`, `components/shared/EkeChat.tsx` |
| Assistive input | See §1.5 | `lib/vertolearn/ipa-analyzer.ts` |

**Always-on, regardless of the toggle:**

- Skip link to `#kl-main` as the first focusable element on every page.
- Semantic landmarks: `<header role="banner">`, `<nav role="navigation">`,
  `<main role="main">` with `tabIndex=-1` to receive focus from the skip link.
- ARIA labels on every icon-only button and interactive control on
  `EkeChat`, `SurfaceShell`, and `AgeBandGate`.
- 44×44 minimum hit targets on all primary controls (WCAG 2.5.5 AAA).
- `:focus-visible` rings with 2px outline at ≥3:1 contrast (SC 2.4.13).
- `@media (prefers-reduced-motion: reduce)` suppresses every animation we
  ship (vestibular, photosensitive, migraine triggers).
- `@media (forced-colors: active)` restores Windows High Contrast mode
  borders.

**Tests.**

- `@c:\Users\Stu\New folder\tests\unit\a11y-settings.test.ts` — round-trip
  persistence, malformed-input fallback, per-key updates, document
  attribute application, and the `hasA11yOverrides` predicate.
- `@c:\Users\Stu\New folder\tests\unit\eke-engine.test.ts` —
  `getEffectiveTone()` mapping and the literal-tone greeting.
- `@c:\Users\Stu\New folder\tests\unit\speech.test.ts` — Web Speech API
  support detection, unsupported-browser fallback, interim-vs-final
  transcript wiring, error forwarding, session lifecycle.
- `@c:\Users\Stu\New folder\tests\e2e\a11y.spec.ts` — automated axe-core
  checks across all 8 surfaces (`/, /student, /teacher, /parent,
  /compliance, /adult, /trades, /auth`). Fails on serious / critical
  violations. The `color-contrast` rule is currently scoped out (see
  `CHANGELOG.md` v1.3.1 "Known follow-up").
- `@c:\Users\Stu\New folder\docs\SR-TEST-PLAN.md` — manual test scripts
  for NVDA, JAWS, and VoiceOver covering skip-link, landmarks, the
  accessibility settings dialog, AgeBandGate, EkeChat, and the
  speech-to-text disclosure dialog.

**Multi-script dyslexia fonts.** Under
`data-a11y-dyslexia-font="true"`, non-Latin locales switch to
script-appropriate Noto Sans families: Arabic (`:lang(ar)`),
Devanagari (`:lang(hi)`), Hebrew (`:lang(he)`), Thai (`:lang(th)`).
CJK uses the system font stack to avoid large downloads.

**Phase 2.**

- Visual representations (number lines, area models) for dyscalculia.
- Captions for any future voice-input feature on the Trades surface.
- Full design-system color-contrast pass to re-enable the axe
  `color-contrast` rule in CI.

### 1.7 Answer-validation no-leak guarantee

**Active (v1.4.0).** When a problem has a known numeric answer, the
deterministic answer-checker
(`@c:\Users\Stu\New folder\lib\validation\answer-checker.ts`) categorises
the learner's attempt and Eke replies with a Socratic redirect that
points at the *class of error* (sign flip, off-by-one, doubled, halved,
plain wrong) without ever revealing the expected value.

This matters for child-safety because:

1. **A teacher cannot accidentally configure Eke to give answers.** The
   safety property is structural — there is no code path that can write
   the expected value into a reply. Pinned by a brute-force unit test
   that walks every category for a sample expected value of 6 and
   asserts the value never appears in any returned hint.
2. **Defence in depth.** The engine
   (`@c:\Users\Stu\New folder\lib\eke\eke-engine.ts`) re-runs
   `hintContainsAnswer()` on every assembled reply before committing it.
   If the guard fires the reply falls back to the standard tiered hint.
3. **Cross-surface signal carries no PII.** The
   `student.answer.validated` bus event payload contains only the
   category and a boolean `correct` flag. The learner's text is never
   forwarded.
4. **Validation events are never coloured `danger` in the Integrity
   Ledger.** Danger is reserved for trust / integrity signals so a
   wrong answer is never conflated with a cheating signal — protecting
   the learner from the surveillance-feel that ends school pilots.

**Tests.** `@c:\Users\Stu\New folder\tests\unit\answer-checker.test.ts`
(14 assertions) plus three integration assertions in
`@c:\Users\Stu\New folder\tests\unit\eke-engine.test.ts` (correct flow,
sign-flip + leak guard, no-validation fallthrough).

**Out of scope.** Symbolic answers, multi-step proofs, essays, code
correctness — these would require an LLM, which would collapse the
"no answer-generation code path" structural guarantee. The Phase 2
plan in `CHANGELOG.md` v1.4.0 keeps the LLM out of the learner-facing
hot path.

### What a DSL should do when a flag fires
1. **The student already saw the helpline message.** Action 1 has happened.
2. The flagged event is recorded in the local data bus AND, since v1.4.8,
   a signed escalation envelope is enqueued (see §1.8). Open the Compliance
   surface → "Safeguarding" tab to see the queue, configure the school's
   HTTPS ingest endpoint, and fire a synthetic test escalation.
3. v1.4.8 ships HTTPS webhook delivery to a school-configured endpoint.
   **Email / SMS / push-notification delivery to a named DSL is not built
   in Phase 1** — that requires a Twilio / SendGrid / FCM provider key and
   a school billing relationship.
4. Until provider integration lands, schools must either (a) point the
   webhook at their own pastoral / MIS ingest endpoint that already does
   the email/SMS fan-out, or (b) run a **manual review process**: the DSL
   reviews the queue at end-of-day and follows the school's existing
   safeguarding procedure for any `crisis_response` events.

### 1.8 DSL escalation pipeline (v1.4.8)

**Active.** When the Decision Gate (§1) fires a `crisis_response` block,
`@c:\Users\Stu\New folder\components\shared\EkeChat.tsx` does two things
*in addition to* showing the helpline message:

1. Publishes a `safeguarding.escalation.requested` bus event with
   category-only payload, and
2. Calls
   `enqueueEscalation()` in
   `@c:\Users\Stu\New folder\lib\safeguarding\escalation-queue.ts`,
   which signs an envelope with the per-tab ECDSA P-256 session key and
   persists it locally under `evenkeel.safeguarding.queue.v1`.

**Privacy contract — structurally enforced.** The `EnqueueInput`
interface accepts NO `text` parameter. Learner free-form text is
*structurally impossible* to include in an escalation; a future
contributor cannot accidentally widen the contract without a TypeScript
error. The signed payload contains exactly:

```
{
  id, detectedAt, detectedAtIso,
  triggerType: "crisis_response",
  crisisPatternCategory: "direct_self_harm" | "temporal_escalation"
                       | "indirect_distress" | "cyberbullying_acronym"
                       | "emoji_affect",
  jurisdiction, studentAgeBand?, engineVersion, tabContextId
}
```

**Categorisation (5 families).**
The 17 patterns in the crisis lexicon are partitioned via
`detectCrisisCategory()` in
`@c:\Users\Stu\New folder\lib\regulatory-absorb\decision-gate.ts`:

| Category | Examples | Receiving DSL action (school's call) |
|---|---|---|
| `direct_self_harm` | "kill myself", "k\*ll myself", obfuscated variants | Immediate review |
| `temporal_escalation` | "tonight", "right now", "today" + harm verb | Immediate review |
| `indirect_distress` | "don't want to wake up", "no point", "better off without me" | Same-day review |
| `cyberbullying_acronym` | reflexive `kys` | Review with peer-context lens |
| `emoji_affect` | distress emoji + negative-affect word | Same-day review |

The categorisation is forwarded to the engine reply
(`EkeMessage.blockedCrisisCategory`) so the Compliance Officer surface
can show category labels without re-running the regex.

**Webhook delivery contract.** Schools configure one HTTPS endpoint via
`@c:\Users\Stu\New folder\lib\safeguarding\webhook-config.ts`
(localStorage key `evenkeel.safeguarding.webhook.v1`). HTTPS-only;
`localhost` / `127.0.0.1` is permitted for development. The receiver
must accept:

- Method: `POST`
- `Content-Type: application/json`
- Body: the full signed envelope `{ payload, contentDigestB64url, signatureB64url, publicKeyB64url, algorithm: "ECDSA-P256" }`
- Header: `X-EvenKeel-PublicKey` — base64url-encoded P-256 public key (raw)
- Header: `X-EvenKeel-Algorithm: ECDSA-P256-SHA256`
- Timeout: 8000 ms client-side
- Success: HTTP 2xx; anything else marks the entry `failed` and
  increments `attemptCount`. Hard cap at 3 attempts.

The receiver can verify offline using only the data in the body — no
key exchange is required. The same `verifyEnvelope` primitive used in
the Compliance Resolution Tray (§6) and Learning Receipts works here.

**Compliance Officer surface.**
`@c:\Users\Stu\New folder\components\shared\SafeguardingEscalationsCard.tsx`
mounts on `/compliance` under a "Safeguarding" tab and supports:

- Display the local queue (newest first, with category, timestamp,
  jurisdiction, age band, delivery state).
- Configure / clear the school's DSL endpoint URL (HTTPS validation
  pinned by test).
- Trigger a synthetic test escalation so the DSL can confirm wiring
  *without waiting for a real crisis*.
- Verify any stored entry's signature on-page.
- Re-attempt delivery on a `failed` entry.

**Phase 1 limitations.** Documented honestly in the new
`compliance/kcsie-2025-prevent-duty-map.json` (control
`KCSIE_2025_Part_2_DSL_Escalation`, status `partial`) and in HONESTY.md
§3.2. **v1.4.10 closes the retry-scheduler and WORM-retention items
below.** What remains:

- **Email / SMS / push provider delivery — honestly stubbed in v1.4.10.**
  The provider-adapter scaffold (`lib/safeguarding/providers/`) ships a
  fully-implemented `webhook` adapter alongside three stubs
  (`email-sendgrid`, `sms-twilio`, `push-fcm`) that return
  `kind: "provider_key_required"` with a real configHelp string. Phase 2
  fills in the stub bodies, plus the server-side relay each one needs
  so the provider key never ships in the browser bundle.
- DSL identity is not authenticated cryptographically — the Compliance
  Officer surface itself is passphrase-gated (§3) and the WebAuthn
  replacement is Phase 2.
- ~~Queue is bounded at 200 entries with oldest-first eviction; no
  long-term retention with WORM semantics.~~ **v1.4.10:** time-based
  pruning at `RETENTION_DAYS = 90` is the primary eviction trigger
  (`pruneExpiredEscalations()`); the 200-entry cap is a defence-in-depth
  ceiling. Signed payloads are immutable for the retention period;
  entries leave the store only via expiry or the explicit admin
  `clearEscalations()`.
- ~~No retry-on-schedule; Compliance Officer manually re-attempts after
  a `failed` mark.~~ **v1.4.10:** `lib/safeguarding/retry-scheduler.ts`
  ships a deterministic exponential-backoff scheduler
  (`computeBackoffMs`, `shouldRetry`, `runRetryTick`,
  `startRetryScheduler` / `stopRetryScheduler`). Schedule is
  1m → 2m → 4m → 8m → 16m → 32m → 1h → 2h → 4h → 8h → 17h → 24h, capped
  at 24 h, and stops at `MAX_DELIVERY_ATTEMPTS = 3`. Browser-only by
  design — a school running headless safeguarding ingest still needs
  the Phase-2 server-side reliable queue.

**KCSIE 2025 / Prevent Duty / DfE Filtering & Monitoring control map.**
`@c:\Users\Stu\New folder\compliance\kcsie-2025-prevent-duty-map.json`
pins 13 named controls (5 KCSIE, 3 Prevent, 3 DfE F&M, 1 GDPR Art. 25)
to verifiable evidence elsewhere in the codebase. Each entry has a
`phase1Status` (`supported` | `partial` | `phase2`), a list of evidence
{path, claim} pairs, and an explicit `phase2Gap` describing what is
*not* built. CI step `node scripts/audit.mjs --strict` will fail if
any cited path no longer exists — drift between the map and the code
is treated as an audit failure, not a documentation update.

**Tests.**

- `@c:\Users\Stu\New folder\tests\unit\escalation-queue.test.ts` —
  privacy contract pinning (no `text` field on `EnqueueInput`),
  sign / verify round-trip, defensive parser on corrupted localStorage,
  delivery-state transitions, tamper detection.
- `@c:\Users\Stu\New folder\tests\unit\webhook-config.test.ts` — URL
  validation matrix (https / http / file / javascript / localhost),
  persistence round-trip, defensive parser.
- `@c:\Users\Stu\New folder\tests\unit\decision-gate.test.ts` — every
  pattern family asserts the expected `crisisPatternCategory` is set
  on the response.
- `@c:\Users\Stu\New folder\tests\unit\kcsie-control-map.test.ts` —
  every cited evidence path exists; each control declares a known
  framework / phase1Status; the schema invariants hold.

### 1.9 Transparency bundle (v1.4.9)

**Active.** A school's procurement officer, DPO, or auditor can hand a
single signed JSON artefact to a regulator that proves the v1.4.9 build
matches the governance documents and the controls map shipped with it.

**Build.** `npm run transparency:build` runs
`@c:\Users\Stu\New folder\scripts\build-transparency-bundle.mjs`, which
aggregates four component streams:

| Stream | Source | What is hashed |
|---|---|---|
| `governance` | `HONESTY.md`, `SAFEGUARDING.md`, `SECURITY.md`, `EVENKEEL_BIBLE.md`, `CHANGELOG.md` | sha256 + size of each file |
| `controlMap` | `compliance/kcsie-2025-prevent-duty-map.json` | sha256, controls count, frameworks, phase1Status histogram, version |
| `reproducibility` | `evidence/repro-manifest.json` (output of `npm run repro:build`) | sha256, file count, governance docs count, aggregate sha |
| `audit` | newest `evidence/audit-manifest-*.json` (output of `npm run audit:strict`) | sha256, generatedAt, pass/fail/skip counters |

The bundle then computes a `componentDigestB64url` over a deterministic
concatenation of those per-stream digests, signs the canonical-JSON
serialisation of the bundle (minus the signature) with a build-time
**ephemeral** ECDSA P-256 key, and writes
`evidence/transparency-bundle.json` plus a copy at
`public/transparency-bundle.json` so the `/compliance` surface can serve
it directly.

**Verifier.** `npm run transparency:verify` runs
`@c:\Users\Stu\New folder\scripts\verify-transparency-bundle.mjs`,
which:

1. Re-derives every component sha from disk and compares against the
   bundle's recorded shas (drift = fail).
2. Recomputes the `componentDigestB64url` and compares.
3. Re-canonicalises the bundle minus the signature, imports the
   embedded SPKI-DER public key, and runs ECDSA P-256 + SHA-256 verify
   using the raw `ieee-p1363` signature encoding.
4. Exits non-zero on any failure. Supports `--json` and `--quiet`.

**Audit gate.** `node scripts/audit.mjs --strict` runs the verifier
inline. A bundle that drifts from the codebase (governance edited,
control map renamed, repro re-built, audit re-run) fails CI until the
bundle is re-built. This closes the documentation-vs-code gap by making
*the bundle itself* a tested artefact.

**Compliance Officer surface.**
`@c:\Users\Stu\New folder\components\shared\TransparencyBundleCard.tsx`
mounts on `/compliance` under a "Transparency" tab and supports:

- One-glance summary: engine version, generated time, schema version,
  signing algorithm, governance-docs ratio, control-map count,
  reproducibility aggregate sha (truncated), audit pass/fail counts,
  and the full `componentDigestB64url`.
- **Download bundle** — anchor with `download` attribute. One click
  hands the file to procurement / a regulator.
- **Verify signature in browser** — uses SubtleCrypto:
  `importKey("spki", …, ECDSA P-256)` + `verify({ name: "ECDSA", hash: "SHA-256" }, …)`
  on the canonical pre-image. No network round-trip; no trust in this
  page or any server. The same bytes signed at build time are
  reconstructed in-browser via a duplicated canonical-JSON serialiser.
- Honest empty state — if a developer hasn't run the build, the card
  shows the literal shell command instead of failing silently.

**Honesty about the signing key.** The build-time key is **ephemeral**
(generated, used once, not persisted). The bundle's
`signature.keyType: "ephemeral-build-time"` and the `signature.note`
field record this explicitly. What this proves: the four component
shas, the `componentDigestB64url`, and the bundle metadata all came
from one process at one moment — i.e. the bundle is internally
consistent and was not edited after signing. What this does **not**
prove: that *Even Keel Learning* signed it (no long-lived identity is
bound to the key). For institutional non-repudiation, Phase 2 replaces
the ephemeral key with either a KMS-backed institution key or a
WebAuthn-passkey-derived signature.

**Phase 1 limitations.**

- Ephemeral key, as above. Bundle freshness is the verification model
  in Phase 1 — re-build, re-verify, re-publish. Long-lived identity is
  Phase 2.
- The bundle is point-in-time. A school must re-run
  `npm run transparency:build` after any governance / control-map /
  audit change. The `audit:strict` gate enforces this in CI.
- The bundle does not include source code itself; it hashes the
  `repro-manifest.json` which in turn hashes source. Auditors who want
  to walk source files use `npm run repro:verify`.

**Tests.**

- `@c:\Users\Stu\New folder\tests\unit\transparency-bundle.test.ts` —
  builds in a sandboxed temp directory with stub governance docs and a
  copy of the real control map, asserts schema, canonical-JSON
  order-independence, signature-strip, sign/verify round-trip,
  governance-edit tamper detection, `componentDigestB64url` forge
  detection, signature-bit-flip detection, control-map edit detection,
  and a real-codebase smoke build (no write).

### 1.10 Passkey-bound learning receipts (v1.4.11)

**Active (optional).** Signed Learning Receipts (v1.4.6) were honest
but unbound: a per-tab ECDSA session key signs them, so the verifier
proves *the receipt has not been tampered with* but cannot prove
*who* signed it. v1.4.11 adds an opt-in WebAuthn passkey path. A
learner enrols on `/student` (Touch ID / Windows Hello / security
key); subsequent receipts can be signed via "Sign with passkey" and
carry `keyType: "passkey-derived"` plus a `webauthn` attestation
block. The verifier page renders a **honest `keyType` badge** and
swaps the footer copy between identity-bound and not-identity-bound
descriptions. There is **no silent fallback**: a failed passkey
ceremony parks the issue card in `passkey-failed` and forces the
user to deliberately choose the session-key path if they wish to
proceed.

**What this gives a Designated Safeguarding Lead / Compliance
Officer.** A learner who has enrolled a passkey produces receipts
that bind to their device-bound authenticator (TPM / Secure Enclave
/ security key). For the single-teacher-coursework-acceptance use
case (the canonical receipts use case), this means the teacher can
say *"this work was signed by whoever controls Sam's authenticator"*
rather than *"this work was signed by whoever had the tab open"*.

**Honest limits — Phase 2 still owns:**

- Institution-issued passkeys (today a learner can enrol under any
  `learnerInitials` they choose).
- Server-side credential revocation / rotation on a lost device.
- Cross-device verification beyond the synced-passkey cluster.
- The transparency bundle is **still** signed with an ephemeral
  build-time key (§1.9). Phase-2 swap is a KMS-backed institution
  key.

**Files.** `@c:\Users\Stu\New folder\lib\crypto\passkey.ts`,
`@c:\Users\Stu\New folder\lib\crypto\cbor-min.ts`,
`@c:\Users\Stu\New folder\lib\crypto\cose-to-spki.ts`,
`@c:\Users\Stu\New folder\lib\crypto\signing.ts`,
`@c:\Users\Stu\New folder\components\shared\PasskeyEnrolCard.tsx`,
`@c:\Users\Stu\New folder\components\shared\IssueReceiptCard.tsx`,
`@c:\Users\Stu\New folder\app\receipt\[id]\page.tsx`.

**Tests.** 17 round-trip assertions in
`@c:\Users\Stu\New folder\tests\unit\cbor-cose.test.ts` (real
`SubtleCrypto` keypair through encoder + decoder + SPKI + signature)
and 15 assertions in
`@c:\Users\Stu\New folder\tests\unit\passkey.test.ts` (feature
detection, DER→raw conversion, enrolment, signing, verification,
tamper detection, back-compat).

### 1.11 Signed content packs (v1.5.0)

**Active.** Until v1.5.0 the only learner-facing content was hard-coded
into the React tree (`/student` ships a single linear-equation problem;
parallel problems live in `lib/eke/parallel-problems.ts`). v1.5.0 adds
a content authoring pipeline that lets a teacher add a new skill family
without touching code, while preserving every v1.4.x trust property
(no model at learner time, no unreviewed content shown, every hint
traceable).

**Pipeline.**

1. **Authoring** (off-stage, teacher's machine).
   `scripts/author-draft.mjs` invokes a configurable LLM provider —
   `mock` by default, `anthropic` or `openai` when `LLM_PROVIDER` and
   the matching API key env var are set — and writes draft items into
   `content/drafts/<id>.json`. Each draft carries a `draft` provenance
   block (model, provider, prompt hash, draft timestamp) and a *null*
   `approval` block.
2. **Review.** `/author` is a passphrase-gated reviewer surface that
   lists every draft, lets a teacher edit every field, and on
   "Approve & Sign" canonicalises the item, signs it with ECDSA-P256
   using the per-tab session key, and POSTs to
   `/api/author/approve`. The server verifies the approval signature
   (defence-in-depth), adds the reviewer's public key to
   `content/trusted-reviewers.json`, promotes the item into
   `content/packs-raw/<subject>.<skillFamily>.json`, deletes the
   draft, and spawns `scripts/build-content-manifest.mjs` to
   regenerate the signed manifest.
3. **Distribution.** The build script validates each item against the
   schema (`lib/content/schema.ts`), signs items lacking a real
   approval block with a build-time reviewer key, writes signed pack
   JSON to `public/content/packs/`, and emits
   `public/content/manifest.json` with the trusted-reviewers list.
4. **Run-time.** `lib/content/registry.ts` fetches the manifest in the
   browser, verifies pack hashes via SHA-256, verifies each item's
   ECDSA signature against the manifest's trusted-reviewers list, and
   exposes `getMisconception` / `getExplanation` / `getContentItem`.
   `EkeChat.tsx` surfaces the matching misconception explanation
   after a categorised wrong attempt and the post-attempt walkthrough
   after a correct one. **There is no model in this code path.**

**What this prevents.**

- Learner-time generation of hints or explanations. Every string a
  learner sees is pre-authored, signed, and verified before render.
- Silent content drift. Any edit to a signed item invalidates its
  signature; the registry rejects it and the engine falls back to the
  v1.4.5 hand-written corpus. The pipeline cannot regress the engine.
- Untraceable content. Every approved item carries the LLM draft
  provenance AND the reviewer fingerprint, name, approval timestamp,
  and signature. The trusted-reviewers list inside the manifest is
  the audit trail an exam board would ask for.

**Honest gaps (Phase-2 follow-ups).**

- **Reviewer signing key is currently the per-tab session key.** The
  `/author` UI labels approvals `"session-demo"` until the reviewer
  enrols a WebAuthn passkey and the UI is wired to call
  `signPayload(..., { keySource: "passkey" })`. The signature is real
  ECDSA-P256, but it does not bind to a persistent reviewer identity
  across sessions or devices. v1.5.x.
- **`/api/author/approve` has demo-grade auth.** UI-side passphrase
  only (`reviewer-alpha-42`), no server session, no CSRF, no
  rate-limiting. **Production deployments must put this endpoint
  behind a real session bound to the reviewer's enrolled passkey
  before any classroom rollout.** Until that is done, `/author` is
  for the build host or the developer-and-reviewer-pairing demo
  scenario only — never exposed to the open internet.
- **Mock LLM provider is the default.** It writes clearly-labelled
  placeholders that say `[MOCK DRAFT — REWRITE BEFORE APPROVAL]` in
  every field. Nothing it produces can reach a learner without a
  reviewer rewriting it. By design.
- **Non-numeric answer checking is not yet implemented.** The schema
  accepts string answers, but the runtime answer-checker
  (`lib/validation/answer-checker.ts`) is still numeric-only. English
  short-answer / MFL spelling tolerance is a v1.5.x roadmap item.

**Files.**
`@c:\Users\Stu\New folder\lib\content\schema.ts`,
`@c:\Users\Stu\New folder\lib\content\registry.ts`,
`@c:\Users\Stu\New folder\scripts\author-draft.mjs`,
`@c:\Users\Stu\New folder\scripts\build-content-manifest.mjs`,
`@c:\Users\Stu\New folder\app\author\page.tsx`,
`@c:\Users\Stu\New folder\app\api\author\drafts\route.ts`,
`@c:\Users\Stu\New folder\app\api\author\approve\route.ts`,
`@c:\Users\Stu\New folder\components\shared\EkeChat.tsx` (runtime
wiring), `@c:\Users\Stu\New folder\lib\auth\role-guard.ts` (`author`
role).

**Tests.** 10 assertions in
`@c:\Users\Stu\New folder\tests\unit\content-schema.test.ts`
(item / pack validation, three-tier requirement, explanation length
floor, worked-example duplication detection, approval-block
requirement, canonical-hash order-independence and discrimination)
and 3 assertions in
`@c:\Users\Stu\New folder\tests\unit\content-manifest.test.ts`
(real ECDSA-P256 sign+verify roundtrip used by build script and
registry, including tampered-item rejection and wrong-key rejection).

---

## 2. Personal-information interception

**Active.** Same Decision Gate, second pass.

| Pattern | Example | Tested by |
|---|---|---|
| US SSN-shaped digit run | `123-45-6789` | `blocks SSN-shaped numbers` |
| Credential-shaped "password is X" | "my password is hunter2" | `blocks credential-shaped …` |
| Credit-card-shaped number | 13–19 digits with separators | covered indirectly by SSN test |

False-positive prevention: the literal word "password" in academic context
("the password for the Spanish verb hablar is 'hablo'") is **not** blocked,
because the regex requires a credential-shaped surrounding context. This
behaviour is unit-tested.

---

## 3. Access control on privileged surfaces

**Active (demo grade), Phase 2 for production.**

The `/teacher` and `/compliance` surfaces are wrapped in
`@c:\Users\Stu\New folder\components\shared\RoleGuard.tsx`. Access requires:

- Knowing a passphrase (configurable via `NEXT_PUBLIC_TEACHER_PASSPHRASE` /
  `NEXT_PUBLIC_COMPLIANCE_PASSPHRASE` build-time env, demo defaults
  `mentor-alpha-42` / `officer-alpha-42`).
- The passphrase is never stored: only the last 16 hex chars of its SHA-256
  digest are compared, in constant time.
- An unlock is **tab-scoped** (sessionStorage) and revoked on tab close or
  manual "Lock surface" click.
- Failed attempts incur a **400ms cooldown** to discourage interactive
  brute-force.

### Why this is not enough for production

- No account, no per-user audit trail, no revocation list.
- A shared passphrase fails the principle of individual accountability.
- A motivated child who learned the passphrase from a teacher could still
  access the surface.

**Phase 2:** WebAuthn passkeys. The `lib/auth/role-guard.ts` API is shaped
to accept this drop-in replacement (the digest comparison becomes a
signature verification).

### Implementation tests

`tests/unit/role-guard.test.ts` — 7 assertions covering:

- digest determinism + 16-hex format
- starts locked
- wrong passphrase fails
- correct passphrase unlocks
- `lock()` reverts
- failure cooldown ≥ 200 ms

---

## 4. Age-band declaration & guardian acknowledgement

**Active (self-declared), Phase 2 for verifiable parental consent.**

On first visit to `/student`, the learner is shown
`@c:\Users\Stu\New folder\components\shared\AgeBandGate.tsx` which asks for
one of:

- **Under 13** — must additionally tick a guardian-acknowledgement box
  before the gate releases. Eke will use a gentler tone in Phase 2.
- **13 – 17** — standard mode, mentor tone.
- **18 or older** — standard mode, peer tone.

Storage: `localStorage["evenkeel/age-band"]`. No data leaves the device.

### Why this is not yet COPPA §312.5-compliant

COPPA requires **verifiable** parental consent. A checkbox is not
verifiable. This is documented in HONESTY.md and tracked here.

**Phase 2 plan** (`EVENKEEL_BIBLE.md` §11):
1. Email-to-guardian challenge with a one-time code, **or**
2. Government-ID + selfie via a vetted KYC provider (with explicit data-
   minimisation review), **or**
3. School-managed roster import (the school certifies consent itself).

The choice is per-deployment. The Phase 2 ticket is *not* about picking one;
it is about making the AgeBandGate honour whichever the operator selects.

### Implementation tests

`tests/unit/age-band.test.ts` — 5 assertions covering:

- default null
- round-trip per band
- malformed stored value treated as null
- `clearAgeBand()` removes
- `requiresGuardianSafeguards` truth-table

---

## 5. Privacy-by-default architecture

The single strongest safeguard in the codebase is the **architectural
absence** of risky data flows. A future contributor cannot turn these on
silently because they are checked by CI.

| Property | How it is enforced | What CI does |
|---|---|---|
| No biometrics | `scripts/grep-anti-pattern.mjs` scans for `mediaDevices`, `userVerification: "required"` | Build fails if introduced |
| No advertising / tracking | grep for `googletagmanager`, `google-analytics`, `doubleclick`, `facebook` | Build fails if introduced |
| No XSS sinks | grep for `dangerouslySetInnerHTML` | Build fails if introduced |
| No server-side data egress today | There is no server | N/A — there is nothing to break |

The grep is comment-aware: governance docs that *describe* these patterns
do not trip the check.

---

## 6. Audit trail

Every privileged action that reaches the data bus emits a `BusEvent`.
Compliance resolutions are signed with **real ECDSA P-256** (not a mock):

- `@c:\Users\Stu\New folder\lib\crypto\signing.ts` uses the browser's
  `SubtleCrypto`.
- The Audit Vault on `/compliance` exposes a "Verify signature" button that
  re-derives the digest and runs ECDSA verify locally; the user sees a real
  ✓ / ✗.
- Each signed envelope carries `algorithm: "ECDSA-P256"`, `signature`,
  `publicKey`, `digest`. A regulator can verify offline.

### Known limit

The signing key is **session-scoped** (regenerated per page load) and is
**not tied to a real-world identity**. This is documented under HONESTY.md
§2.1 and §3 and on the Compliance UI itself ("session-demo key").

**Phase 2:** persistent KMS-backed key per institution; user-attached
WebAuthn signature when consenting to publish a CRT.

---

## 7. Data subject rights (DSR) for minors

| Right | Status today | Notes |
|---|---|---|
| Access (GDPR Art. 15 / COPPA §312.6) | All data is on-device. The student / guardian can open DevTools → Application → IndexedDB / localStorage to see everything. A friendlier export is **Phase 2**. |
| Rectification (Art. 16) | Same — by editing local state. |
| Erasure (Art. 17) | `localStorage.clear()` and `indexedDB.deleteDatabase("LuminaryOfflineDB")`, exposed as a "Reset everything" button — **Phase 2**. |
| Portability (Art. 20) | Phase 2 — JSON export of the local store. |
| Withdraw consent (Art. 7) | Today: clear `evenkeel/age-band` from localStorage. Phase 2: explicit button. |
| COPPA §312.5 verifiable parental consent | **Phase 2** — see §4. |

---

## 8. Incident response

**If a child appears to be in immediate danger** based on a flagged event:

1. The Childline message has already been shown. **Do not delete it.**
2. Follow the school's own safeguarding procedure exactly as you would for
   a verbal disclosure. Even Keel Learning's flag is corroborating evidence; it does
   not replace your judgement.
3. Preserve the local audit log for review:
   - On the affected device, open the Compliance surface → Audit Vault.
   - Use "Verify signature" to confirm the ledger has not been tampered with
     in this session.
   - Export the JSON manifest (`evidence/test-manifest-*.json` is the latest
     audit run) and attach it to your safeguarding incident report.
4. Re-issue the device or change the role passphrase if you suspect the
   child has elevated privileges.

**If you discover a vulnerability** in the safeguarding code itself, follow
[SECURITY.md](./SECURITY.md). Do not file a public GitHub issue.

---

## 9. Accountability

| Role | Responsibility |
|---|---|
| **Engineering** | Keep the Decision Gate, RoleGuard, AgeBandGate, and audit pipeline honest. Maintain test coverage. Refuse PRs that introduce biometrics / tracking / `dangerouslySetInnerHTML`. |
| **Designated Safeguarding Lead (per school)** | Review Integrity Ledger, follow up on `crisis_response` events. |
| **Data Protection Officer (per institution)** | Honour DSR requests; gate any production deployment on Phase 2 items §4 and §6. |
| **Parents / guardians** | Acknowledge the AgeBandGate honestly; review the local data their child generates as needed. |

---

## 10. Where this policy lives in the code

- `@c:\Users\Stu\New folder\lib\regulatory-absorb\decision-gate.ts` — §1, §2
- `@c:\Users\Stu\New folder\lib\vertolearn\ipa-analyzer.ts` — §1.5 (assistive-input exemption)
- `@c:\Users\Stu\New folder\lib\a11y\settings.ts`, `@c:\Users\Stu\New folder\components\shared\AccessibilityProvider.tsx`, `@c:\Users\Stu\New folder\components\shared\AccessibilitySettingsPanel.tsx` — §1.5, §1.6
- `@c:\Users\Stu\New folder\lib\auth\role-guard.ts`, `@c:\Users\Stu\New folder\components\shared\RoleGuard.tsx` — §3
- `@c:\Users\Stu\New folder\lib\auth\age-band.ts`, `@c:\Users\Stu\New folder\components\shared\AgeBandGate.tsx` — §4
- `@c:\Users\Stu\New folder\scripts\grep-anti-pattern.mjs` — §5
- `@c:\Users\Stu\New folder\lib\crypto\signing.ts` — §6
- `@c:\Users\Stu\New folder\lib\validation\answer-checker.ts` — §1.7
- `@c:\Users\Stu\New folder\lib\safeguarding\escalation-queue.ts`, `@c:\Users\Stu\New folder\lib\safeguarding\webhook-config.ts`, `@c:\Users\Stu\New folder\components\shared\SafeguardingEscalationsCard.tsx`, `@c:\Users\Stu\New folder\compliance\kcsie-2025-prevent-duty-map.json` — §1.8
- `@c:\Users\Stu\New folder\scripts\build-transparency-bundle.mjs`, `@c:\Users\Stu\New folder\scripts\verify-transparency-bundle.mjs`, `@c:\Users\Stu\New folder\components\shared\TransparencyBundleCard.tsx` — §1.9
- `@c:\Users\Stu\New folder\tests\unit\decision-gate.test.ts`, `@c:\Users\Stu\New folder\tests\unit\role-guard.test.ts`, `@c:\Users\Stu\New folder\tests\unit\age-band.test.ts`, `@c:\Users\Stu\New folder\tests\unit\ipa-analyzer.test.ts`, `@c:\Users\Stu\New folder\tests\unit\a11y-settings.test.ts`, `@c:\Users\Stu\New folder\tests\unit\answer-checker.test.ts`, `@c:\Users\Stu\New folder\tests\unit\eke-engine.test.ts`, `@c:\Users\Stu\New folder\tests\unit\speech.test.ts`, `@c:\Users\Stu\New folder\tests\unit\escalation-queue.test.ts`, `@c:\Users\Stu\New folder\tests\unit\webhook-config.test.ts`, `@c:\Users\Stu\New folder\tests\unit\kcsie-control-map.test.ts`, `@c:\Users\Stu\New folder\tests\unit\transparency-bundle.test.ts`, `@c:\Users\Stu\New folder\tests\e2e\a11y.spec.ts` — evidence

---

## 11. Glossary

- **DSL** — Designated Safeguarding Lead (UK/IE term).
- **DPO** — Data Protection Officer.
- **CRT** — Cognitive Reasoning Trace, the signed JSON envelope describing
  a learning event.
- **Integrity Ledger** — the live tail of bus events shown on `/teacher`
  and `/compliance`.
- **Phase 2** — features that are designed, scoped, and tracked in
  `EVENKEEL_BIBLE.md` §11 but not yet implemented in `main`.

> Last updated: 2026-04-27. Re-derive evidence with `npm run audit:strict`.
