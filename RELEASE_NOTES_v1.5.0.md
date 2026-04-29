# Even Keel Learning v1.5.0 — Signed content authoring pipeline

*Release date: 28 April 2026*

## Headline

The single biggest gap on this platform — disclosed in `HONESTY.md` §4.2
since v1.4.5 — was that the subject picker UI showed sixty-four tiles
but only one of them (`linear-eq-1var`) had real validated content
behind it. v1.5.0 closes that gap *in principle* by shipping the full
content authoring and distribution pipeline: an LLM-drafted, teacher-
reviewed, cryptographically-signed flow that lets new content reach
learners **without** breaking the v1.4.x trust contract.

The trust contract that mattered to schools, DSLs, and exam boards has
not moved a millimetre:

- **No model at learner time.** The Eke engine is still a deterministic
  state machine. The LLM operates only at authoring time, off-stage,
  drafting items that a qualified teacher must rewrite and approve
  before they are signed.
- **No unreviewed content shown.** The reviewer's approval click is
  the only path from `content/drafts/` into the served manifest.
  Items signed with a key not on the manifest's trusted-reviewers
  list are rejected at load time.
- **Every hint traceable.** Each approved item carries the LLM draft
  provenance (model, provider, prompt hash, draft timestamp) AND the
  reviewer fingerprint, name, approval timestamp, and ECDSA signature.
- **No learner text leaves the device.** The runtime registry only
  reads pre-authored, signed strings; it never sends learner text
  anywhere.

## What's new for the three audiences

### For Laura (and any subject teacher)

- A new `/author` surface lets you read every LLM draft, edit any
  field — problem, hints, explanation, misconceptions, worked
  examples — and click "Approve & Sign". Your edit is what learners
  see; the LLM provenance is preserved separately for transparency.
- After a learner gets a wrong answer, Eke now follows up with a
  targeted *plain-English explanation of the slip they just made*,
  drawn from the misconceptions you approved. After a learner gets it
  right, Eke shows the post-attempt explanation so they see why the
  method works.
- Curriculum mapping is finally in the schema: every item carries
  spec-point references against AQA, Edexcel, OCR, CCEA, SQA, DES JC,
  or any other awarding body. The seed maths item is already mapped
  to AQA GCSE `A17` and DES JC `AF.1`.

### For school leaders and MAT directors

- New `npm run content:build` script signs every approved pack and
  emits a single signed manifest at `public/content/manifest.json`.
- The trusted-reviewers list inside the manifest tells you, by
  fingerprint and display name, exactly who approved which content.
  This is the audit trail an exam board would ask for.
- Pack hashes are deterministic, so two manifests built from the
  same approved content produce byte-identical bytes (modulo the
  `builtAtIso` timestamp). Reproducibility receipts can be regenerated
  the same day.

### For developers

- `lib/content/schema.ts` is the source of truth for the content
  shape. Pure validators with no I/O, deterministic canonical-hash
  helper, no runtime dependency on a model.
- `lib/content/registry.ts` is the browser-side loader. Additive by
  design: if the manifest is missing or rejected, the platform runs
  exactly like v1.4.11 and the engine falls back to the v1.4.5
  hand-written `parallel-problems.ts` corpus.
- `scripts/author-draft.mjs` is provider-pluggable. The default `mock`
  provider produces clearly-labelled placeholders so the pipeline runs
  with no API key. Set `LLM_PROVIDER=anthropic` (or `openai`) plus
  the corresponding API key env var to use a real provider.

## Honest gaps (read these before piloting)

- **Content breadth.** v1.5.0 ships *one* fully-migrated, enriched
  maths skill family. The 63 other tiles still need a teacher to
  draft+approve content. The pipeline does not write content; it
  distributes it.
- **Reviewer signing key.** Currently a per-tab session key. The
  `/author` UI labels this "session-demo" until a reviewer enrols a
  passkey and the UI is wired to call `signPayload(..., { keySource:
  "passkey" })`. Phase 2 follow-up.
- **`/api/author/approve` auth.** Demo-grade. UI-side passphrase only,
  no server session. Production deployments must put this endpoint
  behind a real session bound to the reviewer's enrolled passkey
  before any classroom rollout. Captured in `SAFEGUARDING.md` §3.
- **Non-numeric answer checking.** The schema accepts string answers,
  but the runtime answer-checker is still numeric-only. English
  short-answer / MFL spelling tolerance is a v1.5.x roadmap item.

## Migration notes

- Existing `lib/eke/parallel-problems.ts` corpus is unchanged. The
  registry sits alongside it; surfaces that don't load the manifest
  see no behaviour change.
- `app/student/page.tsx` already declares `skillFamily="linear-eq-1var"`
  and `problemId="ie-jc-maths-linear-eq-001"`, so once
  `npm run content:build` has run, the new misconception and
  explanation messages start surfacing automatically. No surface code
  change required.
- `package.json` exposes two new scripts: `content:build` and
  `content:draft`.

## Verification

```powershell
# 1. Run the build (signs the seed maths pack, writes manifest)
npm run content:build

# 2. Run the schema and signing tests
npx vitest run tests/unit/content-schema.test.ts tests/unit/content-manifest.test.ts

# 3. Run the full suite
npm run test:run

# 4. Start the dev server, open http://localhost:3001/student,
#    type a wrong answer (e.g. "x = 5") and watch the misconception
#    teaching message appear; then type the right answer (x = 6) and
#    watch the explanation message appear.
npm run dev
```

## Files added

- `lib/content/schema.ts`
- `lib/content/registry.ts`
- `content/packs-raw/maths.linear-eq-1var.mjs`
- `scripts/build-content-manifest.mjs`
- `scripts/author-draft.mjs`
- `app/api/author/drafts/route.ts`
- `app/api/author/approve/route.ts`
- `app/author/page.tsx`
- `tests/unit/content-schema.test.ts`
- `tests/unit/content-manifest.test.ts`

## Files changed

- `package.json` — version bump 1.4.11 → 1.5.0; added
  `content:build` and `content:draft` scripts.
- `components/shared/EkeChat.tsx` — runtime wiring for misconception
  and explanation surfacing after categorised attempts.
- `lib/auth/role-guard.ts` — added `"author"` role.
- `CHANGELOG.md` — full entry for 1.5.0.
- `HONESTY.md` — §4.3 added; §4.2 updated to reflect the closed-in-
  principle gap.
- `docs/PROPOSAL_TRUTH_PACK.md` — item 19 added.
- `docs/PROPOSAL_FOR_LAURA.md` — proposal updated with the new
  pipeline narrative and Laura-as-reviewer story.
- `SAFEGUARDING.md` — §3 expanded to cover the `/api/author/approve`
  auth gap; new §1.11 covering signed content packs.
