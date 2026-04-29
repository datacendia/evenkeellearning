# Even Keel Learning

> Design-complete front-end prototype of a Socratic learning OS. Real UI, real
> multilingual support, real cryptographic primitives, honest simulation
> backends for every data feed. **Not a product yet — a very polished demo.**

## Read these files, in order

1. **[`HONESTY.md`](./HONESTY.md)** — what is real, what is mocked, what is
   aspirational. Written for you, not for investors. Read it first.
2. **[`SAFEGUARDING.md`](./SAFEGUARDING.md)** — child-safety policy: crisis
   detection, role guard, age-band gate, accessibility commitments, DSL
   incident response.
3. **[`reports/PLATFORM_AUDIT.md`](./reports/PLATFORM_AUDIT.md)** — second-pass
   narrative audit with framework-level control mapping (SOC 2, ISO 27001,
   GDPR, COPPA).
4. **[`SECURITY.md`](./SECURITY.md)** — vulnerability disclosure policy.
5. **[`EVENKEEL_BIBLE.md`](./EVENKEEL_BIBLE.md)** — the product vision. This
   is aspirational. Treat it as a spec for where the code is going, not a
   description of what it does today.
6. **[`docs/PROPOSAL_TRUTH_PACK.md`](./docs/PROPOSAL_TRUTH_PACK.md)** —
   versioned source-of-truth for the cofounder / investor proposal.
   Regenerate the .docx from this file, never the other way around.
7. **[`docs/SR-TEST-PLAN.md`](./docs/SR-TEST-PLAN.md)** — manual screen-reader
   test scripts (NVDA / JAWS / VoiceOver) that complement the automated
   axe-core checks.
8. **[`CHANGELOG.md`](./CHANGELOG.md)** — per-version delta.
9. This README — just quick-start.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Node **20+** is required (`.nvmrc` pins to 20).

## Verify before you ship

```bash
npm run typecheck            # tsc --noEmit
npm run lint:strict          # next lint --max-warnings 0
npm run test:run             # 94 vitest assertions across 13 files
npm run e2e                  # Playwright suite (incl. tests/e2e/a11y.spec.ts axe across 8 surfaces)
npm run audit:offline        # writes evidence/test-manifest-*.json
npm run audit:report         # renders reports/AUDIT_REPORT.md from the latest manifest
npm run audit:strict         # all of the above + HTTP smoke (needs dev server) + non-zero exit on fail
```

Every audit run emits a Datacendia-shaped JSON manifest to `evidence/`. Each
record is tagged with the SOC 2 / ISO 27001 controls it evidences — see
[`reports/COMPLIANCE_CONTROL_MAP.md`](./reports/COMPLIANCE_CONTROL_MAP.md).

## What runs today

| Path | Audience | Theme | What works end-to-end |
|---|---|---|---|
| `/` | Landing + role picker | Paper | Full i18n; stats are partly aspirational (see HONESTY.md §2.4) |
| `/student` | K-12 students | Paper | Socratic chat · live trust meter · comprehension gate · persisted prefs |
| `/adult` | Adult learners | Paper | Peer-tone Eke chat |
| `/trades` | Apprentices | Paper | Foreman-tone Eke chat (voice + camera buttons are decorative) |
| `/parent` | Parents | Paper | Listens to the cross-tab data bus for live student events |
| `/teacher` | Teachers | Sovereign | Box-in-Box CRT viewer with mock student nodes; push buttons are wired to the bus |
| `/compliance` | Compliance Officer | Sovereign | Real Most-Restrictive prioritizer against the mock adapter seed data |
| `/auth` | Role picker | Paper | Styled step-picker; the button is labelled "(demo)" — no WebAuthn call |

## Languages supported

English · Gaeilge · Français · Español · Português · Deutsch · हिन्दी · 中文 · العربية (RTL)

Click the 🌐 chip in any header to switch. Preference persists across routes via `localStorage`.

## Architecture map

```
                ┌────────── Surfaces (Next.js App Router) ──────────┐
                │   /student  /teacher  /parent  /compliance  ...   │
                └──────┬─────────────┬──────────────┬───────────────┘
                       │             │              │
                   Eke AI     VertoLearn CRT   Regulatory Absorb V2
                  (templates)  (hash+sign+log)   (types + prioritizer)
                       │             │              │
                       └─── Decision Gate ──────────┘
                                     │
                       Hardware Ghost (IndexedDB)
                                     │
                              Data Bus (BroadcastChannel)
                                     │
                      Cross-surface live events, same browser
```

## Project layout

```
app/                    Next.js pages (one per surface) + loading / not-found
components/shared/      SurfaceShell, EkeChat, ComprehensionGate, i18n switcher …
lib/
  eke/                 Socratic engine — tiered hints, tones, decision-gate hook
  vertolearn/           CRT logger, IPA analyser, neutrality shield, Hardware Ghost
  regulatory-absorb/    Types, Most-Restrictive prioritizer, decision gate, mock adapter
  career/               Trace → Career-DNA trait mapping
  zero-knowledge/       Aggregator (toy; see HONESTY.md §4.4)
  crypto/               SHA-256 proof-of-work + ECDSA P-256 sign/verify (WebCrypto)
  data-bus.ts           Cross-surface event bus via BroadcastChannel + localStorage
  i18n/                 Dictionary (9 locales) + React provider
  types/                Canonical TypeScript interfaces
HONESTY.md              Per-file ledger of what is real vs mocked
EVENKEEL_BIBLE.md      Product vision (aspirational)
```

## Principles enforced by code (not marketing)

- **No direct answers.** There is no LLM in the bundle. `lib/eke/tiered-hints.ts`
  serves templates and a validator guarantees no hint contains the answer key.
- **Answer validation never leaks the answer.** *(v1.4.0)* The deterministic
  checker in `lib/validation/answer-checker.ts` categorises a learner's
  numeric attempt (`correct` / `off_by_one` / `sign_flipped` / `doubled` /
  `halved` / `wrong`) and Eke replies with a Socratic redirect. A
  brute-force test pins that the expected value is never written into
  any returned hint, and the engine re-checks via `hintContainsAnswer`
  before committing the reply.
- **Crisis-language handoff.** `decision-gate.ts` short-circuits before any
  other response and returns a Childline message. 17 regex patterns plus
  an emoji-affect rule, with false-positive tests pinned
  (Shakespeare's theme of suicide / chef's-knife emoji in a recipe pass
  through unblocked).
- **No biometrics.** No `mediaDevices` call anywhere. No FIDO2 with
  `userVerification: "required"`. Grep for it.
- **No advertising.** No ad script tags.
- **No tracking.** No analytics library imported.
- **Zero-paste in chat.** `onPaste={e => e.preventDefault()}` by default.
- **Privileged surfaces are gated.** `/teacher` and `/compliance` are
  wrapped in a passphrase role guard with constant-time SHA-256 compare
  and a 400 ms cooldown on failure (demo only — Phase 2 swaps in
  WebAuthn). `/student` is wrapped in an age-band gate with under-13
  guardian acknowledgement.
- **WCAG 2.2 AA chrome.** Skip link, semantic landmarks, ARIA labels,
  44×44 hit targets, `prefers-reduced-motion` / `prefers-contrast` /
  `forced-colors` honoured. Verified by axe-core across all 8 surfaces.

## Scripts

```bash
npm run dev     # http://localhost:3000
npm run build   # production build (requires fixing TS-5.7 strict buffer types first)
npm run start   # serve the production build
npm run lint    # next lint
```

## Known limitations

See `HONESTY.md` §4 for the full ledger. Short version:

- The role guard is a passphrase, not WebAuthn (Phase 2).
- The age-band is self-declared, not COPPA §312.5-verified (Phase 2).
- There is no learner-facing LLM and no answer-generation code path —
  this is **deliberate**, not a gap. Rationale and Phase 2 plan in
  `CHANGELOG.md` v1.4.0 and `docs/PROPOSAL_TRUTH_PACK.md` §B.
- Answer validation is scoped to numeric-result problems. Symbolic
  answers, multi-step proofs, essays, and code correctness are
  explicitly out of scope.
- Teacher / Parent / Compliance dashboards combine real types with
  seeded content; every seeded item is labelled as such in HONESTY.md.
- Cross-surface sync is single-browser, single-device (BroadcastChannel
  + localStorage). Cross-device sync is Phase 2.
- The cloud-sync story is IndexedDB + a 100 ms fake upload.
- Subject labels intentionally do not translate (only the surrounding
  chrome does).
- The axe `color-contrast` rule is currently scoped out of CI — see
  `CHANGELOG.md` v1.3.1 "Known follow-up".

## License

Proprietary. © 2026 Even Keel Learning.
