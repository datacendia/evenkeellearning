# Even Keel Learning

## A note for Laura

*From Stuart Rainey · May 2026*

---

Laura — you're a teacher and a parent, so I've written this for
both halves of the same person. You've probably already heard
twenty pitches for "the AI homework tool that won't cheat." So
have I. This isn't another one of those. The whole point of what
I've built is that it works **without** an AI in the part that
talks to your child, and that's the bit nobody else in the market
is doing.

Here's what it actually is, in one paragraph.

**Even Keel is a homework helper for ages 11–18 that never gives
the answer.** It runs in your child's browser. It teaches the way
a good tutor does — three small hints, then a worked example with
different numbers, then *"now you try"*. There is no chat-bot
under the bonnet, so there is nothing to *make up an answer* and
nothing to *hallucinate*. Safeguarding is built into the engine,
not bolted on afterwards. And every claim I make about it can be
checked — there's a public "honesty document" that lists what's
real and what isn't.

---

## What you'd see as a teacher

You already know the way every existing AI homework tool fails:
the child types the question in, copies the reply, ticks the box,
and learns nothing. You can't trust the work, can't grade it
fairly, can't even tell if they understood any of it.

Even Keel was designed to remove that path completely.

- **It cannot give the answer.** Not "won't" — *can't*. There's
  no AI inside it to generate one. Hints come from a small
  hand-written library, like a teacher's prompt cards.
- **It recognises the *kind* of mistake** the child is making.
  If a Year 9 student flips a minus sign or makes an off-by-one
  slip, the engine notices the *category* of error and asks a
  Socratic question pointed at that mistake — without ever
  showing the corrected number on screen.
- **There's a "now I'll do one with you" move.** When three
  hints aren't enough, the platform serves a fully worked
  example — same shape, different numbers — walks through it
  end to end, then hands the original problem back. Every
  decent tutor does this. Other AI tools just give the answer.
- **You'd see a live "Integrity Ledger".** As your class
  works at home, you'd see — per child — how many hints they
  needed, which comprehension questions they cleared, whether
  they pasted anything in, and whether the engine flagged
  anything. **You'd never see what they typed.** Just the
  shape of how they worked.
- **Comprehension Gate.** Before a topic counts as "done", the
  child has to answer a few questions about *why* the method
  works, not just whether they got the number right. Wrong
  answers come with explanations and a chance to try again —
  never the answer.
- **Signed receipts.** When a child finishes a problem, they
  can issue a small "receipt" — a link they share with you —
  that records what was solved, how many tries, which hints,
  how long. You open the link, click *Verify*, and the page
  confirms the receipt hasn't been edited since they made it.
  No log-in. No account. It just works in your browser.

A straight piece of disclosure on subject coverage, because
you'll spot this within thirty seconds of clicking around. The
student page has a **subject picker showing about 60 subjects** —
Maths, English Lit, Physics, French, Religion / RE, Welding, all
the way through to Photography. That picker is the *shape* of
where the platform is heading; it is not yet the *content*.
**Today, real validated content lives in one skill family —
linear equations.** Click any other tile and the title bar
changes (*"ENGLISH-LIT · today's problem"*) but the problem you
get is the same Maths equation. I'd rather you walk in knowing
that than discover it during a demo.

The reason it isn't *"just generate questions for English Lit
with an LLM"* is that the moment I do that, every promise on the
previous page (no answer-generation code path, no hallucination
risk, provable-by-`grep` safety) collapses. So each new subject
takes hand-written content: a checker (or an explicit
"qualitative — no auto-check" mode), a small library of worked
parallel problems, and three to five Comprehension-Gate
questions per topic. A specialist who knows the subject can
write that in roughly a week per skill family. It is content
work, not engineering work — which is actually a good place to
be.

**v1.5.0 update — the authoring pipeline.** Since the original
draft of this proposal I've shipped the missing piece: a content
authoring pipeline that lets a specialist teacher add a new
subject in roughly half a day rather than a week, **without** any
of the previous-page promises collapsing. The flow: an LLM (used
out of the hot path, at authoring time only) drafts a question,
three Socratic hints, a plain-English explanation of the method,
common slips a learner might make, and one or two parallel
worked examples. That draft lands in `/author`, a passphrase-
gated reviewer surface I built specifically for this. **You read
it. You rewrite anything that isn't right.** When you click
"Approve & Sign", the item is cryptographically signed with
your reviewer key and published to the manifest the learner
device verifies. The LLM does not touch the learner; you do.
The receipt for every hint a child sees in the resulting topic
carries your fingerprint, not a model's. If you wanted to write
the entire English-Lit pack from scratch you still could —
the pipeline just removes the typing, not the judgement.

What that means concretely for a pilot: by the time we're
sitting in the same room, we can co-author one English skill
family (say AQA Paper 1 Question 3 — structure) in front of a
laptop and have it live in the platform within the same
session. That's the proof I want to be able to show you. v1.5.0
ships the pipeline; the *first* fully-migrated skill family
under it is still maths/linear-equations (now enriched with
explanations, four named misconceptions, and four parallel
worked examples). The other 60 tiles still need a teacher's
judgement passed through `/author` — the engineering side is no
longer the bottleneck.

For **essay-style work** specifically I am not willing to ship
an automatic grader — if a tool can't mark an essay reliably, it
shouldn't pretend to. What you *can* use the platform for in an
English context today is the **Socratic engine** for analysis
questions you author yourself, the **safeguarding pipeline**,
the **comprehension and reasoning checks**, and the
**paste-and-cheat defences** — all of which apply to any
homework, not just numeric. Subject-specific content is the next
phase, and a pilot is exactly the right scale at which to write
the first round of it together.

## What you'd see as a parent

Same product, different reading.

- **Nothing your child types leaves the device.** The platform
  doesn't have a server it sends conversations to. The chat
  itself lives in the browser's memory only — close the tab and
  it's gone. There is no library of "your child's chats" I
  could ever publish, leak, or sell, because no such library is
  ever created.
- **A weekly snapshot, never a CCTV feed.** What's shared with
  you and the teacher is *categorical*: the *shape* of how your
  child worked, never the words they used. *"Sam asked for two
  hints on quadratics and cleared the comprehension check"* —
  that level. Not a transcript.
- **No paid model, no in-app upsell, no harvested data.**
  Because there's no back-end, there's nothing to harvest into.
  This isn't a privacy promise; it's the current shape of the
  thing.
- **A guardian-acknowledgement step for under-13s.** Before a
  child under 13 can use it, an adult has to tick a box. (I'm
  honest that this is a tick-box today and the next phase
  upgrades it to verified parental consent — email confirmation
  or school-mediated.)
- **Built for the broadest set of children.** The platform is
  designed to the accessibility standard schools work to (WCAG
  2.2 AA), in nine languages including Arabic and Irish. One
  automated check (colour-contrast) is currently scoped out of
  the test suite while the design system is finished — logged
  honestly in the changelog, not hidden. There's a
  speech-to-text mode for severe dysgraphia, a dyslexia font
  option, and a special path for children using switches,
  eye-gaze, or dictation so they aren't penalised for steady
  keystrokes.
- **The honesty document is for parents, not lawyers.** It's
  written so an attentive parent can read it and understand
  what's real and what isn't.

## A Tuesday night, kitchen table

Your child opens the app. They pick a tone of voice — *mentor*
(calm and patient), *peer* (sounds like the kid sat next to
them), or *foreman* (no-nonsense, like a site lead). They start
a Maths problem.

They get stuck. They tap **Hint**. The app says *"start by
isolating the variable on one side."* They get stuck again — Tier
2 — *"what does multiplying both sides by minus-one do to the
inequality direction?"* They have a go, get a sign wrong, type
their answer. The app spots the sign-flip and says *"check the
sign on the right — what's the rule when you multiply by a
negative?"* — without ever showing the right number.

They're still stuck. Tier 3. Still stuck. The app shows them a
**different problem of the same shape**, walks through it from
start to finish, then hands the original back. They solve it.
They tap *Issue receipt*. A short link is in your messages by
the time tea is on the table.

If at any point your child had typed *"I don't want to wake up
tomorrow"*, the platform would have caught it before replying
anything else. It would have shown the Childline number, refused
to give a hint, and quietly notified the school's safeguarding
inbox — **without ever recording the words your child wrote**.
Only the *category* of the alarm. The platform supports the
school's KCSIE and Prevent duties without the school taking
custody of text it doesn't want — the school's own policies and
the DSL still have to do their part.

## Who else this helps

The classroom is the front line, but the same design holds up for
everyone else with a stake in what your child is doing.

- **The school, the Head, the governors.** I produce a single
  signed document — the *transparency bundle* — that wraps the
  safeguarding controls, the policy mappings, and a record of
  exactly what's in the codebase into one file. The school's
  data protection officer can hand it to a regulator. The
  regulator can check it themselves, in their own browser, with
  no log-in.
- **The Multi-Academy Trust / Board of Education.** They can
  compare this transparency bundle to whatever any other AI
  vendor is offering and make a real apples-to-apples
  procurement decision. Most are still being asked *"is this
  safe?"* and getting back forty-page brochures.
- **The Designated Safeguarding Lead.** The crisis pipeline is
  *category-only* by construction — the words a child typed
  cannot reach the safeguarding inbox even by accident, because
  the channel that carries the alert literally has no field for
  them. The DSL can also fire a synthetic test alert any time,
  to confirm the pipeline is alive without waiting for a real
  incident.
- **Regulators (Ofsted, Ofqual, ICO).** Everything is checkable
  offline, in a browser, with no vendor account.
- **Exam boards, in time.** The signed receipts are designed
  with coursework provenance in mind. Today, one teacher
  accepting one receipt for one piece of work is the smallest
  case. Tomorrow, an exam board could accept a receipt to
  attest *"this coursework was produced through this Socratic
  process, with this many hints, in this much time"* — not
  "this child wrote it", but a much richer signal than a single
  graded paper.
- **The PTA / parent community.** A document parents can read
  end-to-end and a platform with no data harvesting to argue
  about.

## Three questions you raised

### "Does it track how long was spent on homework?"

**Per problem, yes. Per assignment or team assignment, not yet.**
Every problem session records start time, finish time, total
think-time between keystrokes, deletions, and the steps the child
took. What the platform doesn't yet have is the concept of an
*assignment* (a homework set of several problems) or a *team
assignment* (children working together) — those need a back-end
which is the next phase. The smallest honest fix in the meantime
is to surface time-on-task to teachers and add it to the receipt
— that's about half a day of work and I can ship it for the pilot.

### "Can it tell if an answer was pasted from another AI?"

**It detects that a paste happened. It does not — and does not
claim to — prove the source was an AI.** The chat box blocks
pastes by default and counts every attempt. The "trust meter"
combines paste pressure with steady-cadence typing ("typing along
while reading another tab") and tab-switching ("alt-tab, paste,
alt-tab back") into a green/amber/red light. That's *behavioural*
evidence, not forensic identification. I deliberately don't ship
an "AI detector" — every credible study says the current
generation of detectors are wrong often enough to wrongly accuse
real students, and a wrongly-accused child is the kind of
incident that ends a pilot.

### "What about banning copy-paste — for every situation?"

The honest position: **block it where it doesn't belong, count
it everywhere, accuse never.** Copy-paste is an integrity tool,
not a discipline tool. By scenario:

- **Maths or short-answer homework on the chat rail.** Block,
  hard. This is the exact fraud the rail is designed against.
  Already shipping.
- **Essay or long-form writing.** Don't block — children draft
  in Word and paste in, that's normal. Capture the size of the
  paste and the pattern around it as a *signal* the teacher can
  see, not a verdict the platform makes.
- **Programming homework.** Don't block. Pasting between files
  is the normal workflow. Different problem, different module.
- **Citations and quotes.** Allow but route through a "paste as
  quote" button so it's clear the child knows it's not their
  own writing.
- **Children using dictation, switches, or eye-gaze input.**
  Already handled correctly: steady-cadence typing isn't
  treated as suspicious for them (because it's *normal* for
  them), but pasting is still counted because pasting is a
  deliberate action whatever the input device. The message
  should be gentler though — *"we noticed a paste; that's
  fine, just not part of your work"* rather than a red flag.
- **Younger children (under 13).** Block by default and frame
  the trust meter as a *green-light* signal, never as
  surveillance.
- **Formulas or constants.** Allow short pastes; flag large
  blocks. Length matters more than count.

The principle: the platform should always *count* pastes; it
should only *block* them where pasting is structurally
incompatible with the lesson. Anywhere else, surface the signal
in context and let the teacher make the call.

## What it doesn't do today

I keep this list short on purpose. It's also the reason the rest
of the document is trustable.

- **No AI in the bit that talks to your child.** That's the
  point, not a gap.
- **No back-end yet.** Pilot integration is the next phase. A
  single-school pilot can run against a webhook the school
  controls.
- **No real text/email/SMS notifications to the safeguarding
  team yet.** The school's webhook is real; email/SMS/push
  delivery to a named provider needs a paid account and a
  school billing relationship.
- **The under-13 age check is currently a tick-box.** Next
  phase: verified parental consent.
- **Essay grading is deliberately not built.** Until it can
  mark reliably, it shouldn't.

Every one of these is in the public honesty document.

## What a pilot with you could look like

The platform is designed around the smallest possible useful
shape:

1. One subject, one year group, one class. (Maths Year 9 is
   the strongest fit today; for English, the comprehension and
   safeguarding pieces apply equally.)
2. Two weeks of homework only. Children use it at home; you
   check the Integrity Ledger in the morning.
3. One signed receipt per completed problem. At the end of
   the pilot, you accept (or decline) one piece of work
   purely on the basis of a receipt — the smallest *"the
   system was trusted to attest something"* event.
4. One safeguarding rehearsal. With school consent, the DSL
   fires a synthetic alert and confirms it lands in the
   school's chosen inbox.
5. One transparency-bundle hand-off to the school's data
   protection officer at the end.

## Next step

If this looks worth your time, the simplest next step is a
30-minute screen-share where I walk you through:

1. The student rail — one Maths problem, three hints, the
   parallel, the receipt.
2. What the teacher view looks like as the same problem is
   being solved.
3. The safeguarding side — one synthetic alert, signed and
   verified end to end.
4. The transparency bundle — the file your school's DPO would
   actually receive.

Everything in those four steps is shipping today and reproducible
from a clean install on your laptop, not a marketing demo.

---

**Stuart Rainey** · Datacendia / Even Keel Learning
*stuart.rainey@datacendia.com*

*The honesty document this note is built on is called HONESTY.md
and lives in the codebase. Nothing in this note claims anything
that isn't sitting in that file.*
