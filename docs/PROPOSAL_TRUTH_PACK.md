# Proposal Truth Pack — for the Laura cofounder document

**Purpose.** This file is the authoritative *content* source for the
*"What's already built"*, *"How it works"*, *"Phase 2"*, and
*"The hour-inside"* sections of the cofounder proposal
`Luminary cofounder proposal.docx`. The previous version of those
sections overclaimed (e.g. "live AI tutor powered by Claude", "working
safety controls"). This file replaces them with statements that are true
against the current `c:\Users\Stu\New folder` repo at **v1.4.9**, verified
by `tsc --noEmit`, `next lint --max-warnings 0`, `vitest run`
(**241 tests across 23 files**), `playwright test tests/e2e/a11y.spec.ts`
(8 surfaces), `node scripts/audit.mjs --strict` (**28 passed / 0 failed /
0 skipped**), `npm run repro:verify` (0 mismatches), and
`npm run transparency:verify` (signature OK).

**This file is content only.** Tone, framing, and rewriter instructions
live next door in `@./PROPOSAL_REWRITER_NOTES.md` so that pasting any
section here verbatim cannot accidentally drop meta-instructions into the
proposal.

**Section markers.** Each section is delimited by HTML comment markers
(`<!-- truth-pack:section-a:start -->` … `:end -->`). A small extractor
at `@../scripts/extract-truth-pack-section.mjs` reads between these
markers, so a future build script (or a Claude-with-docx-skill prompt
template) can pull a single section without manual copy-paste. This is
how we make truth-pack-to-docx mechanical rather than procedural.

> **Process for using this file:** either pipe sections through the
> extractor, or open the .docx alongside this file and paste each
> marker-delimited section verbatim. The headings below mirror the
> .docx structure.

---

<!-- truth-pack:section-a:start -->
## §A — What's already built (replaces the existing section verbatim)

Even Keel Learning v1.4.11 is a working Next.js 14 / React 18 / TypeScript prototype
that runs entirely in the browser. There is no back-end, no database, and
no LLM in the bundle — and that is a feature, not a gap. Every property
below is reproducible from the repo: clone, `npm install`, `npm run dev`,
open the route. The audit manifest in `evidence/` carries SOC 2 / ISO
27001 / GDPR / COPPA control tags. A signed transparency bundle in
`evidence/transparency-bundle.json` aggregates governance docs + control
map + reproducibility manifest + audit manifest into a single artefact a
procurement officer / DPO / regulator can verify offline.

**The architecture is the point.** Every item below — and every
pedagogy and compliance commitment in the roadmap — only fits because
no LLM sits in the learner-facing path. A competitor can copy any single
feature. They cannot copy the substrate that makes evidence-based
pedagogy, auditable safety, and on-device privacy compound on each other
instead of fighting. That compounding is the moat.

**1. Deterministic Socratic engine with structurally enforced
no-direct-answers guarantee.**
Eke is a template-driven state machine, not an LLM. The "never gives the
answer" property is provable by `grep` — there is no answer-generation
code path in `lib/eke/eke-engine.ts`. Three personality tones (mentor /
peer / foreman) and one accessibility tone (literal, idiom-free) drive
the greeting, hint prefix, and blocked-content reply.
*Files:* `lib/eke/eke-engine.ts`, `lib/eke/tiered-hints.ts`,
`lib/eke/personality.ts`.

**2. Deterministic answer validation — new in v1.4.0.**
The engine extracts a numeric assertion from learner free-form text and
categorises it as `correct`, `off_by_one`, `sign_flipped`, `doubled`,
`halved`, `wrong`, or `no_attempt`. The expected value is never written
into Eke's reply — pinned by a brute-force unit test that walks every
category and asserts the hint never contains the expected number, plus a
defence-in-depth re-check inside the engine before any reply is
committed. The category, not the learner's text, is the only thing
published to the cross-surface bus, so the Teacher Integrity Ledger now
shows correctness alongside methodology without introducing a privacy
leak.
*Files:* `lib/validation/answer-checker.ts`, `lib/eke/eke-engine.ts`,
`lib/data-bus.ts`, `app/teacher/page.tsx`.
*Out of scope (deliberately):* symbolic answers, multi-step proofs,
essays, code correctness — these would require an LLM, which would
collapse the structural-safety guarantee. See Phase 2.

**3. Real ECDSA P-256 signing in the browser.**
Each session generates a keypair via `SubtleCrypto`, signs the CRT payload
on demand, and the Compliance surface offers a one-click verify button
that re-derives the digest and runs ECDSA verify locally. The key is
labelled "session-demo key" because it is not tied to a real identity
provider yet — but the signing math is real, not stubbed.
*Files:* `lib/crypto/signing.ts`. *Tests:* 5 assertions in
`tests/unit/crypto-signing.test.ts`.

**4. Real Decision Gate with a 5-family categorised crisis lexicon
(17 patterns) and emoji-affect rule — categorisation new in v1.4.8.**
Direct (`direct_self_harm`), temporal-imminent (`temporal_escalation`),
indirect (`indirect_distress` — "don't want to wake up", "no point in
anything", "nobody would miss me"), reflexive cyberbullying acronyms
(`cyberbullying_acronym` — `kys`), and emoji-plus-negative-affect
(`emoji_affect`). Each match returns *which family* fired, never the
matched text. False-positive prevention is pinned: "the theme of suicide
in Shakespeare" and "sliced onions with the chef's knife 🔪" both pass
through unblocked. PII patterns (emails, phone numbers) are also
short-circuited.
*Files:* `lib/regulatory-absorb/decision-gate.ts`. *Tests:* expanded to
family-by-family assertions in `tests/unit/decision-gate.test.ts`.

**5. Real keystroke-cadence mimicry analyser (IPA) with SEN equity
exemption.**
Records per-keystroke timestamps, computes mean and standard deviation of
inter-keystroke intervals, combines with paste attempts and focus loss
into a [0..1] mimicry probability. The live Trust Meter in chat updates
on every keystroke. The analyser honours an `assistiveInput` declaration
that suppresses cadence-based components for users of eye-gaze, switch,
dictation, sticky-keys, or word-prediction tools — paste and focus-loss
signals still apply. Documented in SAFEGUARDING.md §1.5.
*Files:* `lib/vertolearn/ipa-analyzer.ts`,
`components/shared/EkeChat.tsx`. *Tests:* 4 assertions in
`tests/unit/ipa-analyzer.test.ts`.

**6. Real role guard with constant-time compare.**
`/teacher` and `/compliance` are wrapped in a passphrase gate. Plaintext
is never stored — only the last 16 hex chars of `SHA-256(passphrase)` are
compared in constant time. Unlock is sessionStorage-scoped (per-tab); a
failure incurs a 400 ms cooldown. Demo only — Phase 2 swaps in WebAuthn
passkeys.
*Files:* `lib/auth/role-guard.ts`, `components/shared/RoleGuard.tsx`.
*Tests:* 7 assertions in `tests/unit/role-guard.test.ts`.

**7. Real age-band gate with under-13 guardian acknowledgement.**
Three bands. Self-declared today (Phase 2 introduces COPPA §312.5
verifiable consent).
*Files:* `lib/auth/age-band.ts`, `components/shared/AgeBandGate.tsx`.
*Tests:* 5 assertions in `tests/unit/age-band.test.ts`.

**8. Real Most-Restrictive prioritizer running against seed regulatory
data.**
Severity weights (critical=100, high=75, medium=50, low=25) plus
jurisdiction weights (EU=30, IE=25, GB=20, IN=19, PE=18, BR=17, US=15)
plus a local-override bonus (+10). Deterministic maths over a
production-shaped type contract. The Compliance surface runs a real
resolution against the seed data and signs the outcome.
*Files:* `lib/regulatory-absorb/types.ts`, `prioritizer.ts`,
`jurisdictions.ts`, `adapter-mock.ts`.

**9. Real cross-surface live event bus.**
BroadcastChannel + bounded localStorage ring buffer. Open `/student` and
`/teacher` in two tabs and the teacher's Integrity Ledger tails the
student's events in real time — gate clearances, hint requests, paste
blocks, submissions, and (new in v1.4.0) answer-validation outcomes.
Single browser, single device. Cross-device sync is Phase 2.
*Files:* `lib/data-bus.ts`, `lib/hooks/useLiveTrust.ts`.

**10. Accessibility commitments — WCAG 2.2 AA.**
Skip link, semantic landmarks, ARIA labels on every icon-only control,
44×44 hit targets, `:focus-visible` rings, `prefers-reduced-motion`,
`prefers-contrast: more`, and `forced-colors: active` honoured. Real
accessibility settings layer with seven persisted toggles
(`lib/a11y/settings.ts`). Speech-to-text input for severe dysgraphia
(`lib/a11y/speech.ts`) with explicit consent dialog. Multi-script
dyslexia font fallbacks (Arabic, Devanagari, Hebrew, Thai). Documented
in SAFEGUARDING.md §1.6.
*Verification:* automated axe-core checks across all 8 surfaces in
`tests/e2e/a11y.spec.ts` (`/, /student, /teacher, /parent, /compliance,
/adult, /trades, /auth`), failing on serious/critical violations.
Manual NVDA/JAWS/VoiceOver scripts in `docs/SR-TEST-PLAN.md`.

**11. Nine-locale i18n with RTL.**
EN, GA, AR, ES, PT, ZH, HI, FR, DE. Arabic ships as RTL.
*Files:* `lib/i18n/`, `app/globals.css` (RTL rules).

**12. Audit manifest pipeline.**
`scripts/audit.mjs` runs typecheck + ESLint + 241 vitest assertions +
privacy / XSS greps + 8 inline assertions (including a marker-integrity
check on this file, a KCSIE control-map evidence-paths check, and a
transparency-bundle verifier) and writes a Datacendia-shaped manifest
to `evidence/test-manifest-enterprise-complete-*.json`. Every record
carries SOC 2 / ISO 27001 control tags. The audit report is regenerated
to `reports/AUDIT_REPORT.md`.

**13. Personal error bank, spacing scheduler, and tier-4 worked-parallel
hint — pedagogy that compounds.**
*v1.4.2:* a learner-owned, category-only "My Patterns" journal. Every
non-correct, non-skipped attempt is recorded as a category (off-by-one,
sign-flipped, doubled, halved, wrong) with a count and last-seen
timestamp. Never carries the learner's text or the expected value.
*v1.4.3:* a private practice mode that brackets a session and tags every
bus event with `practiceMode: true`, so the Teacher Integrity Ledger
shows the bracket but suppresses per-attempt detail.
*v1.4.4:* a deterministic 5-box Leitner spacing scheduler over
previously-attempted problems, with standard cadence 1 / 3 / 7 / 14 / 30
days. No fitted parameters, no LLM, parent-explainable in one sentence.
*v1.4.5:* a hand-written corpus of fully-worked **parallel problems**
keyed by `skillFamily`. After the 3 hint tiers are exhausted, the engine
serves a parallel — a different problem in the same shape with different
numbers, walked end-to-end. The leak guard runs over the parallel's
worked solution against the original's expected value, so a parallel
that would echo the answer is skipped. Every LLM-EdTech tier-4 is
structurally the same — give the answer, dressed up as an explanation.
This codebase has a real tier-4 because the no-answer-generation
guarantee makes it safe to walk a sister problem.
*Files:* `lib/eke/error-bank.ts`, `lib/eke/practice-mode.ts`,
`lib/eke/scheduler.ts`, `lib/eke/parallel-problems.ts`, with right-rail
UI in `components/shared/MyPatternsCard.tsx`,
`components/shared/PracticeModeBar.tsx`,
`components/shared/ComingBackCard.tsx`. *Tests:* dedicated unit suites
for each module plus engine-integration assertions.

**14. Signed Learning Receipts — new in v1.4.6.**
A learner-issued ECDSA P-256 signed snapshot of work on a single problem
— aggregate-only payload, no learner free-form text, no expected value.
Designed against the single-teacher-coursework-acceptance use case:
shareable URL → recipient opens `/receipt/[id]` → one-click verify in
browser → no server contacted, no account required. The teacher who
says *"yes, I'll accept this signed receipt for one coursework grade"*
is the first rung; school → multiple schools → exam board → university
is a shorter path from there than from zero.
*Files:* `lib/receipts/learning-receipt.ts`,
`components/shared/IssueReceiptCard.tsx`, `app/receipt/[id]/page.tsx`.
*Honesty (v1.4.6 baseline):* the default signing key is still a per-tab
ECDSA session key — not yet bound to a persistent identity.
*Closed in v1.4.11:* a learner can now optionally enrol a WebAuthn
passkey on `/student` and sign receipts with it; see Item 18.

**15. Reproducibility manifest — new in v1.4.7.**
`evidence/reproducibility-manifest.json` carries SHA-256 hashes
(base64url) of every governed source file under `app/`, `components/`,
`lib/`, `scripts/`, `tests/`, `public/`; SHA-256 hashes of every
governance doc; a dependency snapshot (package.json + lockfile hashes,
resolved-package count); a pointer to the latest audit manifest with
its sha; and a git fingerprint when the workspace is a git checkout.
A single `aggregateSha256` is the value a CI badge or attestation can
quote. `npm run repro:verify` re-derives everything and exits non-zero
on any drift.
*Files:* `scripts/build-repro-manifest.mjs`,
`scripts/verify-repro-manifest.mjs`. *Tests:* 19 assertions in
`tests/unit/repro-manifest.test.ts`, including a tamper-detection
suite in a sandboxed temp directory.

**16. DSL escalation pipeline + KCSIE 2025 / Prevent / DfE F&M control
map — new in v1.4.8.**
When the Decision Gate fires a `crisis_response` block, EkeChat
publishes a `safeguarding.escalation.requested` bus event AND signs an
envelope (ECDSA P-256, re-using the receipts primitives) into a local
queue persisted at `evenkeel.safeguarding.queue.v1`. **Privacy contract
— structurally enforced:** the `EnqueueInput` interface accepts NO
`text` parameter, so a future contributor cannot accidentally widen
the contract without a TypeScript error. Payload is
`{ id, detectedAt, triggerType, crisisPatternCategory, jurisdiction,
studentAgeBand?, engineVersion, tabContextId }` — categorisation only.
Schools configure one HTTPS endpoint via the new "Safeguarding" tab on
`/compliance`; signed envelopes are POSTed with `X-EvenKeel-PublicKey`
so the receiver can verify offline. The Compliance Officer can fire a
synthetic test escalation, attempt delivery, and verify any stored
signature on-page. `compliance/kcsie-2025-prevent-duty-map.json` pins
13 named controls (5 KCSIE 2025 × 3 Prevent × 3 DfE F&M × 1 GDPR
Art. 25) to verifiable evidence elsewhere in the codebase; the audit
strict gate fails if any cited path no longer exists.
*Files:* `lib/safeguarding/escalation-queue.ts`,
`lib/safeguarding/webhook-config.ts`,
`components/shared/SafeguardingEscalationsCard.tsx`,
`compliance/kcsie-2025-prevent-duty-map.json`.
*Out of scope (Phase 2):* email / SMS / push-notification provider
integration to a named DSL — that requires a Twilio / SendGrid / FCM
key plus a school billing relationship.

**17. Transparency bundle export — new in v1.4.9.**
A single signed JSON artefact a school's procurement officer / DPO /
auditor can hand to a regulator. Aggregates four component streams:
governance docs, the KCSIE/Prevent control map, the reproducibility
manifest, and the latest audit manifest — each hashed, then end-to-end
signed with a build-time **ephemeral** ECDSA P-256 key using
`ieee-p1363` raw r‖s so the signature verifies in any modern browser
via `SubtleCrypto`. `npm run transparency:verify` (and the `audit:strict`
gate) re-derives every component sha and runs ECDSA verify; drift fails.
The `/compliance` "Transparency" tab serves the bundle from
`public/transparency-bundle.json` with one-click download and one-click
in-browser verify (no network round-trip).
*Files:* `scripts/build-transparency-bundle.mjs`,
`scripts/verify-transparency-bundle.mjs`,
`components/shared/TransparencyBundleCard.tsx`. *Tests:* 11 assertions
in `tests/unit/transparency-bundle.test.ts`, including governance-edit,
digest-forge, signature-bit-flip, and control-map-edit tamper detection.
*Honesty:* the signing key is **ephemeral build-time** —
`signature.keyType` records this in every bundle. The bundle proves
*internal consistency*; it does **not** prove "Even Keel Learning" or
any specific institution signed it. Phase-2 swap is a KMS-backed
institution key or a WebAuthn-passkey-derived signature.

**18. WebAuthn passkey binding for signed receipts — new in v1.4.11.**
The session-key path that has driven receipts since v1.4.6 was honest
but unbound: a per-tab ECDSA keypair, regenerated on every page load,
verifies a receipt has not been tampered with but does not prove
*who* signed it. v1.4.11 adds a real, optional WebAuthn-passkey path
alongside the session key. A learner clicks **Enrol a passkey** on
`/student`, the OS drives the ceremony (Touch ID / Windows Hello /
security key), and the resulting credential's COSE_Key public key is
parsed by a hand-rolled CBOR decoder (`lib/crypto/cbor-min.ts`),
converted to SPKI (`lib/crypto/cose-to-spki.ts`), and persisted to
`localStorage` — the private key never leaves the authenticator. The
Issue card now offers **two buttons** ("Sign with passkey" / "Sign
with session key"); a failed passkey ceremony parks the UI in
`passkey-failed` and forces the user to choose deliberately — **no
silent downgrade**. The verifier page renders a `keyType` badge
("passkey" highlighted, "session key" muted) plus the short
credential id, and swaps the footer copy for an
identity-bound-vs-not-bound description chosen by `envelope.keyType`.
Verification of passkey envelopes runs ECDSA P-256 over
`authenticatorData || SHA-256(clientDataJSON)` against the imported
SPKI, all in-browser, no network.
*Files:* `lib/crypto/cbor-min.ts`, `lib/crypto/cose-to-spki.ts`,
`lib/crypto/passkey.ts`, `lib/crypto/signing.ts` (extended),
`components/shared/PasskeyEnrolCard.tsx`,
`components/shared/IssueReceiptCard.tsx`, `app/receipt/[id]/page.tsx`,
`app/student/page.tsx`. *Tests:* 17 round-trip assertions in
`tests/unit/cbor-cose.test.ts` (real `SubtleCrypto` keypair through
the encoder + decoder + SPKI + signature path) and 15 assertions in
`tests/unit/passkey.test.ts` (feature detection, DER→raw conversion,
enrolment, signing, verification, tamper detection, back-compat).
*Honesty:* a learner can still enrol under any `learnerInitials` —
binding a passkey to a school-roster identity is Phase 2. Server-side
revocation and rotation are also Phase 2. What v1.4.11 closes is the
"session key not bound to identity" entry in `HONESTY.md` §4.4 for
learners who enrol; the session-key path remains available and is
labelled honestly for learners who don't.

**19. Signed content authoring pipeline — new in v1.5.0.**
The single biggest open item from `HONESTY.md` §4.2 — "the subject
picker UI shows 64 tiles but only one of them has real validated
content" — is now closed *in principle* by an end-to-end content
pipeline that does not require a model at learner time. New schema in
`lib/content/schema.ts` (problem, expectedAnswer, three Socratic
hints, plain-English explanation, keyed misconceptions, worked-example
parallels, spec-point alignment to AQA / Edexcel / OCR / DES JC,
difficulty, prerequisites, draft provenance, reviewer approval).
Authoring time: `scripts/author-draft.mjs` invokes a configurable
LLM provider — mock by default, Anthropic / OpenAI when an API key is
present — and writes draft items into `content/drafts/`. Review time:
`/author` is a passphrase-gated reviewer surface that lists drafts,
lets a teacher edit every field, and on "Approve & Sign"
canonicalises the item, signs it with ECDSA-P256, and POSTs to
`/api/author/approve`; the server verifies the signature, adds the
reviewer's public key to `content/trusted-reviewers.json`, promotes
the item into `content/packs-raw/<subject>.<skillFamily>.json`, and
spawns `scripts/build-content-manifest.mjs` to regenerate the signed
manifest at `public/content/manifest.json`. Run time: a browser
registry (`lib/content/registry.ts`) verifies pack hashes and per-item
signatures against the trusted-reviewers list, and `EkeChat.tsx`
surfaces the matching misconception explanation after a categorised
wrong attempt and the post-attempt walkthrough after a correct
attempt — both pre-authored, both signed. 13 new tests
(`content-schema.test.ts` 10, `content-manifest.test.ts` 3).
*Honesty:* (i) reviewer signing is currently the per-tab session key,
not a passkey; the `/author` UI labels approvals "session-demo" until
that wiring lands; (ii) `/api/author/approve` has demo-grade auth
(UI-side passphrase only) and must sit behind a real session bound to
the reviewer's enrolled passkey before classroom rollout; (iii) the
mock LLM provider is the default and produces clearly-labelled
placeholders; (iv) v1.5.0 ships ONE fully-migrated, enriched skill
family (`maths.linear-eq-1var`); the pipeline does not write content,
it distributes it. See HONESTY.md §4.3.

**Verification at the time of writing:**
- `tsc --noEmit` — clean
- `next lint --max-warnings 0` — no warnings or errors
- `vitest run` — **314 tests across 29 files passing** (301 v1.4.11 + 13 new)
- `playwright test tests/e2e/a11y.spec.ts` — **8 surfaces, no serious /
  critical axe violations** (the `color-contrast` rule is currently
  scoped out — see CHANGELOG v1.3.1 "Known follow-up")
- `node scripts/audit.mjs --strict` — passes; manifest + repro +
  transparency + KCSIE evidence-paths gates all green
- `npm run repro:verify` — 0 mismatches across all governed source
  files + governance docs
- `npm run transparency:verify` — governance, controlMap, repro,
  audit, componentDigest, signature all OK
<!-- truth-pack:section-a:end -->

---

<!-- truth-pack:section-b:start -->
## §B — How it works without an LLM (replaces the existing "How the AI works" section)

Every other homework AI in the market right now is having the same
conversation with schools: "we have safety prompts, we have RLHF, we have
content filters." Ours is a categorically different claim:

> **There is no answer-generation code path. The structural property
> "Eke never gives the answer" is provable by `grep`, not by a
> 40-page model card.**

Concretely:

- Eke replies are drawn from a small static template library
  (`lib/eke/tiered-hints.ts`). Three tiers; never more than three.
- A learner's numeric attempt is routed through a deterministic
  category-checker (`lib/validation/answer-checker.ts`). The category
  drives a Socratic redirect that points at the *class of error*, not
  at the answer. A unit test pins the no-leak property by walking
  every category for a sample expected value and asserting the
  expected value never appears in any returned hint.
- Crisis interception runs *before* any reply path
  (`lib/regulatory-absorb/decision-gate.ts`). With an LLM you would
  have to trust the model not to "be helpful" through a self-harm
  message; with a regex pre-filter plus a template responder, the safe
  path is the only path.
- The data bus only carries category metadata (e.g.
  `student.answer.validated → { correct: true, category: "correct" }`),
  never learner text and never the expected value.

**Why this matters commercially.** A wrong-but-confident assessment of a
14-year-old's history essay is the kind of thing that ends a school
pilot in a single parent email. Every LLM EdTech is one bad assessment
away from a procurement freeze. Our v1.4.0 stance — deterministic
validation for the problem types we ship, LLM out of the hot path — is
defensible to a Designated Safeguarding Lead and provable to a Data
Protection Officer.

**Why this matters financially.** No tokens. No model-deprecation
migrations. No "the model rate-limited us during exam season" incident
report. Free tier costs us a CDN egress, not 3 cents per student
turn.
<!-- truth-pack:section-b:end -->

---

<!-- truth-pack:section-c:start -->
## §C — Phase 2 (replaces "Roadmap" / "What's next")

Phase 2 lifts the LLM ban *narrowly and out of the hot path*.

**The two operational deliverables originally listed as Phase-2 gating
items shipped during Week 2.** UK pilots can now start without further
blockers from the engineering side, and commercial diligence has the
artefacts it needs:

- **(a) ✅ DSL escalation webhook + KCSIE 2025 / Prevent-duty control
  mapping.** Shipped in v1.4.8. The 17-pattern crisis lexicon *detects*
  and now *acts*: signed envelopes are enqueued and POSTed to a
  school-configured HTTPS endpoint, the receiver verifies offline using
  the embedded `X-EvenKeel-PublicKey` header, and 13 named controls
  (KCSIE 2025 × 5, Prevent × 3, DfE F&M × 3, GDPR Art. 25 × 1) are
  pinned to verifiable evidence in the codebase. *Phase-2 follow-up:*
  email / SMS / push provider integration to a named DSL (Twilio /
  SendGrid / FCM keys + school billing relationship).
- **(b) ✅ Signed Learning Receipts (v1.4.6) + reproducibility manifest
  (v1.4.7) + transparency-bundle export (v1.4.9) + WebAuthn passkey
  binding for receipts (v1.4.11).** All four shipped during Weeks 1-3.
  A learner can issue a signed receipt for a single problem
  (`/receipt/[id]` verifies offline). A reviewer can verify the whole
  codebase against a single `aggregateSha256` via
  `npm run repro:verify`. A regulator can verify the whole governance
  surface in-browser via the `/compliance` Transparency tab. **Receipts
  signed via the v1.4.11 passkey path bind to the learner's device-bound
  authenticator** (TPM / Secure Enclave / security key) and the verifier
  page renders the key type honestly. *Phase-2 follow-up that remains:*
  institution-issued passkeys (Phase 1 lets a learner enrol under any
  initials), server-side credential revocation / rotation, and a
  KMS-backed signing key for the **transparency bundle** (still ephemeral
  build-time at v1.4.11).

Compliance-template drafting (DPIA / ROPA / DPA) waits for privacy
counsel and the first real pilot agreement; drafting them now against a
prototype that processes no real learner data would produce documents
that are simultaneously not-quite-right and over-claimed.

**Phase 2A — Comprehension-gate question authoring.**
An LLM authors gate questions overnight in batch; a teacher reviews them
in the morning; the student only ever sees vetted questions. The model
never speaks to a child. The model output is reviewed before it leaves
the staging table. Investors and design partners see one real LLM
integration; the structural-safety pitch stays intact because the model
is provably outside the learner-facing path.

**Phase 2B — Multi-LLM routing for non-conversational tasks.** Numerical
verification (a model with code execution), free-tier hint expansion
(open-source self-hosted, cheap), translation review for non-English
locales, content-velocity for trades curricula. Each of these is a
*tool*, not a *teacher*.

**Phase 2C — Learner-facing LLM. This is the moment the moat shifts
shape, and it ships only on conditions.** Phase 2C is the one place in
the roadmap where the structural-safety guarantee weakens: "there is no
answer-generation code path" becomes "there is a code path, and we
intercept its output before the learner sees it." That is a real trade,
not a marketing footnote, and we do not make it lightly.

Phase 2C does **not** ship until all of the following are true:

- A **per-turn output validator** wraps every model reply, enforcing the
  no-direct-answers property the same way `lib/validation/answer-checker.ts`
  enforces it today — by category-checking against the known answer and
  rejecting any reply that would leak it. Drop-in fallback to the
  template path on rejection.
- A **brute-force adversarial test suite** lives in CI and exercises the
  validator against jailbreak prompts the same way `decision-gate.test.ts`
  exercises the crisis lexicon against obfuscated phrasings. The Phase 2C
  release blocks on this suite being green; "hope" is not a control.
- The **Decision Gate runs on model output** as well as model input, so
  a model that hallucinates self-harm content cannot reach a child even
  if the validator passes it.
- Every model call is **auditable on the bus** with the same
  category-only payload contract as v1.4.0 (no learner text, no model
  text — only event metadata).
- A **kill-switch env flag** (`EVENKEEL_LLM_HOT_PATH=off`) reverts every
  surface to the deterministic template path with no code change. Tested
  weekly in CI as part of the release pipeline.

Until that suite exists, Phase 2C is documentation, not a release plan.
Deferred until at least seed close.

**Phase 2D — Operational hardening.** WebAuthn passkeys (replaces the
demo role guard *and* binds the receipts / transparency-bundle signing
keys to a persistent identity), COPPA §312.5 verifiable parental consent
(replaces self-declared age band), webhook retry-on-schedule for the
v1.4.8 escalation queue (Compliance Officer currently re-attempts
manually), WORM retention semantics on the queue (currently bounded at
200 entries with oldest-first eviction), email / SMS / push provider
adapters for DSL notification fan-out, KMS-backed institution key for
the transparency bundle (replaces the ephemeral build-time key),
multi-turn crisis analysis and locale-variant crisis lexicons, cross-
device sync, full design-system color-contrast pass to re-enable the
axe `color-contrast` rule in CI.

**Permanently out of scope — not a Phase 3, not a stretch goal, not a
footnote.** The items below will be pitched to us by investors, by
hires, and by other founders as "the obvious next feature." The answer
is the same every time. Listing them here makes the refusal legible to
design partners and regulators, and makes the discipline auditable.

- **LLM-authored fresh problems calibrated to the learner.** The
  provenance-and-correctness problem is unsolvable at population scale
  without either a teacher review loop on every generated problem
  (doesn't scale) or trusting the model's own correctness claim
  (collapses the structural-safety guarantee). A curated corpus plus a
  deterministic parameterised-variant generator (same structure,
  different numbers) delivers ~95% of the perceived benefit with none
  of the risk. If shipped, occasional subtly-wrong problems marking
  correct answers wrong ends a pilot in a single parent email.
- **LLM grading of free-form essays.** EU AI Act Annex III high-risk
  in education — triggers conformity assessment, fundamental-rights
  impact assessment, and EU database registration. Invalidates the
  "no LLM in the learner-facing path" pitch entirely.
- **Predictive academic-risk scoring on individual learners.**
  Annex III high-risk + GDPR Art. 22 (automated decisions about
  minors) + Equality Act discrimination exposure.
- **Sentiment or emotion recognition from chat, voice, or camera.**
  EU AI Act Art. 5(1)(f) — outright prohibited in educational
  settings.
- **Live LLM in conversation with a child.** The exact property the
  structural-safety pitch sells against. Phase 2C ships only under
  the five preconditions stated above; anything looser is a different
  product.
- **Voice biometrics for fluency or identity.** GDPR Art. 9
  special-category data — opens a regulatory front we do not need.
- **Gamification dark patterns.** Streaks, XP, variable-reward loops,
  leaderboards, AI-generated praise. Evidence of harm is
  well-documented, and these actively damage the learners we most
  want to serve (anxious, SEN, previously-shamed). Saying publicly
  that we deliberately do not ship any of them is itself a
  differentiator no competitor can credibly copy.

Every item here looks like an obvious win in a Twitter thread and ends
a school pilot in a single parent email. The discipline of refusing
them is what makes every other commitment in this proposal credible.
<!-- truth-pack:section-c:end -->

---

<!-- truth-pack:section-d:start -->
## §D — The hour-inside-Luminary task (replaces the existing version)

Open the prototype. You can:

- Use the homework AI on `/student`. The default problem is
  `2x + 5 = 17`, with the expected answer pinned in code (see
  `app/student/page.tsx`, `problemAnswer={6}`). Try `x = 6` (correct),
  `x = 7` (off-by-one), `x = -6` (sign error), `x = 12` (doubled),
  `x = 3` (halved), `x = 42` (plainly wrong) — each produces a
  different categorised Socratic redirect, and none of them reveals
  the answer. This is the v1.4.0 deterministic checker doing real
  work.
- Watch the right rail of `/student` populate. *My Patterns* (v1.4.2)
  fills with category-only error counts as you make non-correct
  attempts. *Coming back today* (v1.4.4) shows the Leitner due queue
  for problems you've previously attempted. *Practice mode* (v1.4.3) is
  togglable — flip it on, finish a few attempts, flip it off, and watch
  the Teacher Integrity Ledger show only the bracket without per-attempt
  detail. *Issue receipt* (v1.4.6) signs a session snapshot and produces
  a `/receipt/[id]` URL that opens, verifies offline, and downloads.
- Push to tier 4. After three rejected hint tiers on the default
  problem, the engine serves a fully-worked **parallel** — a different
  linear equation walked end-to-end (v1.4.5). The leak guard would skip
  any parallel whose worked solution echoed the original's answer.
- Note that on `/trades` and `/adult` the chat is configured for
  open-ended, non-numeric problems and the answer-checker is
  deliberately off (no `problemAnswer` prop). The Socratic templates
  carry the conversation; numeric validation only activates where it
  would be meaningful.
- Try to break safety on `/student`. Type a crisis phrase (any of the
  17 patterns in the lexicon). Eke blocks immediately and surfaces the
  regional helpline, and a category-only signed envelope is enqueued
  in the v1.4.8 DSL escalation queue. Try the documented false-positives
  ("the theme of suicide in Shakespeare", a kitchen-knife emoji in a
  recipe) — they pass through. Open `/compliance` → "Safeguarding" tab
  to see the queue, configure a webhook URL (try `https://localhost:9999`
  for a no-op test), fire a synthetic test escalation, and verify any
  stored signature on-page.
- Try to paste your way out of the work. Paste is blocked, the trust
  meter drops, the Teacher Integrity Ledger shows the attempt in real
  time on `/teacher`.
- Open `/teacher` in a second tab. Watch the Integrity Ledger tail in
  real time. You will see GATE_CLEARED, HINT, ANSWER, PASTE, and
  SUBMIT events as you use the student tab. None of those payloads
  contain learner free-form text.
- Open `/compliance`. Run a Most-Restrictive resolution against the
  seed conflict data; sign it; click verify on the signed conflict.
  The ECDSA verify happens locally in the browser. Open the
  "Transparency" tab (v1.4.9) to download the signed transparency
  bundle and verify its signature in the browser via `SubtleCrypto`
  with no network round-trip — the artefact a school's procurement
  officer can hand to a regulator.
- Open `/parent`. The feed backfills from the bus history so you see
  the events you just generated.
- Toggle the accessibility settings — dyslexia-friendly typeface,
  literal tone (Eke's greeting and hint prefix change immediately on
  the next chat mount), wider spacing, focus mode.

This is what an hour gets you, accurately stated. There is no fake AI.
The platform that opens is the platform that ships.
<!-- truth-pack:section-d:end -->

---

*Last updated: v1.4.9 — 2026-04-27.* When the repo state changes, update
this file in the same commit and regenerate the .docx from it. Tone,
framing, and rewriter instructions live in
`@./PROPOSAL_REWRITER_NOTES.md`. The audit's marker-integrity check
(`scripts/audit.mjs` → `node scripts/extract-truth-pack-section.mjs
--check`) ensures the four section markers (`a`, `b`, `c`, `d`) stay
balanced; CI fails on drift.
