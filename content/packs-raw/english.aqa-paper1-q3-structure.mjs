// ─────────────────────────────────────────────────────────────────────────────
// content/packs-raw/english.aqa-paper1-q3-structure.mjs
//
// v1.5.0 — Seed content pack: AQA English Language Paper 1, Question 3
// (structure analysis). This is a *qualitative* skill — there is no single
// numeric answer — but the rest of the schema applies:
//   • a question stem the learner sees
//   • three Socratic hints that progressively reveal METHOD without giving
//     content
//   • a plain-English explanation of how Q3 should be approached
//   • named misconceptions a learner makes when they're new to structural
//     analysis
//   • parallel worked examples on different extracts
//
// HONEST CAVEAT
// ─────────────
// The runtime answer-checker (`lib/validation/answer-checker.ts`) is
// numeric-only at v1.5.0. For this pack:
//   • `expectedAnswer` is the literal string "qualitative-no-auto-check" —
//     a sentinel that future versions of the checker will recognise to
//     skip categorisation and route to teacher-marking only.
//   • The misconception trigger names below (`narrative-not-structural`,
//     etc.) are also forward-looking: the engine will only fire them once
//     a qualitative-checker is wired. Until then, the explanations and
//     worked examples are still served by the registry on demand
//     (`getExplanation` / explicit "show me how" affordance), and the
//     teacher can use the comprehension gate as the validation layer.
//
// This pack is intentionally a *small* proof of subject-pipeline scope
// (one item, one parallel). It is the "we can co-author one of these in
// front of a laptop in a single session" demonstration referenced in
// `docs/PROPOSAL_FOR_LAURA.md`.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import("../../lib/content/schema.ts").SchemaContentPack} */
export const pack = {
  schemaVersion: "1.0.0",
  id: "english.aqa-paper1-q3-structure",
  title: "AQA English Language Paper 1 · Q3 — structure analysis",
  subject: "english",
  skillFamily: "eng-paper1-q3-structure",
  metadata: {
    version: "1.0.0",
    builtAtIso: "PLACEHOLDER_BUILT_AT",
    description:
      "AQA English Language Paper 1, Question 3 (structure). Authoring-pipeline proof-of-scope: a non-numeric, qualitative skill family rendered through the v1.5.0 schema. Awaits the qualitative-checker for full runtime categorisation; the explanation and worked-example pathways already work via the registry.",
  },
  items: [
    {
      schemaVersion: "1.0.0",
      id: "uk-en-english-paper1-q3-001",
      skillFamily: "eng-paper1-q3-structure",
      subject: "english",
      jurisdictions: ["UK-EN"],
      difficulty: "core",
      prerequisites: [],
      specPoints: [
        {
          framework: "AQA-GCSE-English-Language-8700",
          code: "Paper-1-Q3",
          label: "How has the writer structured the text to interest you as a reader?",
        },
      ],
      problem:
        "You are responding to AQA Paper 1, Q3 on the source extract you have been given (8 marks). " +
        "How has the writer structured the text to interest you as a reader? " +
        "Plan your answer in three moves: (1) what the writer focuses your attention on at the OPENING, " +
        "(2) how the focus SHIFTS through the text, (3) what the writer leaves you with at the END. " +
        "Write a paragraph for each, and for every observation, name the structural feature you are using as evidence.",
      expectedAnswer: "qualitative-no-auto-check",
      hints: [
        {
          tier: 1,
          text: "Q3 is about the *shape* of the text, not the language. Where does the writer start the camera? Where does it end up? What changes in between?",
        },
        {
          tier: 2,
          text: "Try labelling the extract in three: Opening, Middle Shift, End. For each, write down ONE thing about what the writer is showing you — and ONE thing about HOW (zoom in / zoom out / change of perspective / time jump / focus on a single object).",
        },
        {
          tier: 3,
          text: "AO2 wants you to name the structural feature: opening, shift, focus, perspective, contrast, zoom, foreshadowing, cyclical structure, etc. Pair each observation with one of those terms.",
        },
      ],
      explanation: [
        "Q3 is the structural-analysis question: 8 marks for explaining HOW the text is shaped, not WHAT it says.",
        "Examiners want three things in a strong answer: (a) clear identification of structural features (opening, shift, end, contrast, zoom, perspective change, cyclical structure), (b) precise location in the extract, and (c) reader-effect — why that choice draws you in.",
        "The biggest pitfall is summarising the plot. Plot summary is what Q2 already did with language. Q3 wants the architecture: where the camera starts, how it moves, what it leaves you with.",
        "A reliable structure for the answer is three paragraphs: opening focus, mid-text shift, end emphasis. Each paragraph names a structural feature, quotes (briefly) where it occurs, and explains the effect on the reader.",
      ].join(" "),
      misconceptions: [
        {
          id: "narrative-not-structural",
          trigger: "narrative-not-structural",
          explanation:
            "The most common Q3 slip is rewriting what happens in the extract instead of analysing how it is shaped. 'The writer describes the bridge, then the man on it' is plot summary. 'The writer opens with a wide-angle establishing shot of the bridge before zooming to the man' is structural analysis.",
          nudge:
            "Before each sentence, ask: am I telling the examiner what happened, or am I telling them how the writer arranged it?",
        },
        {
          id: "language-not-structure",
          trigger: "language-not-structure",
          explanation:
            "Q2 is the language question; Q3 is the structure question. Quoting metaphors and similes here costs you AO2 marks. Structural features are about ordering, focus, perspective, time, scale — not word choice.",
          nudge:
            "If the feature you've named is a simile or a metaphor, you're answering Q2. Reach for opening / shift / focus / perspective / contrast / cyclical instead.",
        },
        {
          id: "no-reader-effect",
          trigger: "no-reader-effect",
          explanation:
            "Identifying a structural feature is half the mark. The other half is explaining its effect on the reader: why does the writer open here? why does focus shift? what does the ending leave the reader with?",
          nudge:
            "After each named feature, add 'this draws the reader in by…' or 'this leaves the reader with…'.",
        },
      ],
      workedExamples: [
        {
          id: "eng-paper1-q3-worked-001",
          problem:
            "Imagine an extract that opens with a description of an empty railway platform at dawn, shifts mid-text to a single passenger arriving and waiting, and ends with the train pulling away while the platform is empty again. Plan a Q3 response.",
          workedSolution: [
            "Opening focus.",
            "  • Feature: cyclical opening — the writer establishes an empty, still setting (the platform at dawn).",
            "  • Effect on reader: creates anticipation; the emptiness implies something is about to happen.",
            "Middle shift.",
            "  • Feature: shift in scale — the camera narrows from the wide platform to a single passenger.",
            "  • Effect on reader: the reader's attention is funnelled; we now read the passenger's experience as the centre of meaning.",
            "End focus.",
            "  • Feature: cyclical structure (return to emptiness) — the train leaves and the platform is empty again.",
            "  • Effect on reader: the cyclical return creates a sense of impermanence; the passenger's significance is undercut by the indifference of the setting.",
            "Conclusion. The structure moves wide → narrow → wide, using the cycle to frame the passenger as a brief disturbance in an otherwise unchanged scene.",
          ].join("\n"),
          expectedAnswer: "qualitative-no-auto-check",
        },
      ],
      draft: {
        model: "manual-author-v1.5.0-seed",
        provider: "human-author",
        promptHashB64url: "SEED_NO_PROMPT",
        draftedAtIso: "2026-04-28T00:00:00.000Z",
        drafterVersion: "1.5.0",
      },
      // Will be filled in by the build script with the build-time reviewer key.
      // In a Laura pilot the first thing she'd do is open this in /author,
      // adjust the wording to her preferred Q3 framing, and re-approve under
      // her own reviewer fingerprint.
      approval: null,
    },
  ],
};
