// ─────────────────────────────────────────────────────────────────────────────
// scripts/author-draft.mjs
//
// v1.5.0 — Authoring-time LLM drafter. Produces a *draft* content item from
// a curriculum spec prompt, writes it to `content/drafts/<id>.json`, and
// stops. The drafted item carries a `draft` provenance block (model,
// provider, prompt hash, timestamp) and a *null* `approval` block.
//
// CRITICAL CONTRACT
// ─────────────────
// • This script never runs at learner time and is not bundled into the
//   browser. It is a developer + content-team tool.
// • A draft item NEVER reaches a learner directly. The `/author` review
//   UI is the only path from `content/drafts/` into a raw pack — and
//   that path requires an explicit reviewer approval click which signs
//   the canonicalised item with a real key.
// • The drafter is provider-pluggable. The default provider is the
//   **offline mock**, which produces a deterministic placeholder draft
//   from the prompt alone. Set `LLM_PROVIDER=anthropic` (or `openai`)
//   plus the corresponding API key env var to use a real provider.
// • Even when a real provider is used, the drafter writes a
//   *structurally complete* draft and then runs the same shape
//   validator the build script uses (schema.ts), so a malformed
//   model response fails fast at draft time instead of polluting the
//   review queue.
//
// USAGE
// ─────
//   node scripts/author-draft.mjs --spec "AQA English Lang P1Q3 — structure" \
//        --subject english --skill-family eng-paper1-q3-structure \
//        --jurisdictions UK-EN \
//        --difficulty core
//
// ENV
// ───
//   LLM_PROVIDER         one of: "mock" (default), "anthropic", "openai"
//   ANTHROPIC_API_KEY    required iff LLM_PROVIDER=anthropic
//   OPENAI_API_KEY       required iff LLM_PROVIDER=openai
//   LLM_MODEL            override model id (defaults are sane)
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DRAFTS_DIR = path.join(ROOT, "content", "drafts");
const SCHEMA_VERSION = "1.0.0";
const DRAFTER_VERSION = "1.5.0";

// ── CLI parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function usage() {
  console.error(
    `Usage: node scripts/author-draft.mjs \\
        --spec "<curriculum spec point>" \\
        --subject <subject>            (e.g. english, maths, re)
        --skill-family <slug>          (e.g. eng-paper1-q3-structure)
        --jurisdictions <CSV>          (default: UK-EN)
        --difficulty <band>            (foundation|core|stretch|challenge|olympiad; default: core)
        [--id <stable-id>]             (default: auto-generated)
        [--count <N>]                  (default: 1; how many items to draft)
`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function bytesToB64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256B64Url(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return bytesToB64Url(new Uint8Array(digest));
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Providers ───────────────────────────────────────────────────────────────

/**
 * The mock provider produces a deterministic, clearly-labelled placeholder
 * draft. It is what runs out-of-the-box with no API key. The placeholder
 * text says, in plain English, that a real LLM has not been called and a
 * teacher must rewrite the content before approval. This is by design: a
 * silent fake would be worse than no draft at all.
 */
async function draftWithMock({ spec, subject, skillFamily, difficulty }) {
  const tag = `[MOCK DRAFT — REWRITE BEFORE APPROVAL]`;
  const problem = `${tag} Sample problem for "${spec}". Replace this with a real ${subject} task aligned to the spec point above.`;
  return {
    problem,
    expectedAnswer: 0,
    hints: [
      { tier: 1, text: `${tag} Tier-1 nudge: ask the learner to restate the task in their own words.` },
      { tier: 2, text: `${tag} Tier-2 nudge: ask them to break it into smaller steps.` },
      { tier: 3, text: `${tag} Tier-3 nudge: name the underlying concept ("${skillFamily}") without giving the answer.` },
    ],
    explanation: `${tag} Plain-English walkthrough. Replace this paragraph with a substantive explanation of how a ${difficulty}-difficulty ${subject} learner should approach this spec point. At least 20 characters of real content is required by the schema.`,
    misconceptions: [
      {
        id: "mock-misconception-1",
        trigger: "wrong",
        explanation: `${tag} Common misconception placeholder. Describe one specific error a learner makes here, and why.`,
        nudge: `${tag} Nudge text — what to try instead.`,
      },
    ],
    workedExamples: [
      {
        id: `${slug(skillFamily)}-mock-001`,
        problem: `${tag} Parallel problem for ${skillFamily}.`,
        workedSolution: `${tag} Step 1. Replace this with a fully-worked solution.\n${tag} Step 2. Different numbers/text from the main problem.`,
        expectedAnswer: 0,
      },
    ],
  };
}

const ANTHROPIC_SYSTEM_PROMPT = `You are an expert UK/IE secondary-school content author.
Produce ONE pedagogically rigorous problem aligned to the supplied curriculum spec point.
Output STRICT JSON matching this shape (no prose, no markdown fences, no commentary):
{
  "problem": string,
  "expectedAnswer": number | string,
  "hints": [
    { "tier": 1, "text": string },  // restate / reverse the question
    { "tier": 2, "text": string },  // decompose / reframe
    { "tier": 3, "text": string }   // concept reminder, no values
  ],
  "explanation": string,             // ≥80 words, plain English, post-attempt walkthrough
  "misconceptions": [
    { "id": string, "trigger": "off_by_one"|"sign_flipped"|"doubled"|"halved"|"wrong"|string,
      "explanation": string, "nudge": string }
  ],
  "workedExamples": [
    { "id": string, "problem": string, "workedSolution": string, "expectedAnswer": number | string }
  ]
}
RULES:
- No hint may contain or paraphrase the answer.
- Every workedExample MUST use different numbers/text from the main problem.
- Plain English, no jargon a Year 8 learner couldn't follow.
- At least one workedExample. At least one misconception.
`;

async function draftWithAnthropic(input) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.LLM_MODEL || "claude-sonnet-4-5";
  const userPrompt = JSON.stringify(input, null, 2);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: ANTHROPIC_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const text = body.content?.[0]?.text;
  if (!text) throw new Error("Anthropic response had no text content");
  return JSON.parse(text);
}

async function draftWithOpenAI(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.LLM_MODEL || "gpt-4o";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANTHROPIC_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input, null, 2) },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI response had no content");
  return JSON.parse(text);
}

// ── Lightweight shape validation (mirror of schema.ts) ──────────────────────
function validateDraftPayload(p) {
  const errs = [];
  if (!p.problem || typeof p.problem !== "string") errs.push("problem required");
  if (p.expectedAnswer === undefined || p.expectedAnswer === null) errs.push("expectedAnswer required");
  if (!Array.isArray(p.hints) || p.hints.length < 3) errs.push("≥3 hints required");
  else for (const t of [1, 2, 3]) if (!p.hints.find((h) => h.tier === t)) errs.push(`hint tier ${t} missing`);
  if (!p.explanation || p.explanation.length < 20) errs.push("explanation ≥20 chars required");
  if (!Array.isArray(p.workedExamples) || p.workedExamples.length === 0) errs.push("≥1 workedExample required");
  if (!Array.isArray(p.misconceptions)) errs.push("misconceptions array required");
  return errs;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (!args.spec || !args.subject || !args["skill-family"]) {
    usage();
    process.exit(2);
  }

  const subject = String(args.subject);
  const skillFamily = String(args["skill-family"]);
  const spec = String(args.spec);
  const jurisdictions = String(args.jurisdictions || "UK-EN").split(",").map((s) => s.trim());
  const difficulty = String(args.difficulty || "core");
  const count = Math.max(1, Number(args.count || 1));

  const provider = process.env.LLM_PROVIDER || "mock";
  const drafter =
    provider === "anthropic" ? draftWithAnthropic :
    provider === "openai"   ? draftWithOpenAI :
                              draftWithMock;

  console.log(`[draft] provider=${provider}  subject=${subject}  family=${skillFamily}  count=${count}`);

  await fs.mkdir(DRAFTS_DIR, { recursive: true });
  const promptHash = await sha256B64Url(JSON.stringify({ spec, subject, skillFamily, difficulty, system: ANTHROPIC_SYSTEM_PROMPT }));

  for (let i = 0; i < count; i++) {
    const payload = await drafter({ spec, subject, skillFamily, difficulty, jurisdictions });
    const errs = validateDraftPayload(payload);
    if (errs.length) {
      console.error(`[draft] item ${i + 1} failed validation:\n  ${errs.join("\n  ")}`);
      process.exit(1);
    }

    const id = args.id ? `${args.id}${count > 1 ? `-${i + 1}` : ""}` : `${slug(jurisdictions[0])}-${slug(subject)}-${slug(skillFamily)}-${Date.now()}-${i + 1}`;

    const item = {
      schemaVersion: SCHEMA_VERSION,
      id,
      skillFamily,
      subject,
      jurisdictions,
      difficulty,
      prerequisites: [],
      specPoints: [{ framework: "free-form", code: spec, label: spec }],
      problem: payload.problem,
      expectedAnswer: payload.expectedAnswer,
      hints: payload.hints,
      explanation: payload.explanation,
      misconceptions: payload.misconceptions,
      workedExamples: payload.workedExamples,
      draft: {
        model: process.env.LLM_MODEL || (provider === "mock" ? "mock-deterministic" : "provider-default"),
        provider,
        promptHashB64url: promptHash,
        draftedAtIso: new Date().toISOString(),
        drafterVersion: DRAFTER_VERSION,
      },
      approvals: null,
    };

    const outPath = path.join(DRAFTS_DIR, `${id}.json`);
    await fs.writeFile(outPath, JSON.stringify(item, null, 2) + "\n", "utf8");
    console.log(`[draft] wrote ${path.relative(ROOT, outPath)}`);
  }

  console.log(`[draft] ${count} draft(s) ready for review at /author`);
}

main().catch((err) => {
  console.error("[draft] failed:", err);
  process.exit(1);
});
