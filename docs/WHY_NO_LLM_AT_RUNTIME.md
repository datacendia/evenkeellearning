# Why no LLM at runtime is the right call

*The conviction case for the Even Keel Learning architecture, and the
honest accounting of how content accuracy is enforced without one.*

This document exists because the question *"why don't you just use an
LLM for the explanations / hints / tutoring?"* will be asked of every
proposal Even Keel Learning sends — and the answer should be the same
across every audience (parent, DSL, MAT director, Head of School,
exam board, regulator). What follows is the durable single source of
truth so individual proposals can reference it rather than re-litigate
the architecture each time.

---

## 1. The conviction case — seven reasons

### 1.1 Hallucination is unsolved and unsolvable for factual tutoring of minors

Frontier models in 2026 still hallucinate ~3–5% of factual claims even
with retrieval-augmented generation. For a maths hint that means
roughly **1 in 25 hints will subtly mislead a child**. One wrong hint
about order of operations, loop-invariant reasoning, or the
distributive law creates a misconception that takes weeks of remedial
work to undo. The cost asymmetry — between *getting one right* and
*teaching one wrong thing well* — is brutal. A finite, hand-authored
hint corpus is bounded and checkable. A model is neither.

### 1.2 The regulatory framework does not accommodate model-mediated tutoring of minors

- **COPPA §312.5** requires verifiable parental consent for any
  third-party transfer of children's data. Sending a 12-year-old's
  *"I don't get it"* to an LLM API is a third-party transfer.
- **GDPR Art. 8** plus the Irish DPC's child-protection guidance:
  child-directed processing must be lawful and proportionate.
  Sending learner text to a model for hint generation is neither.
- **EU AI Act Annex III §3** classifies AI systems used in
  educational training as high-risk. The cleanest mitigation is
  being demonstrably *outside* the loop, not inside it with
  disclaimers.
- **ICO age-appropriate design code** (UK) and the equivalent Irish
  Fundamentals: child-directed services must minimise data collection
  by default. An LLM call is a data-collection event.

The cleanest legal posture is: there is no model in the path that
talks to the child, so none of the model-specific clauses apply.

### 1.3 The trust contract is a structural property, not a vendor promise

A parent reading *"no model talks to your child"* can verify it with
`grep`. A parent reading *"we use AI safely"* can verify nothing.
The first is auditable; the second is faith. Schools, DSLs, exam
boards make procurement decisions on what they can audit.
**Provable-by-grep beats *"trust us"* every single time, with this
audience.**

This is also the property that lets the platform's safety claims
survive personnel turnover. The next person reading the codebase can
re-derive the safety guarantees from the source. They cannot
re-derive *"the model is fine-tuned to be safe."*

### 1.4 The pedagogy of an LLM is structurally wrong for a Socratic engine

A model's reward signal is *be helpful*. A demonstrator's job is to
make the *student* derive the answer. These are opposed *telos*.
Every learning-science principle worth the name —

- desirable difficulty (Bjork)
- productive struggle (Hiebert & Grouws)
- retrieval practice (Roediger & Karpicke)
- the testing effect

— is undermined by an agent that defaults to explanation. No
prompt-scaffolding fixes this; the gradient is wrong.

Hand-authored hints, structurally incapable of revealing the answer
(no answer string is even *present* in a tier-1 hint), encode the
pedagogy in the **architecture**, not in a prompt that can be
jailbroken or drift on a model update.

### 1.5 The honesty premium

Every Head of School, every DSL, every MAT director the platform will
pitch to has been burned by at least one LLM hallucination headline
this academic year. The market is desperate for a vendor whose
credibility does not rest on the model not embarrassing them next
Tuesday. Even Keel Learning's *whole pitch* is *"there is nothing in
our system that can produce one."*

Adding a model "just for the explanations" or "just for the
end-of-topic summary" collapses the entire trust architecture. The
provable-by-grep claim is binary — you have it or you don't.

### 1.6 The economic argument

LLM inference per learner per session at scale is the dominant cost
line item for every AI-tutor competitor. Even Keel Learning's runtime
cost is approximately zero — a static signed manifest fetch plus
browser-side compute. Pilot economics for a school district come out
at roughly £8 per learner per **year**, not per month, because there
is no per-call cost.

This also means the platform survives a future where the leading LLM
vendors raise prices, change usage terms, or restrict child-directed
applications. Even Keel does not depend on any external API to keep
running for a learner who is mid-session.

### 1.7 Reproducibility and auditability

Same student, same problem, two weeks apart: the model's response
varies with temperature, version drift, fine-tune updates. The
hand-authored hint is byte-identical. **A signed receipt that says
*"the student saw hint tier 2"* means the same thing in March and in
September.** With a model, *"the student saw a hint"* means whatever
the model felt like that day.

For external-examiner moderation, exam-board audit, and any future
legal-discovery scenario, this is the difference between **admissible
and inadmissible evidence** of what the platform did during a
specific learner session.

---

## 2. The accuracy accounting — how content correctness is enforced without an LLM

The platform refuses to claim *100% accurate* because no system that
purports to teach can be, and any vendor claiming so is lying.
Instead it offers a *stronger guarantee than any LLM-tutor competitor
can make*. What follows is the honest accounting.

### 2.1 What v1.5.0 enforces structurally

1. **Schema validation.** Every item is shape-checked —
   three Socratic hints, a substantive (≥10-line) explanation, ≥1
   worked example, a signed approval block, a non-empty
   `expectedAnswer`. This is shape, not truth.
   See `@c:\Users\Stu\New folder\lib\content\schema.ts`,
   `validateContentItem` and `validateContentPack`.
2. **Reviewer-signed approval is the only path from draft to learner.**
   Accuracy responsibility sits on a named, qualified human (a
   teacher, a lecturer) — because no algorithm can validate the
   truthfulness of a hint about Pythagoras. **Accountability is the
   right answer; *"we automated it"* is not.**
   See `@c:\Users\Stu\New folder\app\api\author\approve\route.ts` and
   `@c:\Users\Stu\New folder\app\author\page.tsx`.
3. **The trusted-reviewers list is published inside the manifest.** A
   parent, an exam board, an external examiner can see — by name and
   ECDSA fingerprint — who approved every item. Auditability, not
   validation, but it's the right shape.
   See `@c:\Users\Stu\New folder\public\content\manifest.json`.
4. **Independent answer-checking.** The runtime answer-checker
   (`@c:\Users\Stu\New folder\lib\validation\answer-checker.ts`) is
   *not* derived from the same source as the hints. So a hint that
   points the wrong way and an answer-key that's wrong would have to
   be wrong in the *same way* to escape detection. A correct learner
   answer that the system marks wrong becomes an immediate signal —
   the failure mode is loud, not silent.
5. **Sign-then-verify is tested end-to-end.** ECDSA-P256 with
   tampered-item rejection and wrong-key rejection. Any character
   changed in an approved item invalidates its signature; the
   registry rejects it and the engine falls back to the v1.4.5
   hand-written corpus. **Drift cannot ship.**
   See `@c:\Users\Stu\New folder\tests\unit\content-manifest.test.ts`
   (3 tests) and `@c:\Users\Stu\New folder\tests\unit\content-schema.test.ts`
   (10 tests).
6. **Difficulty-banded parallels.** When a learner has failed all
   three Socratic hints, the platform serves a *simpler structural
   variant* (one inverse operation instead of two; a single-digit
   long division before a multi-digit one) before stepping back up to
   the original difficulty. *"Same numbers, harder algorithm"* is the
   wrong scaffold; *"simpler algorithm, then the same algorithm
   again"* is the right one. Authoring convention documented in
   `@c:\Users\Stu\New folder\content\packs-raw\maths.linear-eq-1var.mjs:99-146`.

### 2.2 What v1.5.0 deliberately doesn't yet do (Phase-2 work)

1. **Two-reviewer rule.** Today one reviewer fingerprint is enough.
   v1.5.1 will require a primary plus a peer reviewer (two
   fingerprints) before an item ships. Cheap to add — a schema field
   and a build-script gate.
2. **Per-item regression tests.** Every approved item should carry
   2–3 sample (correct, wrong) answers regression-tested in CI.
   Catches drift if a hint or answer-key is edited mid-cycle.
3. **Learner *report-this-hint* affordance.** Routes into the
   escalation queue with the item ID, item version, and reviewer
   fingerprint. Real-world correctness signal.
4. **Difficulty-banded parallels lifted to a schema field.** Today
   the convention is `id`-prefix-based (`linear-eq-1var-simpler-NNN`,
   `linear-eq-1var-NNN`, `linear-eq-1var-stretch-NNN`). v1.5.1 will
   add an explicit `band: "simpler" | "same" | "stretch"` field to
   the worked-example schema and teach the engine's parallel-selector
   to honour it automatically.
5. **Symbolic answer-checking** for higher-maths content. See
   `@c:\Users\Stu\New folder\docs\ROADMAP_HIGHER_MATHS.md`.

### 2.3 The exact honest claim

> Every hint a learner sees is human-signed, traceable to a named
> reviewer, byte-frozen by the signature, and structurally incapable
> of being generated by a model. Mistakes that ship are human
> mistakes by named humans, fixable by name.

That is a stronger and more honest guarantee than any LLM-tutor on
the market can offer. The v1.5.1 two-reviewer rule will tighten it
further.

---

## 3. Where the LLM does belong

Authoring time, off-stage, in a draft queue.

v1.5.0 ships a content authoring pipeline where an LLM (mock by
default; Anthropic / OpenAI when an API key is present) drafts a
candidate problem, three Socratic hints, an explanation, named
misconceptions, and one or two parallel worked examples — but it
does so *into a draft queue*, not into the platform. A reviewer
opens `/author`, reads the draft, rewrites whatever needs rewriting,
and clicks Approve & Sign. The item is canonicalised, ECDSA-signed
with the reviewer's key, and published into the signed manifest the
learner's browser verifies.

**The LLM never touches the learner; the reviewer does.** That is
the correct division of labour: model for the typing, human for the
judgement.

See `@c:\Users\Stu\New folder\scripts\author-draft.mjs`,
`@c:\Users\Stu\New folder\app\author\page.tsx`, and
`@c:\Users\Stu\New folder\SAFEGUARDING.md` §1.11.

---

## 4. Cross-references

- `@c:\Users\Stu\New folder\HONESTY.md` §4.3 — the v1.5.0 content
  authoring pipeline disclosure.
- `@c:\Users\Stu\New folder\SAFEGUARDING.md` §1.11 — the structural
  controls that enforce the trust contract.
- `@c:\Users\Stu\New folder\docs\PROPOSAL_TRUTH_PACK.md` §B —
  *"How it works without an LLM"* — the public-facing equivalent of
  this document.
- `@c:\Users\Stu\New folder\docs\ROADMAP_HIGHER_MATHS.md` — the
  open-source-only roadmap for symbolic answer-checking, LaTeX
  rendering, and geometric figures.
