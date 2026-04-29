# Even Keel Learning — A note for Thomas Dowling

*From Stuart Rainey · Datacendia / Even Keel Learning · April 2026*

Thomas — you run Computing at ATU, you've published on machine-learning architectures and on teaching programming with growth-mindset gamification, and you've watched the GenAI assessment crisis hit higher education harder than almost any other sector. You've probably already seen twenty pitches for *"the AI tool that won't let students cheat."* So have I. **This isn't another one of those.** The whole point of what I've built is that it works without an AI in the part that talks to your students, and the safety-critical paths are short enough to read — the architecture is **provable-by-grep**, not a vendor's promise.

Here's what it actually is, in one paragraph.

Even Keel is process-of-work infrastructure for higher education. It runs in the student's browser. It teaches the way a good demonstrator does — three small hints, then a worked example with different numbers, then *"now you try."* There is no chat-bot under the bonnet, so there is nothing to make up an answer and nothing to hallucinate. Coursework provenance is built into the engine, not bolted on afterwards. And every claim I make about it can be checked — there's a public *"honesty document"* (`HONESTY.md`) in the codebase that lists what's real and what isn't.

## What you'd see as Head of School

You already know how every existing AI-integrity tool fails: the student types the question in, copies the reply, ticks the box, and the assessment becomes meaningless. You can't trust the work, can't grade it fairly, can't even tell if they understood any of it. And the *"solutions"* — Turnitin's AI detector and friends — accuse real students often enough to generate the kind of false-positive incidents that end careers and trigger appeals.

Even Keel was designed to remove that whole frame.

**It cannot give the answer.** Not *won't* — *can't*. There's no LLM inside it to generate one. Hints come from a small hand-written library, like a demonstrator's prompt cards.

**It recognises the kind of mistake the student is making.** If a first-year flips a sign in a derivation or makes an off-by-one slip in a loop trace, the engine notices the *category* of error and asks a Socratic question pointed at that mistake — without ever showing the corrected value on screen.

**There's a "now I'll do one with you" move.** When three hints aren't enough, the platform serves a fully worked example walking through the algorithm end-to-end, then hands the original problem back. Crucially, this isn't just *"same shape, different numbers"* — if the student has failed all three hints, the cause is almost never that different numbers will help. It's that the *process* hasn't landed. The platform serves a **simpler structural variant first** (one inverse operation instead of two; a single-digit long division before a multi-digit one), only stepping back up to the original after the procedure is sound. *"Same numbers, harder algorithm"* is the wrong scaffold; *"simpler algorithm, then the same algorithm again"* is the right one.

**You'd see a live Integrity Ledger.** As your students work, you'd see — per student — how many hints they needed, which comprehension questions they cleared, whether they pasted anything in, and whether the engine flagged anything. You'd never see what they typed. Just the shape of how they worked.

**Comprehension Gate.** Before a topic counts as *"done,"* the student has to answer a few questions about *why* the method works, not just whether they got the number right. Wrong answers come with explanations and a chance to try again — never the answer.

**Signed receipts.** When a student finishes a problem, they can issue a small *"receipt"* — a link recording what was solved, how many tries, which hints, how long, and a cryptographic hash that proves the receipt hasn't been edited since they made it. Open the link, click Verify, and the page confirms it in your browser. No log-in. No vendor account. Designed with coursework provenance in mind from the first commit.

## Why no LLM in the hot path is the right call (the conviction case)

This is the question you'll probe hardest, so I'm going to lead with the answer rather than bury it. There are seven reasons the no-model architecture is a feature, not a limitation:

1. **Hallucination is unsolved.** Frontier models in 2026 still hallucinate ~3–5% of factual claims even with retrieval-augmented generation. For a first-year derivation hint, that's roughly 1 in 25 hints subtly wrong. One wrong hint about loop-invariant reasoning creates a misconception that costs a fortnight of remedial work. A finite, hand-authored hint corpus is bounded and checkable; a model is neither.
2. **The pedagogy of an LLM is structurally wrong for a Socratic engine.** A model's reward signal is *be helpful*. A demonstrator's job is to make the student derive the answer. These are opposed *telos*. Every learning-science principle worth the name — desirable difficulty, productive struggle, retrieval practice — is undermined by an agent that defaults to explanation. No prompt-scaffolding fixes this.
3. **The provable-by-grep posture only works if the architecture earns it.** Adding a model "just for explanations" collapses the trust contract. The reason DPOs, external examiners, and QQI will eventually take this platform seriously is that the safety-critical paths are short enough to read. That property is binary — you have it or you don't.
4. **The reproducibility argument.** Same student, same problem, two weeks apart: the model's response varies with temperature, version drift, fine-tune updates. The hand-authored hint is byte-identical. **A signed receipt that says *"the student saw hint tier 2"* means the same thing in March and in September.** With a model, *"the student saw a hint"* means whatever the model felt like that day. For external-examiner moderation this is the difference between admissible and inadmissible.
5. **The economic argument.** LLM inference per learner per session at scale is the dominant cost line item for every AI-tutor competitor. Even Keel's runtime cost is approximately zero — a static signed manifest fetch plus browser-side compute. Pilot economics for ATU come out at roughly £8 per learner per *year*, not per month, because there is no per-call cost.
6. **The honesty premium.** Every Head of School has been burned by at least one LLM hallucination headline this academic year. Even Keel's pitch is *"there is nothing in our system that can produce one."*
7. **Where the LLM does belong.** Authoring time, off-stage. v1.5.0 ships a content authoring pipeline (next section) where an LLM drafts a candidate problem, three hints, an explanation, named misconceptions, and parallel worked examples — but it does so into a draft queue. A lecturer rewrites whatever needs rewriting and signs the result. **The LLM never touches the learner; the lecturer does.** That's the correct division of labour: model for the typing, human for the judgement.

## How content accuracy is actually ensured (the honest accounting)

I won't claim *100% accurate* because no system that purports to teach can be, and any vendor claiming so is lying. What I *can* defend is a stronger guarantee than any LLM-tutor competitor offers.

What v1.5.0 enforces structurally:

- **Schema validation.** Every item is shape-checked — three hints, a substantive explanation, ≥1 worked example, a signed approval block. This is shape, not truth.
- **The reviewer's signature is the only path from draft to learner.** Accuracy responsibility sits on a named, qualified human (a lecturer, in your case) — because no algorithm can validate the truthfulness of a hint about Big-O. Accountability is the right answer; *"we automated it"* is not.
- **The trusted-reviewers list is published inside the manifest.** A DPO, an external examiner, a QQI auditor can see — by name and ECDSA fingerprint — who approved every item.
- **The answer-checker is independently hand-coded.** It is *not* derived from the same source as the hints. So a hint that points the wrong way and an answer-key that's wrong would have to be wrong in the same way to escape detection. A correct learner answer that the system marks wrong becomes an immediate signal — the failure mode is loud, not silent.
- **Sign-then-verify is tested end-to-end.** ECDSA-P256 with tampered-item rejection and wrong-key rejection. Any character changed in an approved item invalidates its signature; the registry rejects it and the engine falls back to the previous corpus. **Drift cannot ship.**

What v1.5.0 deliberately doesn't yet do, and what's planned:

- **Two-reviewer rule (v1.5.1).** Today one reviewer fingerprint is enough; v1.5.1 will require a primary plus a peer reviewer (two fingerprints) before an item ships.
- **Per-item regression tests (v1.5.1).** Every approved item should carry 2–3 sample (correct, wrong) answers regression-tested in CI. Catches drift if a hint or answer-key is edited mid-cycle.
- **Learner *report-this-hint* affordance.** Routes into the escalation queue with the item ID and reviewer fingerprint. Real-world correctness signal.

The honest claim, exactly worded: **every hint a learner sees is human-signed, traceable to a named reviewer, byte-frozen by the signature, and structurally incapable of being generated by a model. Mistakes that ship are human mistakes by named humans, fixable by name.**

## Why this is a fit for ATU specifically

ATU's Teaching and Learning Centre has spent the last cycle pushing staff to rethink assessment strategy — to keep integrity without blindly banning the technology. The Irish HEA's national framework now demands *"human oversight and AI literacy"* as first-class outcomes, not slogans. QQI is going to be asking the same questions of every Irish institution within the next academic year.

Even Keel isn't another LLM tool you'd have to govern; it's a piece of compliance infrastructure that gives the School of Computing a defensible answer to *"how do you know this graduate actually did the work?"* The Integrity Ledger and the signed receipts give you a verifiable record of process — exactly the artefact ATU's quality framework and any future external audit will want.

Three things make this an ATU-shaped fit specifically, not a generic HE pitch:

- **Computing-led, not Computing-friendly.** The product's position on copy-paste (below) only makes sense if you've actually written software. Most EdTech assumes pasting is fraud. In a Computing degree it's the workflow.
- **Process-over-output assessment.** Aligns with the design philosophy you've written about for teaching programming — making effort and reasoning *legible*, not just final answers.
- **Provable-by-grep transparency.** The kind of evidence a computer scientist will actually trust: short safety-critical paths, a public manifest of what is and isn't in the code, every item carrying a verifiable signature back to the human who approved it.

## The coding-specific bit

You'll have already noticed the obvious problem with most AI-integrity tools applied to a Computing degree: pasting between files, between editor and terminal, between Stack Overflow and one's own scratchpad, *is* programming. Any tool that treats paste-as-fraud is unfit for purpose in your School.

Even Keel's position on copy-paste is structural, not cosmetic. By scenario:

- **Programming work — never block paste.** Pasting is the normal workflow. The Integrity Ledger still counts pastes and shows the pattern (size, timing, surrounding cadence) so the lecturer has a signal — but the signal is decoration on the assessment, not a verdict from the platform.
- **Short-answer or numeric work on the chat rail — block, hard.** This is the exact fraud the rail is designed against. Already shipping.
- **Long-form writing — never block, count and surface.** Students draft in Word and paste in. That's normal.
- **Citations and quotes — route through a *paste as quote* button** so it's clear when the prose isn't theirs.
- **Students using dictation, switches, or eye-gaze input.** Steady-cadence typing isn't treated as suspicious for them; pasting is still counted because pasting is a deliberate action whatever the input device. The message is gentler — a note, not a flag. WCAG 2.2 AA is the design target, in nine languages including Irish.

The principle: the platform should always *count* pastes; it should only *block* them where pasting is structurally incompatible with the task. Anywhere else, surface the signal in context and let the lecturer make the call.

## The anti-detector pragmatism

I don't ship an *"AI detector,"* and I won't. Every credible study on the current generation of detectors shows false-positive rates that are unacceptable in a degree-awarding context. A wrongly-accused student is the kind of incident that ends a pilot — and in higher education, generates appeals, ombudsman complaints, and headlines.

What I ship instead is a **trust meter** — a green/amber/red light that combines paste pressure, steady-cadence typing (*"typing along while reading another tab"*), and tab-switching (*"alt-tab, paste, alt-tab back"*) into behavioural evidence the lecturer can act on. That's behavioural evidence, not forensic identification. The platform never accuses; it surfaces. The verdict stays with the academic.

## A Wednesday afternoon, a first-year lab

A student opens the platform. They pick a tone of voice — mentor (calm and patient), peer (sounds like the lab partner two seats over), or foreman (no-nonsense, like a senior dev on a code review). They start a problem — say, isolating a variable in a recurrence-relation closed form, the kind of small algebraic step that sits inside half the algorithms problems they'll meet in semester one.

They get stuck. They tap *Hint*. The platform says *"start by writing what's currently being done to the variable, in order."* They get stuck again — Tier 2 — *"two operations are attached to it; which inverse undoes which?"* They have a go, get the order wrong, type their answer. The engine spots the slip and says *"check whether the constant should come off first or second"* — without ever showing the right number.

They're still stuck. Tier 3. Still stuck. The platform serves the **simpler structural variant** first — the same shape with one operation removed, walked through end-to-end so the algorithm itself lands — *then* hands them a same-shape parallel and finally the original. They solve it. They tap *Issue receipt*. The link goes into their submission alongside their code.

You open the receipt during marking. You see: 3 hints used, simpler-band warm-up consumed, same-band parallel consumed, comprehension gate cleared on second attempt, 47 minutes of think-time, no anomalous paste activity. You know what kind of work was done — and you have a signed, verifiable artefact saying so.

Computing-specific content like recurrence relations, complexity proofs, and loop-trace problems would be authored alongside an ATU lecturer in the first weeks of a pilot — see *Subject coverage* below.

## Subject coverage — the honest version

You'll spot this within thirty seconds of clicking around, so I'll get out in front of it. The student page has a subject picker showing about 60 subjects, including the obvious Computing ones — programming, discrete maths, algorithms, data structures. That picker is the *shape* of where the platform is heading; the engineering for content distribution is now solved, and the *partnership offer* is co-authoring the Computing canon.

**v1.5.0 ships the authoring pipeline.** An LLM drafts a candidate problem, three Socratic hints, a plain-English explanation, named misconceptions, and one or two parallel worked examples — off-stage, into a draft queue. The lecturer opens `/author`, reads the draft, rewrites whatever needs rewriting, and clicks *Approve & Sign*. The item is canonicalised, ECDSA-signed with the lecturer's reviewer key, and published into the signed manifest the learner's browser verifies. Every hint a student then sees in that topic carries that lecturer's fingerprint, not a model's. v1.5.0 ships with one fully-migrated maths skill family (linear equations, with explanations, four named misconceptions, and difficulty-banded parallels) **plus a non-Maths seed pack** — AQA English Paper 1 Q3 (structure analysis) — chosen specifically to demonstrate the pipeline isn't subject-locked.

For Computing-specific content the schema already accommodates everything secondary and most of undergraduate: numeric answers, qualitative-marked items, multi-step proofs, cross-board spec-points. **What it doesn't yet do** is symbolic equivalence checking (e.g. recognising `(x+1)(x+2)` ≡ `x² + 3x + 2`); that's a two-day Pyodide+Sympy spike, scoped, no architectural risk, the kind of thing a pilot would scope into week 2 rather than week 1.

A pilot inside ATU's Computing programme is the right place to author the first Computing-specific content alongside academic staff who teach the modules. That's phase one of the partnership, not a precondition for it.

## Three questions you'd reasonably ask

**"Does it track time-on-task?"**
Per problem, yes. Per assignment or team assignment, not yet. Every problem session records start time, finish time, total think-time between keystrokes, deletions, and the steps the student took. Assignment-level and team-assignment concepts need a back-end which is the next phase. The smallest honest fix in the meantime is to surface time-on-task to academic staff and add it to the receipt — about half a day of work, shippable for a pilot.

**"Can it tell if an answer was pasted from a frontier model?"**
It detects that a paste happened. It does not — and does not claim to — prove the source was an AI. The chat box blocks pastes by default in scenarios where pasting is fraud, counts every attempt, and combines paste pressure with cadence and tab-switching into the trust meter. Behavioural evidence, not forensic identification. As covered above, I deliberately don't ship an AI detector — and a Computing department is exactly the audience that should appreciate why.

**"What about banning copy-paste — globally?"**
The honest position: block it where it doesn't belong, count it everywhere, accuse never. The matrix earlier (programming / numeric / long-form / quotes / accessibility) is the structural answer. Copy-paste is an integrity tool, not a discipline tool.

## What it doesn't do today

Short list, on purpose. It's also why the rest of this document is trustable.

- **No AI in the bit that talks to your students.** That's the point, not a gap.
- **No persistent back-end for learner data.** That's the privacy property — there is no server we send conversations to, so there is no library of student work to leak, lose, or be subpoenaed for. v1.5.0 *does* add a build-time author endpoint that the *reviewer* uses to approve content; nothing on it ever touches student data, and it's not exposed to the open internet. Pilot integration with ATU rosters and SSO is the next phase.
- **Computing-specific skill content is to be co-authored with an ATU lecturer.** The pipeline is ready; the curriculum content is the partnership offer.
- **Symbolic answer-checking** (e.g. `(x+1)(x+2)` ≡ `x² + 3x + 2`) is a two-day spike, not yet shipped.
- **Essay grading is deliberately not built.** Until it can mark reliably, it shouldn't.
- **No SSO into ATU identity yet** — also next phase. Receipts function without it; full-cohort rostering needs it.

Every one of these is in the public honesty document.

## What a pilot at ATU could look like

The platform is designed around the smallest possible useful shape:

1. **One module, one year group, one lecturer.** A first-year Computing module with a strong process-over-output assessment fits best — algorithms, programming fundamentals, or discrete maths.
2. **Two to four weeks of formative work.** Students use it as part of weekly lab tasks; the lecturer checks the Integrity Ledger.
3. **One signed receipt per completed problem set.** At the end of the pilot, the lecturer accepts (or declines) one piece of work purely on the basis of a receipt — the smallest *"the system was trusted to attest something"* event.
4. **One transparency-bundle hand-off** to ATU's DPO and Academic Affairs at the end.
5. **One co-authored skill family of Computing-specific content,** written during the pilot with the module lecturer through the v1.5.0 `/author` flow — so the artefact you keep at the end isn't just a pilot report, it's a signed body of curriculum content under the lecturer's reviewer fingerprint.

That last point matters: the pilot doesn't just use the platform; it produces the first piece of validated higher-education Computing content, which becomes the template for the rest of the curriculum at ATU and beyond.

## Next step

If this looks worth your time, the simplest next step is a 30-minute screen-share where I walk you through:

1. **The student rail** — one problem, three hints, the simpler-band parallel, the same-band parallel, the receipt.
2. **The lecturer view** as the same problem is being solved.
3. **The provenance pipeline** — one signed receipt, verified end to end in your browser.
4. **The `/author` surface** — I'd hand you a draft problem in your subject and you'd approve it under your own reviewer key, in real time. That's the partnership shape, not a marketing demo.
5. **The transparency bundle** — the file ATU's DPO and Academic Affairs would actually receive.

Everything in those five steps is shipping today and reproducible from a clean install on your laptop. I can come to Letterkenny, or we can do it remotely — whichever lets you get the most other eyes on the screen.

---

Stuart Rainey  ·  Datacendia / Even Keel Learning
stuart.rainey@datacendia.com

The honesty document this note is built on is called `HONESTY.md` and lives in the codebase. Nothing in this note claims anything that isn't sitting in that file.
