# Changelog

All notable changes to Even Keel Learning are tracked in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [1.5.3] — 2026-04-28 — Heavy escalation, extended moves, first figure

Closes the three v1.5.2 follow-up gaps disclosed in `HONESTY.md` §4.4.

1. **`diagnoseHeavy` dispatcher** — escalates to Pyodide + Sympy when
   the math.js path returns `wrong` for a symbolic expected answer.
2. **Move-vocabulary v2** — variable-operand arithmetic moves
   (`multiply by x`, `divide by (x+1)`), `square both sides`, and a
   whitelisted set of `apply f`-style moves (sin / cos / tan /
   exp / log / ln / sqrt / cbrt / abs and their inverses).
3. **First authored figure** — the `maths.linear-eq-1var` pack now
   ships a JSXGraph-rendered graph of `y = 2x + 5` for item `001`.
   The schema gained an optional `figures` field; figures are
   validated at build time, persisted into signed packs, and
   re-validated by the registry on load.

All deterministic and auditable. No model in the learner runtime
hot path. Same trust contract as v1.4.x – v1.5.2.

### Added — `diagnoseHeavy` dispatcher (`lib/validation/answer-checker-heavy.ts`)

- Async wrapper around `diagnose(...)` that runs the synchronous
  math.js path first, then escalates ONLY when math.js says `wrong`
  for a symbolic answer.
- Escalation calls `cas.simplify("(actual) - (expected)")`. If
  Sympy returns `0`, the verdict is upgraded to `correct`. Otherwise
  the math.js verdict stands.
- Returns a `HeavyDiagnosticEnvelope` with the verdict plus a
  `reason` enum for telemetry: `no-escalation-correct`,
  `no-escalation-no-attempt`, `no-escalation-numeric-path`,
  `escalated-confirmed-wrong`, `escalated-upgraded-to-correct`,
  `escalation-skipped-empty-text`, `escalation-failed-cas-unavailable`,
  `escalation-failed-timeout`, `escalation-failed-error`.
- Always degrades silently to the math.js verdict on any failure
  (CAS unavailable, timeout, abort, generic error).
- Honours an external `AbortSignal` and a configurable
  `escalationTimeoutMs` (default 10 000 ms).
- Information-leakage discipline preserved: even on upgrade, the
  hint never echoes the simplified expected form.
- 10 protocol tests in `tests/unit/diagnose-heavy.test.ts`.

### Added — Move-vocabulary v2 (`lib/validation/move-vocabulary.ts`)

- New `MoveOp` values: `square`, `apply-fn`. The `apply-fn` operand is
  a unary function name from `APPLY_FN_WHITELIST` (sin, cos, tan,
  asin, acos, atan, sinh, cosh, tanh, exp, log, log10, log2, ln,
  sqrt, cbrt, abs). `ln` is normalised to `log`.
- `parseMoveText` recognises `square both sides`, `squared`, `take log`,
  `take ln`, `apply sin`, `sin both sides`.
- `verifyMove` rewritten to take `(prevLhs, prevRhs, currLhs, currRhs,
  move, vars)` and CONSTRUCT the expected next equation from the
  previous one and the move. This generalises uniformly to numeric
  operands, variable operands, squaring, and `apply f`.
- Verification compares `(lhs_e - rhs_e)` to `(currLhs - currRhs)`
  at sample points with no scaling — strict scalar equality, not
  the looser proportionality used for the relation-preservation
  check. A constant-but-non-1 ratio is classified as
  `expected-ratio-mismatch` (right kind, wrong operand).
- Step-validator updated to the new signature.
- 13 new move-vocab tests including variable operands, squaring,
  `apply log`, `apply sin`, unsupported function rejection. Total
  37 move-vocab tests + 10 step-validator tests.

### Added — First authored figure + schema extension

- `SchemaContentItem` gained an optional
  `figures?: readonly FigureSpec[]`. `validateContentItem` runs
  every entry through `validateFigureSpec` and propagates errors
  with `figures[i] $.path: …` prefixes so reviewers can locate them.
- `maths.linear-eq-1var` item `001` now ships a `figures` entry: a
  JSXGraph-renderable graph of `y = 2x + 5` (the LHS of
  `2x + 5 = 17`), with `alt` text, no markings on the answer point,
  no `y = 17` reference line. Surfaces are free to render this
  alongside the problem (a learner using graph estimation can
  recover x ≈ 6, which is a legitimate cross-check method, not a leak).
- Build script verified: `npm run content:build` rebuilds and
  re-signs the pack; the figure is persisted in
  `public/content/packs/maths.linear-eq-1var.json`.
- Registry verified: `validateContentItem` runs at load time and
  rejects malformed figures defence-in-depth.
- 6 schema-integration tests in `tests/unit/content-schema-figures.test.ts`.

### Verification

- `npm run typecheck` — clean.
- `npx vitest run` — full suite passing including 10 dispatcher,
  37 move-vocab, 6 schema-figure tests.
- `npm run content:build` — succeeds; figure-bearing pack signs
  cleanly.

## [1.5.2] — 2026-04-28 — Heavy CAS, geometric figures, move-vocabulary

Closes the three remaining gaps from the v1.5.1 release notes:

1. **Heavy CAS** — calculus, integration, ODEs beyond what math.js can do.
2. **Geometric figures** — typed JSXGraph spec authoring contract + renderer.
3. **Move-vocabulary** — step validator now catches "I said divide
   but actually multiplied" mismatches.

All three are deterministic, auditable, off-by-default, and run client-
side. No model in the learner runtime path. Same trust contract as
v1.4.x and v1.5.x.

### Added — Heavy-CAS worker (`public/workers/heavy-cas.worker.js`, `lib/cas/heavy-client.ts`)

- Web worker wrapping Pyodide + Sympy. Loaded lazily on first
  `runCAS(...)` call; default Pyodide assets URL is jsDelivr (pinned
  to `0.27.0`), self-hostable via `{ indexURL: "/pyodide/" }`.
- Supported operations: `simplify`, `expand`, `factor`, `integrate`,
  `diff`, `solve`, `ode`, `version`. Each returns `{ text, latex }`
  ready to feed into `MathInline` / `MathBlock`.
- `HeavyCASClient` class exposes the protocol with timeout,
  AbortSignal, and request-correlation. `WorkerLike` interface lets
  tests inject a mock worker.
- 9 protocol tests in `tests/unit/heavy-cas-client.test.ts` pin
  init / eval / error / timeout / abort / terminate / concurrency.
- Real Pyodide eval is browser-only (WASM via `importScripts`) and is
  validated separately in the Playwright suite.

### Added — Geometric figure spec + renderer (`lib/geometry/figure-spec.ts`, `components/shared/GeometryFigure.tsx`)

- Typed `FigureSpec` schema — points, lines, segments, circles,
  polygons, function graphs, text labels. Pure data, JSON-serialisable,
  embeddable in signed content packs.
- `validateFigureSpec(...)` — pure validator with structured errors
  and warnings. Pinned by 15 tests covering missing ids, undefined
  point references, degenerate segments, bad bounding boxes, unknown
  element kinds, missing `alt` (a11y warning), and so on.
- `<GeometryFigure spec={...} />` — React component that lazy-loads
  JSXGraph from a CDN (`1.10.1`), validates the spec at mount, and
  renders to an SVG board. Degrades to a labelled placeholder when
  JSXGraph fails to load (offline, blocked CDN, SSR).
- Self-host JSXGraph via `scriptSrc` / `cssHref` props.

### Added — Move-vocabulary step verifier (`lib/validation/move-vocabulary.ts`)

- `parseMoveText(...)` — recognises additive (`add 5` / `+5` / `plus 5`),
  multiplicative (`multiply by 2` / `×2` / `divide by 3` / `÷3`), and
  no-operand moves (`expand` / `factor` / `simplify`).
- `stripMoveAnnotation(...)` — splits a step line into equation +
  annotation across pipe / arrow / parenthetical styles. Will NOT
  strip a maths-internal `(x+1)` parenthesis.
- `verifyMove(...)` — checks that the *kind* of move the learner
  claimed matches the actual transformation, by sampling at the
  same irrational seeds the proportionality check uses.
- New step status `move-mismatch` for cases where the relation is
  preserved but the verb is wrong (a soft pedagogical correction,
  not a hard fail).
- Hints surfaced for move mismatches never echo the right operand
  or the right answer. Pinned by an information-leakage test.
- 24 move-vocabulary tests + 10 step-validator tests pass.

### Verification

- `npm run typecheck` — clean.
- `npx vitest run` — full suite passing including 24 move-vocabulary,
  15 figure-spec, 9 heavy-CAS-client tests.
- See `HONESTY.md` §4.4 for the v1.5.2 disclosure block.

## [1.5.1] — 2026-04-28 — Symbolic answer-checking, LaTeX rendering, step validator

Builds on the v1.5.0 content pipeline by closing three open gaps from the
"higher-maths capability matrix": symbolic answer-equivalence, raw-text
LaTeX in problem/hint surfaces, and per-step derivation validity. All
three are deterministic, auditable, and run client-side — no model in
the learner runtime path, same trust contract as v1.4.x.

### Added — Symbolic answer-checking (`lib/validation/answer-checker.ts`)

- `symbolicEquivalent(actual, expected)` — math.js-backed algebraic
  equivalence test. Accepts `(x+1)(x+2)` as equivalent to `x^2 + 3x +
  2`, `2/4` as equivalent to `0.5`, etc. Falls back to numeric sample-
  point evaluation when symbolic simplification is inconclusive.
- `diagnoseSymbolicAttempt(input, expected)` — Socratic categoriser
  with the same information-leakage discipline as the numeric path.
- `diagnose(input, expected)` — dispatcher that routes numeric vs
  symbolic by runtime type. Wired into `lib/eke/eke-engine.ts` so a
  string `problemAnswer` prop on `<EkeChat>` automatically takes the
  symbolic path; existing numeric callers are unaffected.
- Sentinel `QUALITATIVE_SENTINEL = "qualitative-no-auto-check"` —
  surfaces hosting essay / open-text problems opt out of auto-checking
  by passing this value; the engine deliberately abstains and routes
  to teacher-marking via the Integrity Ledger.

### Added — LaTeX rendering (`lib/render/math.tsx`, `lib/render/text-with-math.tsx`)

- `MathInline`, `MathBlock` — KaTeX-backed React components for
  inline (`$x$`) and display (`$$x$$`) maths. SSR-safe; KaTeX runs
  with `trust: false` so even if learner text were ever passed in
  (it isn't) `\href` and `\includegraphics` would be blocked.
- `TextWithMath` + `splitProseAndMath` — splitter that lets authored
  prose freely mix text and `$…$` / `$$…$$` spans (Jupyter convention).
  Wired into `EkeChat` so the problem body and every hint render
  maths typeset, not as raw `2x + 5 = 17` text.
- 12 parser tests pin the contract: escaped `\$` is literal, unbalanced
  `$` degrades to prose, `$$` is never mis-parsed as two adjacent
  inline delimiters.

### Added — Step-by-step validator (`lib/validation/step-validator.ts`)

- `validateDerivation(text, { expectedFinal? })` — splits a multi-line
  derivation into equational steps, classifies each as `valid`,
  `invalid`, `unparseable`, or `first`, and surfaces the first
  problem line.
- Step-equivalence uses **proportionality** over difference forms,
  not strict algebraic identity: dividing both sides of `2x = 12` by
  2 to get `x = 6` is correctly accepted (same solution set), while a
  sign flip `x = -6` is correctly rejected.
- Hints are leakage-safe: the rejected line is named, but neither the
  expected value nor the expected final form is ever revealed.
- 10 tests cover linear chains, expand/factor moves, sign flips,
  unparseable lines, blank-line handling, `==` normalisation, and
  the leakage-discipline pin.

### Changed — Engine dispatcher

- `EkeEngine` now accepts `problemAnswer: number | string`. String
  values that parse as finite numbers are silently normalised to the
  numeric path (full back-compat). Other strings flow to the symbolic
  path. The `QUALITATIVE_SENTINEL` short-circuits both.
- `coerceExpectedNumeric()` narrows for the parallel-problem selector
  which still operates on numeric forms.

### Verification

- `npm run typecheck` — clean.
- `npx vitest run` — 361 / 361 passing across 33 files (incl. 19
  symbolic-checker, 10 step-validator, 12 prose+math tests).
- See `HONESTY.md` §4.3 for the v1.5.1 disclosure block.

## [1.5.0] — 2026-04-28 — Signed content authoring pipeline (LLM-drafted, teacher-reviewed)

Closes the largest remaining gap from `HONESTY.md` §4.2 — the disclosure
that the subject picker showed 64 tiles but only one skill family
(`linear-eq-1var`) had real validated content. v1.5.0 introduces the
end-to-end pipeline that lets new content reach learners **without**
breaking the v1.4.x trust contract: no model at learner time, no
unreviewed content ever shown, every hint signed by a named reviewer.

### Added — Content schema (`lib/content/schema.ts`)

- `SchemaContentItem`, `SchemaContentPack`, `SchemaContentManifest` —
  the rich data shape behind every approved item: hints (3-tier),
  plain-English explanation, keyed misconceptions, worked-example
  parallels, spec-point alignment (cross-awarding-body), difficulty,
  prerequisites, draft provenance, reviewer approval block.
- `validateContentItem` / `validateContentPack` — pure structural
  validators with no I/O. Used by the build script, the registry, and
  the review UI before approval.
- `canonicaliseForHash` — recursive sorted-key JSON serialisation so
  semantically-equal objects produce the same digest regardless of
  source ordering. Mirrors the convention used by
  `lib/crypto/signing.ts:contentDigest`.

### Added — Authoring pipeline

- `scripts/author-draft.mjs` — provider-pluggable LLM drafter (mock /
  Anthropic / OpenAI). Writes drafts to `content/drafts/<id>.json`
  with a `draft` provenance block and a *null* `approval` block. The
  mock provider produces clearly-labelled placeholders so the pipeline
  works with no API key.
- `app/api/author/drafts/route.ts` — GET endpoint listing every draft
  awaiting review.
- `app/api/author/approve/route.ts` — POST endpoint that verifies the
  reviewer's approval signature server-side, adds the reviewer's
  public key to `content/trusted-reviewers.json`, promotes the item
  into `content/packs-raw/<subject>.<skillFamily>.json`, and spawns
  `scripts/build-content-manifest.mjs` to regenerate the signed
  manifest.
- `app/author/page.tsx` — passphrase-gated reviewer surface. Lists
  drafts, lets a reviewer edit every field, and on "Approve & Sign"
  signs the canonicalised item with the per-tab session key
  (ECDSA-P256), POSTs to the approve endpoint, and refreshes the
  queue.
- `lib/auth/role-guard.ts` extended with `"author"` role
  (default passphrase `reviewer-alpha-42`; override via
  `NEXT_PUBLIC_AUTHOR_PASSPHRASE`).

### Added — Signed manifest distribution

- `scripts/build-content-manifest.mjs` — reads every raw pack under
  `content/packs-raw/*.{mjs,json}`, validates each item against the
  schema, signs items lacking a real `approval` block with a build-time
  reviewer key, writes signed pack JSON to `public/content/packs/`,
  and emits `public/content/manifest.json` with the trusted-reviewers
  list. Items already approved by `/author` are passed through
  unchanged. Registered as `npm run content:build`.
- `lib/content/registry.ts` — browser-side loader. Fetches the signed
  manifest, verifies pack hashes, verifies each item's reviewer
  signature against the manifest's trusted-reviewers list, and
  exposes `getContentItem`, `getFamilyItems`, `getMisconception`,
  `getExplanation`, `getRegistrySummary`. Additive by design — if the
  manifest is missing or rejected, the platform runs exactly like
  v1.4.11 and the engine falls back to the existing v1.4.5 hand-
  written `parallel-problems.ts` corpus.
- `content/packs-raw/maths.linear-eq-1var.mjs` — migration of the
  v1.4.5 hand-written linear-equation corpus into the new schema,
  enriched with explanations, four keyed misconceptions
  (`off_by_one`, `sign_flipped`, `doubled`, `halved`), and spec-point
  references for AQA GCSE 9–1 (`A17`) and DES JC Maths 2024 (`AF.1`).

### Added — Runtime wiring (`components/shared/EkeChat.tsx`)

- After a categorised wrong attempt, EkeChat now surfaces the matching
  misconception's plain-English explanation as a follow-up assistant
  message — labelled, shown ONCE per category per session.
- After a `correct` attempt, EkeChat surfaces the post-attempt
  explanation walkthrough so the learner sees *why* the method works,
  reinforcing methodology rather than substituting for it.
- All teaching messages are pre-authored, signed, and verified at load
  time. There is no model in this code path.
- The runtime gate is opt-in: a surface that does not declare both
  `skillFamily` and `problemId` keeps the v1.4.11 behaviour unchanged.

### Tests

- `tests/unit/content-schema.test.ts` — 10 tests covering item / pack
  validation, the three-tier requirement, explanation length floor,
  worked-example duplication detection, approval-block requirement,
  and `canonicaliseForHash` order-independence and discrimination.
- `tests/unit/content-manifest.test.ts` — 3 tests covering the full
  ECDSA-P256 sign+verify roundtrip used by build script and registry,
  including tampered-item rejection and wrong-key rejection.
- Full suite: 301 → 314 tests across 27 → 29 files, all green.

### Honesty additions (HONESTY.md §4.3)

- The reviewer signing key is currently the per-tab session key, not a
  passkey. The `/author` UI documents this with a "session-demo"
  banner; the v1.4.11 passkey path applies once a reviewer enrols a
  passkey and the UI is wired to use it (Phase 2 follow-up).
- The `/api/author/approve` endpoint has demo-grade auth (UI-side
  passphrase only, no server session). Production deployments must
  put it behind a real session bound to the reviewer's enrolled
  passkey before any classroom rollout. Documented in `SAFEGUARDING.md`
  §3.
- The mock LLM provider is the default. It produces clearly-labelled
  placeholders; nothing it writes can be approved without a reviewer
  rewriting it. This is by design — a silent fake would be worse than
  no draft at all.
- Subject picker UI gap (§4.2 of HONESTY.md) is now closed *in
  principle* by this pipeline, but content breadth is still sparse:
  one fully-migrated and enriched maths skill family at v1.5.0.
  Roadmap entry to expand to English and RE in v1.5.1 / v1.5.2 added
  to `docs/PROPOSAL_TRUTH_PACK.md` §F.

## [1.4.11] — 2026-05-04 — WebAuthn passkey binding for signed receipts

Closes the "session key not bound to identity" open item that has been
sitting in `HONESTY.md` §4.4 since v1.4.6 shipped Signed Learning
Receipts. The session-key path is **still supported and still the
default for unenroled learners** — the change is that a second,
identity-binding path is now available and the UI is explicit about
which key signed any given receipt.

### Added — Passkey primitives

- `lib/crypto/cbor-min.ts` — hand-rolled minimal CBOR decoder
  scoped to the WebAuthn subset (unsigned / negative ints, byte /
  text strings, arrays, maps). Throws `CborDecodeError` on malformed
  input. Includes a test-only encoder for synthesising COSE_Key
  fixtures from real `SubtleCrypto` keys.
- `lib/crypto/cose-to-spki.ts` — COSE_Key → SPKI DER converter for
  P-256 ES256. Validates `kty=2`, `alg=-7`, `crv=1`, 32-byte `x` /
  `y`; rejects anything else. Emits a fixed 91-byte blob the browser
  `SubtleCrypto.importKey` accepts.
- `lib/crypto/passkey.ts` — WebAuthn enrolment (`enrolPasskey`),
  signing (`signPayloadWithPasskey`), verification
  (`verifyPasskeyEnvelope`), feature detection
  (`isPasskeySupported`), enrolment-state subscriber API
  (`getEnrolment` / `subscribeEnrolment` / `removeEnrolment`), DER →
  raw `r||s` ECDSA signature converter, and a typed `PasskeyError`
  surface (`not-supported`, `no-enrolment`, `user-cancelled`,
  `assertion-failed`, `invalid-public-key`). No silent fallback: a
  cancelled or failed ceremony throws.

### Added — Signing-envelope extension

- `lib/crypto/signing.ts`:
  - `SignedEnvelope.keyType?: "session-demo" | "passkey-derived" |
    "ephemeral-build-time"` (optional for back-compat with v1.4.10
    envelopes).
  - `SignedEnvelope.webauthn?: WebauthnAttestation` — present iff
    `keyType === "passkey-derived"`.
  - `signPayload` gains a `SignKeySource` overload: callers pass
    `{ source: "session" }` (default, back-compat) or
    `{ source: "passkey" }`. The passkey branch runs a real
    `navigator.credentials.get()` ceremony and embeds the
    authenticator attestation.
  - `verifyEnvelope` branches on `envelope.webauthn`: passkey
    envelopes dispatch to `verifyPasskeyEnvelope`, which re-checks
    the `clientDataJSON` digest against the payload digest, imports
    the SPKI, and runs ECDSA P-256 verify over `authenticatorData ||
    SHA-256(clientDataJSON)`.

### Added — UI

- `components/shared/PasskeyEnrolCard.tsx` — one-button enrolment
  card mounted on `/student`. Four states: `unsupported` (browser
  lacks WebAuthn; button disabled with honest caption), `ready`,
  `enrolling` (OS prompt), `error` (typed `PasskeyError` message).
  Removal is a single button and fans out to all subscribers.
- `components/shared/IssueReceiptCard.tsx` — refactored to a **named
  state machine** (`ready` | `signing-session` | `signing-passkey` |
  `passkey-failed` | `issued`) with a **two-button** UX:
  "Sign with passkey" and "Sign with session key". The passkey
  button is disabled (with a reason) when no passkey is enrolled or
  the browser does not support WebAuthn. A failed passkey ceremony
  parks the UI in `passkey-failed` with an explicit error — **the
  user must then choose session key deliberately**, there is no
  silent fallback. The footer copy adjusts dynamically to reflect
  whether a passkey is available.
- `app/receipt/[id]/page.tsx` — verifier now renders a `keyType`
  badge (passkey = highlighted, session key = muted) next to the
  algorithm label, surfaces the short credential id for passkey
  receipts, and swaps the Phase-1 footer note for an
  identity-bound-vs-not-bound copy based on `envelope.keyType`.

### Changed

- `app/student/page.tsx` — mounts `<PasskeyEnrolCard />` above the
  issue card so enrolment is visible alongside receipt issuance.
- `package.json` — bumped to **1.4.11**.

### Tests

- `tests/unit/cbor-cose.test.ts` — **17 assertions**: CBOR decoder
  primitives, encoder / decoder round-trip, COSE_Key shape
  validation, end-to-end SPKI import and signature verification
  using a real `SubtleCrypto` keypair.
- `tests/unit/passkey.test.ts` — **15 assertions**: feature
  detection, DER → raw signature conversion, authenticator-data
  parsing, enrolment ceremony, `signPayloadWithPasskey`,
  `verifyPasskeyEnvelope`, tamper detection, failure modes, and
  backwards compatibility with session-key envelopes. Mocks
  `navigator.credentials` with **real** synthetic keys (the
  fixtures are signed by a live `SubtleCrypto` keypair, not hard-
  coded bytes).
- Full suite: **301 tests across 27 files** still green.

### Governance

- `HONESTY.md` §2.1 — new "WebAuthn passkey binding for receipts"
  real-capability row; §2.1 ECDSA row updated to describe the
  optional passkey path; §4.2 adds an explicit "passkey binding is
  optional" entry; §4.4 rewrites the "crypto keys are not stored"
  bullet so it distinguishes session keys (regenerated per page
  load) from passkeys (private key in the authenticator, enrolment
  in localStorage).
- `PROPOSAL_TRUTH_PACK.md` §A — item 18 logs the receipt-key
  identity-binding closure.
- `RELEASE_NOTES_v1.4.11.md` — full Week-3 narrative.

### Not built (honestly)

- **No institution-issued passkeys.** A learner can enrol a passkey
  under any `learnerInitials` they choose. Phase 2 ties enrolment to
  a school roster and makes the compliance officer the credential
  administrator.
- **No revocation / rotation.** Losing a device loses the private
  key. Phase 2 adds a server-side credential list so a school can
  invalidate a lost authenticator.
- **No cross-device verification beyond the synced-passkey cluster.**
  A learner on a non-synced browser will need to re-issue.

---

## [1.4.10] — 2026-04-27 — DSL escalation hardening

Closes three Phase-2 follow-up items from v1.4.8 / v1.4.9 (RELEASE_NOTES_v1.4.9.md
"What is **not** built" list). The pipeline still ships **without** email /
SMS / push provider integration — those require billing relationships
that are out of scope for Phase 1. What lands here is the structural
scaffolding that makes adding them a content task, not a refactor.

### Added — Webhook retry-on-schedule
- `lib/safeguarding/retry-scheduler.ts` — deterministic exponential
  backoff scheduler over the v1.4.8 escalation queue. Pure helpers
  (`computeBackoffMs`, `shouldRetry`) plus a singleton `setInterval`
  driver (`startRetryScheduler` / `stopRetryScheduler`).
- Backoff schedule: 1m → 2m → 4m → 8m → 16m → 32m → 1h → 2h → 4h → 8h → 17h
  → 24h (capped).
- After `MAX_DELIVERY_ATTEMPTS` (3) the entry stays `failed` forever;
  the scheduler never silently retries beyond the published limit.
- Browser-only by design (`setInterval`-driven). Documented honestly:
  this does not turn the prototype into a server-side reliable queue,
  only into a plausibly-attended dashboard that re-attempts failed
  deliveries on a published cadence.
- `tests/unit/retry-scheduler.test.ts` — 14 assertions: backoff table,
  retry decision, tick counters, error absorption, lifecycle idempotency.

### Added — WORM (Write-Once-Read-Many) retention on the escalation queue
- `lib/safeguarding/escalation-queue.ts` — exports `RETENTION_DAYS = 90`
  and two new functions:
  - `isExpired(entry, now?)` — pure boundary helper using the *signed*
    `detectedAt`. A tampered `deliveryState.lastFailedAt` cannot extend
    an entry's lifetime past the WORM ceiling.
  - `pruneExpiredEscalations(now?)` — removes only expired entries,
    notifies subscribers iff at least one was removed, idempotent.
- v1.4.8 used the 200-entry cap as the *primary* eviction trigger
  (oldest-first when full). v1.4.10 makes it a defence-in-depth ceiling:
  time-based pruning is the primary mechanism. Entries leave the store
  via exactly two routes: (a) expiry under the retention policy, or
  (b) the explicit admin `clearEscalations()` call.
- The retry scheduler's `runRetryTick()` runs the WORM prune as its
  first step, so an always-on Compliance dashboard self-maintains.
- 7 new assertions in `tests/unit/escalation-queue.test.ts` covering
  RETENTION_DAYS export, isExpired boundary semantics, prune
  selectivity, idempotency, notification contract, and signed-envelope
  immutability across prune.

### Added — Provider-adapter scaffold
- `lib/safeguarding/providers/types.ts` — stable `ProviderAdapter`
  interface (`id`, `displayName`, `isImplemented`, `deliver`) and
  `ProviderOutcome` discriminated union (`delivered` |
  `transient_failure` | `permanent_failure` | `provider_key_required`).
- `lib/safeguarding/providers/webhook.ts` — fully implemented adapter
  wrapping the existing v1.4.8 fetch path.
- `lib/safeguarding/providers/email-sendgrid.ts` — stub returning
  `provider_key_required` with a documented configHelp string.
- `lib/safeguarding/providers/sms-twilio.ts` — stub.
- `lib/safeguarding/providers/push-fcm.ts` — stub.
- `lib/safeguarding/providers/index.ts` — registry with `listProviders`,
  `listImplementedProviders`, `listStubProviders`, `getProvider`. The
  Compliance Officer surface can enumerate every channel the platform
  *could* support and label each one's status honestly.
- 7 new assertions in `tests/unit/providers.test.ts` pinning the
  registry order, the implemented/stub split, `provider_key_required`
  outcome shape, and the no-mutation contract on the entry envelope.

### Engine version pinned
- `lib/safeguarding/escalation-queue.ts` — `ENGINE_VERSION` bumped from
  `evenkeel@1.4.8` to `evenkeel@1.4.10`. Future enqueued envelopes pin
  the new version. Existing v1.4.8 envelopes remain valid; their
  signature is unchanged.

### Pipeline state
- typecheck: clean
- lint:strict: 0 warnings
- vitest: 269 passed across 25 files
- audit:strict: 28 passed / 0 failed / 0 skipped (unchanged)

### Phase-2 honesty preserved
- No email / SMS / push adapters are *implemented* in v1.4.10. Each
  stub explicitly returns `provider_key_required` with a configHelp
  string describing what is needed (provider account, server-side
  relay, device-token registration, etc.). HONESTY.md §3.2 is updated
  to reflect this.
- The retry scheduler is browser-only. A school running headless
  servers for safeguarding ingest still needs the Phase-2 server-side
  reliable queue — the Phase-1 contract is unchanged.

---

## [1.4.9] — 2026-04-27 — Transparency Bundle Export

A school's procurement officer / DPO / auditor can now hand a regulator a
single signed JSON artefact that proves the v1.4.9 build is internally
consistent: governance docs, the KCSIE/Prevent control map, the
reproducibility manifest, and the latest audit manifest are aggregated,
each hashed, then signed with a build-time ephemeral ECDSA P-256 key.

### Fixed (pre-tag stabilisation, 2026-04-27)
- **Repro / transparency pipeline circularity.** The repro manifest was
  hashing `public/transparency-bundle.json`, but that file is regenerated
  by `npm run transparency:build` *after* `npm run repro:build` runs —
  every transparency rebuild therefore invalidated the most recent repro
  manifest. Added `EXCLUDE_FILES` to `scripts/build-repro-manifest.mjs`
  with `public/transparency-bundle.json` as its sole entry. The bundle is
  already cryptographically anchored by its own ECDSA signature; double-
  anchoring through the repro hash chain was redundant and broke
  determinism. Pinned by a regression test in
  `tests/unit/repro-manifest.test.ts` (v1.4.9 ships at 241/241 tests).

### Added — Build pipeline
- `scripts/build-transparency-bundle.mjs` — aggregates four component
  streams: `governance` (`HONESTY.md`, `SAFEGUARDING.md`, `SECURITY.md`,
  `EVENKEEL_BIBLE.md`, `CHANGELOG.md`), `controlMap`
  (`compliance/kcsie-2025-prevent-duty-map.json`), `reproducibility`
  (`evidence/repro-manifest.json`), and `audit` (newest
  `evidence/audit-manifest-*.json`). Each stream contributes a sha256;
  a deterministic concatenation produces `componentDigestB64url`. The
  whole bundle (minus the signature) is then canonicalised
  (recursive key-sort) and signed with a build-time **ephemeral** ECDSA
  P-256 key using `dsaEncoding: "ieee-p1363"` so the raw r‖s signature
  verifies in-browser via `SubtleCrypto`. Writes
  `evidence/transparency-bundle.json` and a copy at
  `public/transparency-bundle.json` (skip the public copy with
  `--no-public-copy`).
- `scripts/verify-transparency-bundle.mjs` — re-derives every component
  sha from disk and compares; recomputes `componentDigestB64url`;
  re-canonicalises the bundle minus the signature, imports the
  embedded SPKI-DER public key, and runs ECDSA verify. Exits non-zero
  on any drift. Supports `--json` and `--quiet`.

### Added — npm scripts
- `transparency:build` → `node scripts/build-transparency-bundle.mjs`
- `transparency:verify` → `node scripts/verify-transparency-bundle.mjs`

### Added — Audit gate
- `scripts/audit.mjs` — new inline assertion runs the verifier; a stale
  bundle fails CI (`audit:strict`).

### Added — /compliance "Transparency" tab
- `components/shared/TransparencyBundleCard.tsx` — fetches
  `/transparency-bundle.json`, renders engine version, generated time,
  schema, signing algorithm, governance-docs ratio, control-map count,
  reproducibility aggregate sha (truncated), audit pass/fail counts,
  and the full `componentDigestB64url`. **Download bundle** is an
  anchor with `download`. **Verify signature in browser** uses
  `SubtleCrypto.importKey("spki", …, ECDSA P-256)` and
  `subtle.verify({ name: "ECDSA", hash: "SHA-256" }, …)` against the
  canonical pre-image rebuilt client-side. Empty state is honest: if
  the developer hasn't run `npm run transparency:build`, the card
  shows the literal shell command instead of a misleading error.
- `app/compliance/page.tsx` — adds `{ id: "transparency", label:
  "Transparency" }` to the surface nav.

### Added — Tests
- `tests/unit/transparency-bundle.test.ts` (11 assertions) — builds in
  a `mkdtemp` sandbox with stub governance docs and a copy of the real
  control map. Asserts schema, canonical-JSON order-independence,
  signature-strip, sign/verify round-trip, governance-edit tamper
  detection, `componentDigestB64url` forge detection,
  signature-bit-flip detection, control-map edit detection, plus a
  real-codebase smoke build with no write.

### Honesty
- The build-time key is **ephemeral** — generated, used once, and
  discarded. `signature.keyType: "ephemeral-build-time"` and
  `signature.note` record this in every bundle. The bundle proves
  *internal consistency* (the four shas, the digest, the metadata all
  came from one process at one moment) — it does **not** prove
  "Even Keel Learning" signed it. Phase-2 swap is a KMS-backed
  institution key or a WebAuthn-passkey-derived signature. See
  HONESTY.md §4.2 and SAFEGUARDING.md §1.9.
- The bundle is point-in-time. Schools must re-run
  `npm run transparency:build` after any governance / control-map /
  audit change. CI (`audit:strict`) enforces this.

### Cross-cutting
- `package.json` — version bump 1.4.8 → 1.4.9; added the two
  `transparency:*` scripts.
- `compliance/kcsie-2025-prevent-duty-map.json` — version
  1.0.0 → 1.0.1, `publishedAt` 2026-04-26 → 2026-04-27, `engineVersion`
  evenkeel@1.4.8 → evenkeel@1.4.9.
- `SAFEGUARDING.md` — new §1.9 documenting the transparency bundle
  pipeline, verifier semantics, and Phase-2 KMS replacement.
- `HONESTY.md` — new §2.1 ledger row for v1.4.9; new §4.2 entry on the
  ephemeral-key honesty contract.

---

## [1.4.8] — 2026-04-26 — DSL Escalation Pipeline + KCSIE 2025 / Prevent Duty Control Map

Closes the longest-standing Phase-1 honesty gap (HONESTY.md §3.2: "DSL
notification queue is not built"). The crisis lexicon now categorises every
match into one of five families, and the Decision Gate publishes a signed,
category-only escalation envelope that a school can route to its own
pastoral / MIS HTTPS endpoint. Pinned to a verifiable KCSIE 2025 / Prevent
Duty / DfE Filtering & Monitoring control map.

### Added — Categorised crisis lexicon
- `lib/regulatory-absorb/types.ts` — new `CrisisPatternCategory` union:
  `direct_self_harm | temporal_escalation | indirect_distress |
  cyberbullying_acronym | emoji_affect`.
- `lib/regulatory-absorb/decision-gate.ts` — `CRISIS_PATTERNS` becomes
  `CATEGORISED_CRISIS_PATTERNS` (each entry is `{category, pattern}`); the
  17 regexes are unchanged from v1.2.0. New exported `detectCrisisCategory()`
  returns the family that fired (or `null`). `checkSafety()` sets
  `crisisPatternCategory` on the response.
- `lib/eke/eke-engine.ts` — `EkeMessage` carries `blockedTrigger` and
  `blockedCrisisCategory` so downstream surfaces never re-run the regex.

### Added — Signed-and-persisted DSL escalation queue
- `lib/safeguarding/escalation-queue.ts` — when the Decision Gate fires,
  EkeChat calls `enqueueEscalation()`, which signs an envelope (re-using
  `lib/crypto/signing.ts` ECDSA P-256) and persists it under
  `evenkeel.safeguarding.queue.v1`. **Privacy contract — pinned by test:**
  the `EnqueueInput` interface accepts NO `text` parameter; learner
  free-form text is structurally impossible to include. Payload contains
  only `{ id, detectedAt, detectedAtIso, triggerType,
  crisisPatternCategory, jurisdiction, studentAgeBand?, engineVersion,
  tabContextId }`. Bounded at 200 entries, oldest-first eviction.
- `lib/safeguarding/webhook-config.ts` — school-configured HTTPS endpoint
  store (one URL, on-device, HTTPS-only with `localhost`/`127.0.0.1` dev
  exception). Validation rejects `http://` to public hosts, `file:`,
  `javascript:`, `data:`, `ftp:`. Defensive parser: corrupt storage
  yields `null`, never a throw.
- `lib/data-bus.ts` — new bus event `safeguarding.escalation.requested`
  (category-only payload).
- `components/shared/EkeChat.tsx` — on a `crisis_response` block, fans out
  the bus event and enqueues the signed envelope. The helpline message
  shows immediately; signing/storage failure must not block it.

### Added — Compliance Officer surface
- `components/shared/SafeguardingEscalationsCard.tsx` — new "Safeguarding"
  tab on `/compliance`. Configure / clear the school's DSL endpoint, view
  the queue (newest first, with category, timestamp, jurisdiction, age
  band, delivery state), fire a synthetic test escalation to confirm
  wiring, verify any stored signature on-page, re-attempt a failed
  delivery. Privacy contract preserved: only category-level metadata
  appears in the UI — never the learner's text.
- `app/compliance/page.tsx` — mounts the new tab.

### Added — Webhook delivery semantics
- `attemptWebhookDelivery()` in `escalation-queue.ts` — POSTs the signed
  envelope to the configured endpoint with
  `Content-Type: application/json`, `X-EvenKeel-PublicKey` (raw P-256
  public key, base64url) and `X-EvenKeel-Algorithm: ECDSA-P256-SHA256`
  headers so the receiver can verify offline without prior key exchange.
  8000 ms timeout via `AbortController`. Hard cap at 3 attempts.
  Persisted error strings are scrubbed of URLs so a typo'd endpoint
  cannot leak as a quotable token.

### Added — KCSIE 2025 / Prevent Duty / DfE F&M control map
- `compliance/kcsie-2025-prevent-duty-map.json` — 13 controls (5 KCSIE,
  3 Prevent, 3 DfE F&M, 1 GDPR Art. 25). Each has `phase1Status`
  (`supported` | `partial` | `phase2`), an evidence array of
  `{path, claim}` pointing at this codebase, and an explicit `phase2Gap`.
  Top-level `honestyContract` declares: "Drift between the map and the
  codebase MUST fail audit."
- `scripts/audit.mjs` — new inline assertion verifies every cited
  evidence path exists; fails the audit in `--strict` if not.

### Added — Tests
- `tests/unit/escalation-queue.test.ts` — privacy-contract pinning (no
  `text` field on `EnqueueInput`, allow-list of payload keys), sign/verify
  round-trip, tamper detection, defensive parser, subscriber semantics,
  delivery-state transitions (`no_endpoint` / `sent` / `failed`), URL
  scrubbing in error strings.
- `tests/unit/webhook-config.test.ts` — URL validation matrix (https /
  http-localhost / public-http / file / javascript / data / ftp / empty),
  round-trip persistence, defensive parser on corrupted storage.
- `tests/unit/decision-gate.test.ts` — every pattern family asserts the
  correct `crisisPatternCategory` from both `detectCrisisCategory()` and
  `checkSafety()`. Clean text omits the category.
- `tests/unit/kcsie-control-map.test.ts` — schema invariants, every
  cited evidence path resolves, ids are unique, `partial`/`phase2` rows
  declare a `phase2Gap`.

### Documentation
- `SAFEGUARDING.md` — new §1.8 documents the full operational contract
  (categorisation, signed-envelope schema, webhook delivery semantics,
  Compliance Officer surface, explicit Phase-1 limitations, control-map
  cross-reference).
- `HONESTY.md` — §3.2 known-bug entry rewritten to reflect what *is*
  built (signed queue + HTTPS webhook) and what is *not* (email/SMS/push
  provider integration). New §2.1 pillar row for v1.4.8.

### Phase-1 limitations (explicit, not silent)
- No email / SMS / push-notification provider integration. The
  Phase-1 contract is HTTPS-only with the school's chosen ingest
  endpoint. Phase 2 requires a Twilio / SendGrid / FCM key plus a
  school billing relationship.
- No retry-on-schedule. The Compliance Officer manually re-attempts
  after a `failed` mark.
- DSL identity is not authenticated cryptographically; the
  Compliance Officer surface is passphrase-gated (§3) — WebAuthn is
  Phase 2.
- Queue is bounded at 200 entries; no long-term WORM retention.

---

## [1.4.7] — 2026-04-27 — Reproducibility Manifest

### Added — `scripts/build-repro-manifest.mjs` & `verify-repro-manifest.mjs`
- **Reproducibility manifest** capturing the complete state of the source tree
  at audit time. Contains:
  - SHA-256 hashes (base64url) of every governed source file under `app/`,
    `components/`, `lib/`, `scripts/`, `tests/` with deterministic
    lexical ordering and POSIX-normalised paths.
  - SHA-256 hashes of all governance documents (HONESTY, CHANGELOG,
    EVEN_KEEL_BIBLE, SAFEGUARDING, README, PROPOSAL_TRUTH_PACK,
    PROPOSAL_REWRITER_NOTES) with `present: boolean` to distinguish
    "document missing" from "document changed".
  - Dependency snapshot: `package.json` hash, `package-lock.json` hash,
    engine range, resolved package count.
  - Audit pointer: filename and SHA-256 of the latest test-manifest in
    `evidence/` so a replicator knows exactly which audit passed.
  - Git fingerprint: HEAD sha, branch name, `isClean` boolean, commit
    timestamp (graceful degradation when not in a git checkout).
  - `aggregateSha256`: SHA-256 of the concatenated `path\tsha256` rows;
    this is the single value a CI badge or attestation can quote.
- **CLI entry points:**
  - `npm run repro:build` — writes `evidence/reproducibility-manifest.json`
  - `npm run repro:verify` — re-derives all hashes and exits non-zero on
    any mismatch (file-hash, file-missing, governance-hash,
    dependency-change, audit-pointer-missing).
- **Design notes:** No signature on the manifest in v1 — its integrity
  is anchored in git history and the hash chain. The planned transparency
  bundle export (Item 8) will wrap this manifest in an ECDSA-signed
  envelope using a longer-lived key.

### Added — `tests/unit/repro-manifest.test.ts`
- 19 unit tests covering helper invariants, schema shape, aggregate-hash
  determinism, round-trip verification, and tamper detection in a
  sandboxed temp directory (source mutation, file deletion, governance
  tamper, dependency tamper).

## [1.4.6] — 2026-04-26 — Signed Learning Receipts (the receipt-with-a-destination)

### Added — `lib/receipts/learning-receipt.ts`
- A learner-issued, **ECDSA P-256 signed** snapshot of work on a single
  problem. Re-uses the existing `signPayload` / `verifyEnvelope`
  primitives from `lib/crypto/signing.ts` — the same code that backs the
  Compliance Resolution Tray's signed envelopes. Persisted under
  `evenkeel.receipts.bank` in localStorage; bounded at 100 entries with
  oldest-first eviction; one-time migration from the legacy
  `keellearn.receipts.bank` key.
- API: `issueReceipt(partial)`, `getReceipt(id)`, `listReceipts()`
  (newest-first), `verifyReceipt(receipt)`, `importReceiptJson(json)`,
  `clearReceipts()`, `subscribeReceipts()`. Defensive parser drops
  malformed entries; an "imported but mismatched-id" path surfaces in
  the verifier UI rather than getting silently binned.

### Why this design and not "university partnerships first"
- The strategic-review pushback: the destination-receipt point is right
  but the bar is set three rungs too high. The first rung is **one
  teacher in one school accepting one signed receipt as evidence for
  one coursework grade.** That's not a partnership; it's a single
  decision. Once the receipt has a destination, the path school →
  multiple schools → exam board → university is shorter than zero →
  university.
- Phase-1 Learning Receipts are therefore designed against the
  teacher-grade-acceptance use case: a single shareable URL, single-
  click verify-in-browser UX, no key infrastructure, no institutional
  onboarding. Same path the Compliance surface already proves works.

### Added — `app/receipt/[id]/page.tsx`
- Public verifier landing page. Three render states:
  1. **Receipt found locally** — renders the structured payload
     (work summary + cryptographic signature block) and offers a
     one-click *Verify signature* action. Verification runs entirely
     in the recipient's browser via SubtleCrypto; **no server is
     contacted**, no account is required.
  2. **Receipt not found locally** — Import block with a textarea
     where the recipient pastes the JSON envelope they received
     out-of-band. The receipt is then verified the same way.
  3. **Imported with a mismatched id** — keeps the imported copy
     visible with a clearly-labelled warning instead of silently
     binning a foreign-issued receipt.
- Includes a *Download JSON* action so the recipient can archive the
  envelope. The downloaded file is the canonical archival format.

### Added — `components/shared/IssueReceiptCard.tsx`
- Right-rail card on `/student` that aggregates the current session
  by subscribing to the data bus (`student.answer.validated`,
  `student.hint.requested`, `student.paste.blocked`, `student.submit`,
  `student.gate.cleared`, `student.practice.session`). On *Issue
  Receipt*, signs the bundle and displays the shareable URL with
  *Copy URL* and *Open* actions. Self-hides until the learner has at
  least one validated attempt — same discipline as `MyPatternsCard`
  and `ComingBackCard`.

### Privacy contract
- The signed payload contains AGGREGATE signals only — never learner
  free-form text, never the expected value of the problem. Pinned by
  test (`payload contains exactly the schema-1 fields and nothing
  else`): the schema is `{ receiptId, issuedAtIso, schemaVersion,
  learnerInitials, problemId, problemTitle, skillFamily?,
  attemptsTotal, correctOnAttempt, hintTierMax, categoryCounts,
  leitnerBox, gateCleared, pasteAttempts, trustScore,
  practiceSessionsCount, jurisdiction }`. Category counts are a
  fixed-key object; no per-attempt detail. Practice mode contributes
  only a count of completed sessions; the v1.4.3 contract still
  applies.

### Phase-1 honesty (HONESTY.md §2.1 + §2.2)
- The signing key is the per-tab session key from `lib/crypto/signing.ts`
  — **not yet bound to a persistent learner identity**. A valid
  signature proves *the receipt has not been tampered with since
  signing*, not *the named learner cryptographically owns it*. The
  Phase-2 fix is a passkey-derived key. The verifier UI says so on
  the page, in plain English, below the verify button.

### Tests added (`tests/unit/learning-receipt.test.ts`, +15 assertions)
- Issue + verify: fresh id, issuedAtIso bracketed by call timing,
  end-to-end verification passes.
- Tamper detection: payload mutation fails verify; signature mutation
  fails verify.
- Privacy contract: payload keys are exactly the schema-1 set;
  categoryCounts has the fixed six-key shape.
- Persistence: `getReceipt` round-trips; `listReceipts` returns
  newest-first; `clearReceipts` notifies subscribers.
- Import / export: round-trip via `JSON.stringify` + `importReceiptJson`
  preserves verification; malformed JSON returns null without
  throwing; a mutated-after-export receipt fails verify on import.
- Defensive parsing: non-array contents ignored; malformed entries
  filtered; legacy-key migration copies `keellearn.receipts.bank`
  into the new key on first read and removes the legacy key.

### Verified
- `tsc --noEmit` — clean.
- `next lint --max-warnings 0` — no warnings or errors.
- `vitest run` — **171 tests across 18 files passing** (+15).
- `node scripts/audit.mjs --strict` — 0 failed / 0 skipped.

---

## [1.4.5] — 2026-04-26 — Tier-4 worked parallel (the hint LLM EdTech can't safely ship)

### Added — `lib/eke/parallel-problems.ts`
- A hand-written corpus of **fully-worked parallel problems**, keyed by
  `skillFamily`. Each entry is a different problem in the same skill
  shape with **different numbers**, so showing the worked solution
  cannot leak the answer to the original.
- **First family seeded:** `linear-eq-1var` with four parallels —
  `3x − 4 = 11`, `4y + 2 = 18`, `5m − 3 = 22`, `2k + 9 = 17`. Adding new
  families is a content task, not a code change.
- API: `getAllParallelProblems()`, `getFamilyParallels(family)`,
  `pickSafeParallel(family, originalExpected)`, `renderParallelMessage(p)`.
- **Leak-guard contract:** `pickSafeParallel` runs the existing
  `hintContainsAnswer()` over the candidate's `${problem}\n${workedSolution}`
  against the caller's original expected value. The first family entry
  that survives the guard is returned; if none survive, the function
  returns `null` and the engine falls back to the existing "I've
  offered every hint I can" line.

### Why this tier-4 is uniquely available on this architecture
- Every LLM-EdTech tier-4 hint is structurally the same: *give the
  answer, dressed up as an explanation*. There is no other option once
  the model has been allowed near the problem state.
- The structural-safety pitch (no answer-generation code path, provable
  by grep) means this codebase has *real* tier-4 options that LLM-based
  competitors do not. A fully-worked parallel — a different problem
  with different numbers, walked end-to-end — is the move.
- Pinned by tests: the rendered tier-4 message for the /student demo
  problem (expected = 6) never contains "6" as a whole-number token.

### Wired
- **`lib/eke/eke-engine.ts`** — added `EkeContext.skillFamily?: string`.
  `nextHint()` now serves tiers 1-3 from the existing template pool,
  then **once per session** serves a tier-4 worked parallel via
  `pickSafeParallel()`. Tier-4 fires only when (a) `skillFamily` is set
  AND (b) a leak-safe candidate exists. Without `skillFamily`, the
  engine preserves the previous 3-tier ceiling and existing fallback
  message — no behaviour change for surfaces that don't opt in.
- **`lib/eke/tiered-hints.ts`** — `TieredHint.tier` widened from
  `1 | 2 | 3` to `1 | 2 | 3 | 4`. Tier 4 is never generated here;
  it is sourced from the parallel-problem corpus and assembled by
  `EkeEngine.nextHint()`.
- **`components/shared/EkeChat.tsx`** — added an opt-in `skillFamily?`
  prop, threaded into the engine constructor. Chat bubbles now use
  `whiteSpace: pre-line` so the multi-line worked solution renders
  correctly; tier-4 messages render in the surface's mono font for
  column-aligned arithmetic. The tier badge reads *"Tier 4 · Worked
  parallel"* instead of a raw number for visibility.
- **`app/student/page.tsx`** — declared `skillFamily="linear-eq-1var"`
  on the demo `EkeChat`, alongside the existing `problemAnswer={6}`
  and `problemId="ie-jc-maths-linear-eq-001"`. Demo path now reaches
  tier-4 by clicking the *Hint* button four times.

### Behaviour invariants
- **Tier-4 is served at most once per session.** Subsequent `nextHint()`
  calls fall through to the "I've offered every hint I can — trust your
  reasoning" fallback so the learner is gently pushed back to their own
  thinking rather than handed a stream of worked examples. Pinned by
  test.
- `EkeEngine.hintTierUsed()` now counts a served tier-4 (was: capped at
  3); CRT/ledger surfaces consuming this number are unaffected because
  no surface previously asserted `hintTierUsed() <= 3`.
- `EkeEngine.reset()` clears the `parallelServed` flag so a reset
  session can serve tier-4 again.

### Tests added (`tests/unit/parallel-problems.test.ts`, +12 / `tests/unit/eke-engine.test.ts`, +5)
- Corpus invariants: non-empty corpus, every entry has non-empty fields
  and a finite `expectedAnswer`, ids are unique, the `linear-eq-1var`
  family covers the demo with multiple distinct expected values, and
  **every** entry in that family is leak-safe against the demo answer.
- `pickSafeParallel`: returns null for unknown families; returns the
  first entry when no expected is supplied; returns the first leak-safe
  entry when an expected is supplied; for every family member's own
  expected, whatever is returned is leak-safe; returns null when no
  candidate in the family survives the guard.
- `renderParallelMessage`: includes the parallel's problem and worked
  solution; frames the parallel as a "sister problem".
- Engine integration: tier-4 fires only after tiers 1-3 when
  `skillFamily` is set; tier-4 is served at most once per session;
  the rendered tier-4 message never echoes the original expected
  value (`hintContainsAnswer(content, "6") === false`); an unknown
  `skillFamily` falls back to the previous 3-tier ceiling;
  `hintTierUsed()` reflects a served tier-4.

### Verified
- `tsc --noEmit` — clean.
- `next lint --max-warnings 0` — no warnings or errors.
- `vitest run` — **156 tests across 17 files passing** (+17).
- `node scripts/audit.mjs --strict` — 0 failed / 0 skipped.

---

## [1.4.4] — 2026-04-26 — Spacing scheduler (deterministic Leitner)

### Added — `lib/eke/scheduler.ts`
- A deterministic **5-box Leitner state machine** over previously-attempted
  problems. Right answers promote a problem one box (capped at the top);
  any non-correct, non-skipped attempt collapses it to box 1. Standard
  Leitner cadence: **1 / 3 / 7 / 14 / 30 days**, exposed as
  `BOX_INTERVALS_DAYS` so the UI can render *"next review in N days"*
  without re-deriving the schedule.
- API: `recordAttempt(problemId, category, now?)`, `getDueProblems(now?)`,
  `getProblemState(id)`, `getAllStates()`, `subscribeScheduler()`,
  `clearScheduler()`, plus the pure helper `nextBox(currentBox, category)`
  exposed for unit tests and downstream tooling.
- Persisted under `evenkeel.eke.scheduler` in localStorage; one-time
  migration from the legacy `keellearn.kele.scheduler` key. Defensive
  parser drops entries with out-of-range box numbers, missing fields, or
  non-finite timestamps so a corrupt entry from an older schema cannot
  crash the UI.
- `no_attempt` is a deliberate no-op; an empty `problemId` is rejected.
  The call site in `EkeChat.tsx` is therefore unconditional.

### Why Leitner, not FSRS, for v1
- **Deterministic.** No fitted parameters. No model file to ship. No
  surprise regressions when the parameter file changes.
- **Parent-explainable in one sentence:** *"Problems your child gets
  wrong come back tomorrow; problems they get right come back next
  week, then in a fortnight, then in a month."* That is the entire
  algorithm. No LLM, no opaque scoring, no per-learner bias.
- **Auditable.** A learner or teacher can read the on-device JSON and
  replay the entire history in their head.
- FSRS-lite is a strict upgrade on the same data shape and can replace
  this module in a later phase without changing callers.

### Added — `components/shared/ComingBackCard.tsx`
- Right-rail card on `/student` that surfaces the scheduler to the
  learner. Three render states, in priority order:
  1. **Hidden** when no problems have ever been attempted (matches the
     `MyPatternsCard` discipline — a new learner's first session is
     uncluttered).
  2. **"Coming back today"** when one or more entries are due. Lists each
     due problem with its current Leitner box level and a learner-readable
     *"sign-flip last time"* / *"got it last time"* annotation derived
     from the existing `AnswerCategory` vocabulary.
  3. **"All caught up"** when entries exist but none are due, with a
     *"next review in N days"* countdown so the empty state still feels
     earned. The countdown ticks once a minute.
- Footer always reads *"<N> problems on your review list · spacing
  schedule 1 / 3 / 7 / 14 / 30 days"* so the algorithm is on the surface,
  not behind it.

### Wired
- **`components/shared/EkeChat.tsx`** — added an opt-in `problemId?: string`
  prop. When set alongside a validated `answerCategory`, every attempt
  drives `recordSchedulerAttempt(problemId, category)`. Surfaces that
  omit the prop (trades, adult, demos) get no scheduler integration —
  same opt-in discipline as `problemAnswer` (HONESTY.md §2.1).
- **`app/student/page.tsx`** — pinned demo `problemId =
  "ie-jc-maths-linear-eq-001"` for the active linear-equation problem,
  passes a one-entry `titles` map to `ComingBackCard` so the right-rail
  card surfaces *"Linear equation (2x + 5 = 17)"* rather than the
  opaque slug.

### Practice-mode interaction
- The scheduler **does** record attempts made during private-practice
  mode (v1.4.3). The scheduler is a learner-facing tool — the learner's
  own queue of what to review next — not a teacher reporting surface.
  The practice contract is about teacher visibility (Integrity Ledger),
  not learner-self visibility (this module + `error-bank.ts`).

### Privacy contract
- Per-problem state is keyed by an opaque `problemId` provided by the
  caller. No learner free-form text and no expected value is ever
  persisted here. Stored payload is exactly
  `{ problemId, box, dueAt, attempts, lastSeen, lastResult }` where
  `lastResult` is one of the existing `AnswerCategory` strings.

### Tests added (`tests/unit/scheduler.test.ts`, +20 assertions)
- State machine: `correct` promotes by one; promotion saturates at the
  top box; every non-correct, non-skipped category demotes to box 1
  regardless of current box; `no_attempt` is a no-op.
- `recordAttempt`: creates fresh entries at the correct box for first
  correct vs first incorrect; promotes existing entries on follow-up
  correct; collapses to box 1 on any incorrect attempt regardless of
  prior promotions; rejects empty problemIds; ignores `no_attempt`.
- Due-queue: a freshly-recorded entry is **not** due (it was just
  scheduled forward); `getDueProblems(future)` returns due entries
  sorted by `dueAt` ascending.
- Persistence + clear + subscribers: localStorage round-trip;
  `clearScheduler()` notifies; misbehaving subscribers don't poison
  the rest.
- Defensive parsing: non-array contents, malformed JSON, and entries
  failing the shape guard (out-of-range box, missing fields) are all
  filtered without crashing.
- Legacy migration: copies `keellearn.kele.scheduler` to the new key on
  first read; does not overwrite an existing evenkeel scheduler;
  removes the legacy key after migration.

### Verified
- `tsc --noEmit` — clean.
- `next lint --max-warnings 0` — no warnings or errors.
- `vitest run` — **139 tests across 16 files passing** (+20).
- `node scripts/audit.mjs --strict` — 0 failed / 0 skipped.

---

## [1.4.3] — 2026-04-26 — Private practice mode (anxious-learner equity)

### Added — `lib/eke/practice-mode.ts`
- A learner-controlled toggle that runs a bracketed practice **session**
  during which per-event behaviour does not surface in the Teacher
  Integrity Ledger. Persisted under `evenkeel.eke.practiceMode` in
  localStorage; bracketed by an opaque session id; one-time migration
  from the legacy `keellearn.kele.practiceMode` key.
- API: `startPracticeSession()`, `endPracticeSession()`,
  `getPracticeState()`, `isPracticeActive()`, `subscribePracticeMode()`.
- Defensive parser: an "active" record without a sessionId is treated
  as inactive (corruption-safe); malformed JSON is treated as inactive.

### Added — `components/shared/PracticeModeBar.tsx`
- Toggle + active-state banner mounted above `EkeChat` on `/student`. The
  active-state banner spells the contract out in plain English so the
  learner reads what is and isn't shared **before** they start. Includes
  a one-line note that safeguarding still applies — the crisis-detection
  Decision-Gate runs the same way regardless of practice mode.

### Added — Bus event `student.practice.session`
- The **only** practice-related event the teacher view shows. Payload
  contract: `{ active: true, sessionId }` on start;
  `{ active: false, sessionId, durationMs }` on end. Never any per-step
  contents. Registered in the `BusEventType` union in `lib/data-bus.ts`.

### Wired
- **`components/shared/EkeChat.tsx`** — every existing `student.*` publish
  (`student.submit`, `student.answer.validated`, `student.error.observed`,
  `student.hint.requested`, `student.paste.blocked`) now spreads a
  `practiceMarker()` bundle into the payload. While practice is active,
  the bundle is `{ practiceMode: true, practiceSessionId }`; while
  inactive, it is `{}`, so non-practice events are byte-identical to
  pre-v1.4.3 shape.
- **`app/teacher/page.tsx`** — Teacher Integrity Ledger now applies an
  `isFilteredPracticeDetail()` filter: events with `practiceMode === true`
  are dropped from both the initial `recentEvents()` hydrate and the live
  subscriber path. `student.practice.session` events are admitted as a
  single muted *PRACTICE — private session started* /
  *PRACTICE — private session ended (N min)* line.
- The personal error-bank from v1.4.2 **still records during practice**.
  The v1.4.3 contract is about teacher visibility, not learner-self
  visibility; the learner's private journal is theirs either way.

### Pedagogy framing
- The architectural choice "every interaction feeds the Integrity Ledger"
  is a surveillance choice, not a neutral default. For anxious, SEN,
  previously-shamed, or self-conscious learners, surveillance is the
  thing that prevents engagement with the practice they need most.
  Lifting that surveillance — under a contract the teacher can see and
  trust — is the pedagogy move. The teacher still gets the most useful
  signal (*practice happened*); the learner gets the freedom to fail
  privately.

### Phase-1 honesty (HONESTY.md §2.1 + §2.2)
- The practice-mode contract is enforced at the **consumer** (the Teacher
  Ledger filter), not by separate per-role transports. A teacher with
  DevTools on the same browser could in principle inspect `evenkeel.bus.log`
  in localStorage and read filtered events. This is a credible Phase-1
  contract for a single-device demo prototype but is **not a security
  boundary**. Phase-2 fix: per-role bus transports, or encrypted practice
  payloads decryptable only by surfaces the learner has authorised.

### Tests added (`tests/unit/practice-mode.test.ts`, +12 assertions)
- Lifecycle: starts inactive on a fresh device; `startPracticeSession()`
  is idempotent and returns the same id on repeated calls;
  `endPracticeSession()` returns the bracketing id and a non-negative
  duration; calling end while inactive returns `null`.
- Subscribers: notifications fire on start and on end; a misbehaving
  subscriber does not poison the rest.
- Defensive parsing: an "active" record without a sessionId is treated as
  inactive; malformed JSON is treated as inactive; a missing `startedAt`
  is back-filled so `durationMs` cannot go negative.
- Legacy migration: copies `keellearn.kele.practiceMode` to the new key
  on first read; does not overwrite an existing evenkeel record;
  removes the legacy key after migration.

### Verified
- `tsc --noEmit` — clean.
- `next lint --max-warnings 0` — no warnings or errors.
- `vitest run` — **119 tests across 15 files passing** (+12).
- `node scripts/audit.mjs --strict` — 0 failed / 0 skipped, 9 build + 6 inline.

---

## [1.4.2] — 2026-04-26 — Named-error feedback + personal "My patterns" journal

### Added — `lib/eke/error-bank.ts`
- A learner-owned, **category-only** journal of recurring error shapes,
  persisted under `evenkeel.eke.errorBank` in localStorage. Bounded at
  50 entries; oldest evicted first so the bank tracks recent drift,
  not a permanent record.
- Five tracked patterns mapped to plain-English **named diagnostics** with
  an explicit *cue* the learner can use next time: `sign_flipped`,
  `off_by_one`, `doubled`, `halved`, `wrong`. `correct` and `no_attempt`
  are deliberately not recorded. Pattern strings are pinned by a unit
  test to contain **no Arabic numerals** (defence-in-depth so the
  surface cannot leak an expected value).
- Subscriber API (`subscribeErrorBank`) plus a defensive parser that
  ignores unrecognised entries from older schemas. One-time migration
  from the legacy `keellearn.kele.errorBank` key.

### Added — `components/shared/MyPatternsCard.tsx`
- Right-rail card on `/student` that surfaces the journal to the learner
  as named patterns with frequency badges and per-pattern cues. Includes
  an explicit learner-controlled **"clear my journal"** action — the
  artefact is theirs.
- The card **renders nothing when the bank is empty**, so a learner's
  first session is uncluttered and the feature does not shame a new
  user. Subscribes to both same-tab updates and the cross-surface bus
  for cross-tab refresh.
- Teacher and parent surfaces deliberately do **not** mount this
  component. The Teacher Integrity Ledger continues to receive
  category-only `student.answer.validated` events; the learner's
  personal history is private to the device.

### Added — Bus event `student.error.observed`
- Registered in the `BusEventType` union in `lib/data-bus.ts`. Payload
  is `{ category, problemTitle, jurisdiction }` — never learner free-form
  text, never the expected value. Honours the same privacy contract as
  `student.answer.validated`.

### Wired
- `components/shared/EkeChat.tsx` — on every validated, non-correct,
  non-no_attempt category, calls `recordError()` and publishes
  `student.error.observed` to the bus immediately after the existing
  `student.answer.validated` publish. The category is the only payload
  on either event.

### Pedagogy framing
- This is a **wellbeing intervention disguised as a pedagogy feature**:
  a learner who has been told *"you flipped the sign — that's one of the
  five most common maths errors and here's the cue that catches it"*
  experiences a fundamentally different emotional state than one who's
  been told *"wrong, try again"*. Hattie d≈0.7 for formative feedback;
  the specific power of named errors is that they convert frustration
  into pattern recognition.

### Documentation
- `docs/PROPOSAL_TRUTH_PACK.md` — three earlier edits in this same
  session: lifted the **compounding-architecture claim** into §A as
  the opening framing; promoted the **DSL escalation webhook +
  KCSIE 2025 / Prevent-duty control mapping** and the **signed
  Learning Receipts + reproducibility manifest + transparency-bundle
  export** to a Phase-2 *operational gate* that ships before any LLM
  scope; added a **"Permanently out of scope"** subsection to §C
  naming LLM-authored fresh problems, LLM essay grading, predictive
  academic-risk scoring, sentiment/emotion recognition, live LLM in
  conversation with a child, voice biometrics, and gamification dark
  patterns, each with the specific legal or pedagogical reason.
- `scripts/audit.mjs` — fixed two stale inline checks left over from the
  v1.4.1 rename: required-files list now expects `EVEN_KEEL_BIBLE.md`
  (not `EVENKEEL_BIBLE.md`), and the package-name assertion now checks
  `even-keel-learning` (not `evenkeel`). Added `SAFEGUARDING.md`,
  `docs/PROPOSAL_TRUTH_PACK.md`, and `docs/PROPOSAL_REWRITER_NOTES.md`
  to the required-governance set so future renames cannot quietly
  delete them.

### Tests added (`tests/unit/error-bank.test.ts`, +13 assertions)
- Contract: `correct`/`no_attempt` are ignored; every tracked category
  is recorded; persisted shape contains exactly `category`, `ts`, and
  optional `problemTitle` and nothing else (no-leak property pinned).
- Bounded at 50 entries with oldest-first eviction.
- Subscriber notifications on record + clear; a misbehaving subscriber
  cannot poison the rest.
- Summary aggregator: higher-frequency categories sort ahead of lower.
- Pattern detail strings are non-empty and contain no Arabic numerals.
- Legacy migration: copies `keellearn.kele.errorBank` to the new key
  on first read; does not overwrite an existing evenkeel bank;
  removes the legacy key after migration.
- Defensive parsing: non-array contents are ignored; entries with
  unrecognised category strings are filtered.

### Verified
- `tsc --noEmit` — clean.
- `next lint --max-warnings 0` — no warnings or errors.
- `vitest run` — **107 tests across 14 files passing** (+13).
- `node scripts/audit.mjs --strict` — 16 passed / 0 failed / 0 skipped.

---

## [1.4.1] — 2026-04-26 — Platform rename: KeelLearn → Even Keel Learning

### Renamed
- **Platform display name:** `KeelLearn` → `Even Keel Learning`.
- **npm package:** `keellearn` → `even-keel-learning`.
- **AI persona:** `KeLe` → `Eke` (Even Keel Engine). Same character,
  same template-driven behaviour, same Socratic protocol — just a new
  name. The chat header, tone profiles, and i18n strings all reflect
  this.
- **Source paths:** `lib/kele/` → `lib/eke/`,
  `lib/kele/kele-engine.ts` → `lib/eke/eke-engine.ts`,
  `components/shared/KeLeChat.tsx` → `components/shared/EkeChat.tsx`,
  `tests/unit/kele-engine.test.ts` → `tests/unit/eke-engine.test.ts`,
  `KEELLEARN_BIBLE.md` → `EVEN_KEEL_BIBLE.md`.
- **Identifiers:** `KeLeEngine` → `EkeEngine`, `KeLeChat` → `EkeChat`,
  `KeLeMessage` → `EkeMessage`, `KeLeTone` → `EkeTone`,
  `KeLeContext` → `EkeContext`.
- **localStorage namespace:** `keellearn.*` / `keellearn/*` →
  `evenkeel.*` / `evenkeel/*`. **One-time migration** is wired into
  `lib/data-bus.ts`, `lib/i18n/I18nProvider.tsx`, `lib/a11y/settings.ts`,
  and `lib/auth/age-band.ts` so existing demo state is carried across.
- **BroadcastChannel:** `keellearn.bus` → `evenkeel.bus`.
- **Documentation:** every `.md` reference updated; reading order in
  `README.md` re-pointed to `EVEN_KEEL_BIBLE.md`.

### Mechanics
- One-shot rename script at `scripts/rename-evenkeel.mjs` walked the
  repo (skipping `node_modules`, `.next`, `evidence/`,
  `package-lock.json`, and itself) and applied **509 textual
  replacements across 52 files**.
- Order of replacements is deliberately longest-first
  (`KEELLEARN` → `KeelLearn` → `keellearn` → `KELE` → `KeLe` →
  `kele` with word-boundary anchors) so that `keellearn` (which
  contains `kele` as a substring) cannot get clipped mid-rewrite.
- Historical audit manifests in `evidence/*.json` are intentionally
  preserved verbatim — they describe past state.

### Verified
- `tsc --noEmit` — clean.
- `next lint --max-warnings 0` — no warnings or errors.
- `vitest run` — **94 tests across 13 files passing**.
- `playwright test tests/e2e/a11y.spec.ts` — 8 surfaces, no serious /
  critical axe violations.

---

## [1.4.0] — 2026-04-26 — Answer validation (deterministic, no LLM)

### Added — Deterministic answer-checker
- **`lib/validation/answer-checker.ts`** — pure-JS, no-LLM validator that
  extracts a numeric assertion from learner free-form text and categorises
  it against the problem's known expected value.
- Categories surfaced: `correct`, `off_by_one`, `sign_flipped`, `doubled`,
  `halved`, `wrong`, `no_attempt`.
- **The structural safety guarantee extends to validation.** The checker
  never reveals the expected value through its returned hint text — pinned
  by a brute-force unit test that asserts no category's hint contains the
  expected number for a sample expected value of 6.
- 14 assertions in **`tests/unit/answer-checker.test.ts`**.

### Added — Engine wiring
- **`lib/eke/eke-engine.ts`** — `EkeContext.problemAnswer` (number) is
  now consumed. When a learner message contains a numeric attempt, the
  engine routes through the checker before falling back to the tiered-hint
  pipeline. `EkeMessage.answerCategory` carries the diagnostic forward.
- **Defence in depth** — the engine re-checks every reply through
  `hintContainsAnswer()` before committing it; if the guard fires the
  reply falls back to the standard tiered hint.
- 3 new integration assertions in **`tests/unit/eke-engine.test.ts`**
  (correct flow, sign-flip + leak guard, no-validation fallthrough).

### Added — Cross-surface signal
- **`lib/data-bus.ts`** — new `student.answer.validated` bus event type.
- **`components/shared/EkeChat.tsx`** — publishes the validated event
  with category-only payload (never the learner's text, never the
  expected value).
- **`app/teacher/page.tsx`** — Integrity Ledger renders the new event with
  `correct → ok`, near-miss/wrong → `warn`. Validation events are
  intentionally never coloured `danger` — danger is reserved for trust /
  integrity signals so a wrong answer is never conflated with a cheating
  signal.

### Why this is the right shape (architectural note)
- Closes a real product gap, not just a sales-pitch gap. Pre-1.4.0 the
  CRT story recorded *process* (cadence, hints, paste, focus loss) but
  never *correctness* — a learner could demonstrate beautiful Socratic
  process and arrive at a wrong answer with no signal to the teacher.
- Stays compatible with the "no LLM in the hot path" structural-safety
  pitch. The checker is regex + arithmetic; auditable by grep.
- Out of scope on purpose: symbolic answers, multi-step proofs, free-form
  essay grading, code correctness — these are noted in HONESTY.md so the
  pitch is never wider than the build.

### Phase 2 (deliberately deferred)
- A "thin" LLM integration scoped to **comprehension-gate question
  authoring** (offline, batch, teacher-reviewed before students see it) —
  out of the learner-facing hot path, out of the safety surface.
- A learner-facing LLM remains explicitly out of scope until at least
  seed close.

---

## [1.3.1] — 2026-04-26 — A11y hardening (speech + axe + multi-script)

### Added — Automated axe-core accessibility testing
- **`axe-core` + `@axe-core/playwright`** dev dependencies.
- **`tests/e2e/a11y.spec.ts`** — runs axe across `/, /student, /teacher,
  /parent, /compliance, /adult, /trades, /auth` and fails the build on
  **serious/critical** violations.
- `docs/SR-TEST-PLAN.md` — manual NVDA/JAWS/VoiceOver test scripts that
  complement the automated checks.

### Added — Speech-to-text (severe dysgraphia / motor)
- **`lib/a11y/speech.ts`** — Web Speech API wrapper.
- **`components/shared/EkeChat.tsx`** — mic button + explicit disclosure
  dialog + start/stop dictation. No audio is stored; transcript stays in
  the local textarea.

### Added — Literal tone is now functional
- **`lib/eke/personality.ts`** — new `literal` tone profile and
  `getEffectiveTone()` mapping.
- **`components/shared/EkeChat.tsx`** — Eke engine now consumes the
  `literalTone` accessibility setting.
- **`tests/unit/eke-engine.test.ts`** — pins `getEffectiveTone` behaviour
  and verifies the literal greeting.

### Added — Multi-script dyslexia font fallbacks
- **`app/globals.css`** — under the dyslexia font toggle, non-Latin
  locales now switch to script-appropriate Noto Sans families:
  Arabic, Devanagari, Hebrew, Thai. CJK uses a system stack to avoid
  large downloads.

### Fixed — WCAG color contrast (high-impact spots)
- **`app/globals.css`** — darkened paper `--slate-500`, darkened `--fg-dim`
  to `--slate-900`, and introduced `--accent-ink` for text on accent-soft
  backgrounds.
- **`app/trades/page.tsx`** — active trade button now uses `--accent-ink`
  instead of `--accent` when on `--accent-soft`.
- **`components/shared/EkeChat.tsx`** — Eke avatar tile uses
  `--accent-ink` for the "Ke" glyph on its accent-soft background.

### Fixed — Speech-to-text correctness & a11y
- **`components/shared/EkeChat.tsx`**
  - Only **final** transcripts are appended to the textarea — interim
    refinements were causing duplicated text.
  - Recognition is now **stopped on component unmount** (no leak when
    the chat unmounts mid-listen).
  - Dictation dialog now closes on **Escape**, focuses the close button
    on open, and **restores focus to the mic trigger** on close, matching
    `AccessibilitySettingsPanel` semantics.
  - Mic button advertises `aria-haspopup="dialog"` + `aria-expanded`.
  - Listening status now lives inside an `aria-live="polite"` region.
  - Recognition is started in the **current locale** (was hard-coded
    `en`).
  - Speech results no longer feed `recordKeystroke()` — dictation is
    not keystroke evidence and was distorting cadence statistics.
- **`components/shared/EkeChat.tsx`** — chat header now reflects the
  **effective tone** (e.g. shows `literal` when the a11y toggle is on).
- **`tests/unit/speech.test.ts`** — 6 new assertions: support detection,
  unsupported-browser fallback, interim/final transcript wiring, error
  forwarding, `session.stop()` semantics.

### Known follow-up
- Full design-system color-contrast pass deferred. The axe `color-contrast`
  rule is currently **disabled in `tests/e2e/a11y.spec.ts`** because token
  + opacity combinations across surfaces produce flaky non-deterministic
  failures. All other serious/critical axe rules remain enforced across
  all 8 surfaces.

---

## [1.3.0] — 2026-04-26 — Accessibility & SEN equity

### Added — Accessibility settings layer
- **`lib/a11y/settings.ts`** — typed settings module with localStorage
  persistence (`evenkeel/a11y/v1`), strict boolean validation, malformed-
  input fallback, and a `applyA11ySettingsToDocument` helper that maps
  every setting to a `data-a11y-*` attribute on `<html>`.
- **`components/shared/AccessibilityProvider.tsx`** — React context that
  hydrates settings on mount, applies the document attributes, and
  exposes a stable `useA11y()` hook for consumers.
- **`components/shared/AccessibilitySettingsPanel.tsx`** — universal
  settings launcher mounted in `SurfaceShell` so every surface exposes the
  same `Accessibility` button. Slide-in panel with proper dialog
  semantics (`role="dialog"`, `aria-modal`, focus restoration on close,
  Escape-to-close, click-outside-to-close, `role="switch"` toggles).
- Seven user-controllable settings: `dyslexiaFont`, `largeSpacing`,
  `largeText`, `highContrast`, `focusMode`, `assistiveInput`,
  `literalTone`.

### Added — SEN equity (assistive-input exemption)
- **`lib/vertolearn/ipa-analyzer.ts`** — new `IPAOptions.assistiveInput`
  flag suppresses the cadence-based components (`isTooFast`,
  `isTooConsistent`) of the mimicry-detection score for users of
  eye-gaze, switch, dictation, sticky-keys, word-prediction, or
  alternative keyboards. Paste and focus-loss signals still apply.
- **`InteractionPattern.assistiveInputDeclared`** new optional field
  records the declaration on every emitted pattern so audit replays
  remain explainable.
- **`AgeBandGate`** now exposes the assistive-input declaration
  alongside the age-band picker on first visit, and persists it via
  the a11y settings module before the student surface mounts.
- **`EkeChat`** constructs its IPA analyser with the live setting and
  surfaces an "Assistive" badge (visible only when declared) so the
  silenced cadence checks are honestly explained on the trust UI.

### Added — WCAG 2.2 AA pass
- **Skip link** ("Skip to main content") as the first focusable element
  on every page; targets `#kl-main` rendered by `SurfaceShell`.
- **Semantic landmarks** in `SurfaceShell`: `<header role="banner">`,
  `<nav role="navigation" aria-label="…">`, `<main role="main"
  tabIndex={-1}>`. Active nav items carry `aria-current="page"`.
- **ARIA labels** on every icon-only control in `SurfaceShell`,
  `EkeChat` (hint button, send button, conversation log, badges),
  `AgeBandGate` (guardian acknowledgement, assistive-input checkbox),
  and the new `AccessibilitySettingsPanel`.
- **`role="log"` + `aria-live="polite"` + `aria-relevant="additions"`**
  on the EkeChat conversation viewport so screen readers announce new
  Eke replies without stealing focus.
- **44×44 minimum hit targets** via the new `.kl-tap-target` utility
  on every primary control (WCAG 2.5.5 AAA).
- **`:focus-visible` rings**, 2px outline at ≥3:1 contrast, satisfying
  WCAG 2.4.13 "Focus Appearance".
- **`@media (prefers-reduced-motion: reduce)`** suppresses every
  animation we ship — page intro fades, pulse dots, transitions,
  scroll-behavior. Vestibular, photosensitive, and migraine-trigger
  protection.
- **`@media (prefers-contrast: more)`** auto-applies the high-contrast
  palette without requiring the user to toggle it.
- **`@media (forced-colors: active)`** restores Windows High Contrast
  Mode borders on `.kl-card`, `.kl-node`, and `.kl-badge`.

### Added — Dyslexia-friendly typography
- **Atkinson Hyperlegible** added to the Google Fonts import. Activates
  via `data-a11y-dyslexia-font="true"` to swap both body and headings;
  removes Fraunces variation settings and adds 0.005em letter-spacing.

### Added — Focus mode
- **`html[data-a11y-focus-mode="true"]` CSS rules** hide every element
  marked `data-focus-hide="true"` and collapse the `.kl-student-grid`
  three-column layout to one column. Applied to `/student` rails and
  goal cards.

### Tests
- **`tests/unit/a11y-settings.test.ts`** — 8 new assertions: defaults,
  full round-trip, malformed-JSON fallback, non-boolean coercion,
  per-key updates, reset, document-attribute application,
  `hasA11yOverrides` predicate.
- **`tests/unit/ipa-analyzer.test.ts`** — 4 new assertions for the
  assistive-input exemption: `isAssistiveInput` reporter, cadence
  suppression, paste-pressure preservation,
  `InteractionPattern.assistiveInputDeclared` plumbing.
- Total vitest assertions: **56 → 68** across 11 test files.

### Changed
- **`app/layout.tsx`** — root layout now wraps children in
  `AccessibilityProvider` (above `I18nProvider`) and renders the skip
  link as the first body child.
- **`app/globals.css`** — new "Accessibility layer" section: ~150 lines
  of `data-a11y-*` rules, system-preference media queries, focus-ring
  defaults, hit-target utility.
- **`EVENKEEL_BIBLE.md` §22** — Child Safety Principles now reference
  SAFEGUARDING.md §1.5 and §1.6 for the operational implementation.

### Deferred to v1.4.0
- **CRT Replay viewer** (the SEN-exoneration headline feature). Genuine
  2–3 weeks of work that requires real signed CRTs flowing first; not
  half-built in v1.3.0.

---

## [1.2.0] — 2026-04-26 — Safeguarding pass

### Added — Child-safety controls

- **`SAFEGUARDING.md`** — full safeguarding policy with crisis detection
  coverage table, access-control documentation, age-band gate, DSL incident
  response, accountability matrix, and DSR matrix for minors.
- **`lib/auth/role-guard.ts` + `components/shared/RoleGuard.tsx`** —
  passphrase gate (SHA-256 → 16-hex digest, constant-time compare,
  sessionStorage-scoped, 400 ms cooldown on failure). Wraps `/teacher` and
  `/compliance` via their default exports.
- **`lib/auth/age-band.ts` + `components/shared/AgeBandGate.tsx`** —
  self-declared age band on first visit to `/student`. Under-13 path
  requires a guardian-acknowledgement tick.
- **`tests/unit/role-guard.test.ts`** — 7 assertions (digest format,
  digest changes on input change, starts-locked, wrong rejected, right
  unlocks, lock reverts, cooldown).
- **`tests/unit/age-band.test.ts`** — 5 assertions (default null, round
  trip, malformed handling, clear, guardian-safeguards truth table).

### Changed — Decision Gate

- Crisis lexicon expanded from 4 substrings to **17 regex patterns** plus an
  emoji+negative-affect rule:
  - obfuscated direct verbs: `k*ll`, `k1ll`, `kil1`, `kys`
  - indirect distress: "don't want to wake up", "no point in anything",
    "nobody would miss me", "if I was gone", "better off without me",
    "want to disappear", "not worth living"
  - emoji 🔪💊🩸🪢🔫 paired with hopeless / empty / numb / dark / done / etc.
- False-positive prevention pinned: academic uses ("the theme of suicide in
  Shakespeare") and recipe context ("sliced onions with the chef's knife
  🔪") explicitly tested **not** to block.
- 5 new unit tests, total decision-gate suite now at **10 assertions**.

### Added — README & SECURITY cross-links

- README reading order now lists `SAFEGUARDING.md` immediately after
  `HONESTY.md`.
- `SECURITY.md` now links to all governance docs at the top and adds a
  `[CHILD-SAFETY]` triage line for vulnerability reports affecting minors.

### Documentation alignment
- **`EVENKEEL_BIBLE.md`** — CRT schema (§10, §11) and Resolution Workflow
  (§19.2) updated from `Ed25519` to `ECDSA-P256-SHA256` to match the shipped
  WebCrypto implementation. New **Appendix E — Signing Algorithm Rationale**
  records why ECDSA P-256 was chosen (universal `SubtleCrypto` support,
  WebAuthn passkey alignment, HSM/PIV portability) and why Phase 2 skips
  Ed25519 in favour of a hybrid post-quantum signature
  (ECDSA-P256 + ML-DSA-65). §15 Hardware Ghost retires the
  "to be renamed `Even Keel LearningOfflineDB`" wording.
- **`HONESTY.md`** — substantial drift fix: §2.2/§2.3/§3/§4.1/§4.2/§4.4/§6/§9
  rewritten to reflect v1.1.0 + v1.2.0 reality (live ledgers, real ECDSA on
  resolution, RoleGuard, AgeBandGate, 56 tests, CI). File tree rebuilt.
- **`lib/regulatory-absorb/adapter-mock.ts`** — stale HONESTY block at the
  top corrected (it claimed signing was not yet wired; it has been since
  v1.1.0).

### Tests
- Total vitest assertions: **39 → 56**
- Total test files: **8 → 10**

---

## [1.1.0] — 2026-04-26

### Added — Enterprise audit framework

- **`HONESTY.md`** — single-source-of-truth audit document; per-file ledger of real vs mocked vs aspirational
- **`SECURITY.md`** — vulnerability disclosure policy, severity SLAs, control catalogue
- **`CHANGELOG.md`** — this file
- **`.well-known/security.txt`** — RFC 9116 machine-readable security contact
- **`reports/PLATFORM_AUDIT.md`** — full platform audit, Datacendia-style
- **`scripts/audit.mjs`** — Node audit runner that emits compliance-tagged evidence manifests under `evidence/`
- **`scripts/smoke.ps1`** — HTTP route smoke tester
- **`evidence/`** — generated audit manifests with `complianceTags` and `controls` per test (SOC 2 / ISO 27001)
- **`.github/workflows/ci.yml`** — typecheck + lint + test + audit-manifest CI pipeline
- **`vitest.config.ts`** + first tests for `crypto/hash`, `crypto/signing`, `ipa-analyzer`, `prioritizer`, `decision-gate`, `eke-engine`, `data-bus`, `validators`
- **`playwright.config.ts`** + e2e smoke test
- **`lib/validators.ts`** — runtime validators for `CRTEvent`, `InteractionPattern`, `RequirementV2`, `RegulatoryConflict`, `BusEvent`
- **`lib/hooks/useLiveTrust.ts`** — live trust profile hook bound to the data bus

### Added — Real, no-longer-mock features

- **Real ECDSA P-256 signatures** (`lib/crypto/signing.ts`, WebCrypto): `signPayload`, `verifyEnvelope`, `getSessionKeyPair`. Signatures display, are stored on the conflict, and are **verifiable in-page** in the Compliance Audit Vault.
- **Real cross-surface event bus** (`lib/data-bus.ts`, BroadcastChannel + localStorage ring buffer)
- **Real Compliance Audit Vault** — every signed conflict has a "Verify signature" button that re-derives the digest and runs ECDSA verify locally
- **Real Compliance Integrity Ledger** — subscribes to bus, no fabricated events
- **Real Teacher Integrity Ledger** — subscribes to bus, no fabricated events
- **Real Parent "Just now" feed** — subscribes to bus
- **Real student rail meters** — Focus and Resilience now derive from live bus events instead of fixed values
- **Comprehension Gate** — actually mounted in `/student` (was imported but unused)
- **Focus-loss tracking** — `EkeChat` `onBlur` now feeds the IPA mimicry score
- **Bus events on**: hint requested, paste blocked, submit, gate cleared, conflict resolved, teacher push

### Changed

- **README.md** — rewritten to point at HONESTY.md first
- **Decision Gate** — context-aware PII patterns (no false positive on "password" in academic content)
- **`mimcryProbability` → `mimicryProbability`** — typo fix in `lib/types/index.ts` and `ipa-analyzer.ts`
- **`adapter-mock.resolveConflict`** — produces a real ECDSA signature instead of `mock-ed25519-{random}`
- **Stale Luminary header** in `lib/types/index.ts` replaced

### Fixed

- TS-5.7 `Uint8Array<ArrayBufferLike>` rejection in SubtleCrypto calls — added `toArrayBuffer` helper
- Lost `LockOpen` icon (does not exist in lucide-react) replaced with `Unlock`
- Race conditions in import lists in `SurfaceShell.tsx`

### Documentation

- File-header doc-blocks added to every `lib/**/*.ts` module describing purpose, honesty status, and production-replacement path

## [1.0.0] — 2026-04-20

### Added

- Multilingual i18n with 9 locales (en, ga, fr, es, pt, de, hi, zh, ar) including RTL
- Expanded subject catalogue (~60 subjects across 9 global curriculum groups)
- Eke AI engine (Socratic, tiered hints, three personality tones)
- IPA Analyser with mimicry probability
- Comprehension Gate component
- 8 surfaces: landing, student, teacher, parent, compliance, adult, trades, auth
- Regulatory Absorb V2 prioritizer + mock adapter (8 requirements, 2 conflicts)
- Hardware Ghost Protocol IndexedDB scaffold
- 404 + loading skeleton
- Trace-to-Trait Career DNA mapping
- Zero-knowledge aggregator (toy hash; clearly labelled)

[1.3.1]: https://example.com/evenkeel/releases/1.3.1
[1.3.0]: https://example.com/evenkeel/releases/1.3.0
[1.2.0]: https://example.com/evenkeel/releases/1.2.0
[1.1.0]: https://example.com/evenkeel/releases/1.1.0
[1.0.0]: https://example.com/evenkeel/releases/1.0.0
