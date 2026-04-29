# Proposal Rewriter Notes — meta-instructions for regenerating the .docx

> **Audience:** whoever (Claude with the docx skill, a future build script,
> or a human) regenerates `Luminary cofounder proposal.docx` from
> `@./PROPOSAL_TRUTH_PACK.md`.
>
> **Why this file exists separately.** The truth pack is *content*. This
> file is *meta* — tone, framing, what to drop, what to keep, where the
> pull-quote belongs. Mixing them in one file would mean a careless paste
> could drop these notes into the proposal itself. Keeping them apart is
> a structural fix to a class of accidents.

---

## How to use this file together with the truth pack

1. Read the truth pack section markers
   (`<!-- truth-pack:section-a:start -->` … `:end -->`).
2. Pull the content of each section through
   `@../scripts/extract-truth-pack-section.mjs` (or paste manually).
3. Apply the framing notes below to position those sections inside the
   .docx alongside the existing chapters that don't change (cover, team
   bios, pricing matrix, decision-making, regional pricing, etc).

The truth pack sections replace specific existing sections of the
proposal — every section header in the truth pack says which one
("(replaces the existing X section verbatim)").

---

## Framing rules for the rewrite

- **Drop "live AI tutor powered by Claude".** It was never true. The
  current architecture is template-driven and that is a stronger pitch
  than fake-LLM, not a weaker one.
- **Drop "working safety controls" as a vague phrase.** Replace with
  the specific 17-pattern Decision Gate plus false-positive tests
  (Shakespeare's theme of suicide / chef's-knife emoji in a recipe both
  pass through unblocked).
- **Keep the eight-layer architecture diagram.** It is accurate as a
  forward-looking spec; just label it as such, not as "today".
- **Keep the LLM routing matrix.** It is the right shape for Phase 2B;
  place it under the Phase 2 chapter, not under "what exists today".
- **Add "no LLM in the hot path" as a pull-quote** somewhere on page 2
  or 3. It is the strongest single line in the whole pitch and reads
  cleanly as a callout.
- **The "one bad assessment away from a procurement freeze" line in
  §B** is also pull-quote material. Either-or, not both — pick whichever
  fits the page layout better.
- **Honest engineering pitches better than aspirational vapour.** The
  rewritten "What's already built" section is *more* impressive than the
  original because every item in it is a green test, not a promise.
  Don't soften the numbers — `94 tests across 13 files`,
  `17 regex patterns`, `8 surfaces`. Those numbers do work.

---

## Phase 2C is special — handle with care

The truth pack §C now treats Phase 2C as a commitment with five
preconditions, not a roadmap item. **Do not collapse those preconditions
into a single bullet during rewriting.** If the .docx has page-budget
pressure, drop a Phase 2D item before you compress 2C — the 2C
preconditions are doing real work as a public commitment that anyone
piloting the platform can hold us to.

---

## What to do if the truth pack and proposal have drifted

If you read the truth pack and find a claim that contradicts something
written in the existing .docx (e.g. test counts, version numbers, file
paths), the truth pack wins. The truth pack is regenerated alongside
code changes; the .docx is regenerated from the truth pack.

If a section in the .docx isn't covered by any truth-pack section, leave
it alone. Truth-pack only owns the sections explicitly marked
"(replaces the existing X section verbatim)".

---

*Last updated: v1.4.9 — 2026-04-27.*
