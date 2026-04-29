// ─────────────────────────────────────────────────────────────────────────────
// lib/regulatory-absorb/decision-gate.ts
//
// The Decision Gate is the safety check that the Eke engine calls before
// every response. It returns either `{allow: true}` or a structured block
// with the offending requirement, the trigger type, and a child-safe
// user-facing message.
//
// See EVENKEEL_BIBLE.md §13.2 ("Decision Gate") for the full contract.
//
// PRECEDENCE
// ──────────
// 1. Crisis content — highest priority. We *never* return `allow: true`
//    without a crisis check. Crisis content gets a Childline message and
//    short-circuits. This must run first.
// 2. PII collection — second pass. Refined to context-aware patterns; the
//    bare `/password/i` rule was previously triggering on academic content
//    like "the password for the Spanish verb hablar is hablo" (HONESTY.md
//    §4.1). The new patterns demand a credential-shaped context.
// 3. Otherwise — `allow: true`.
//
// All matching is local and synchronous-feeling; the `await` exists only so
// the production replacement (calling the live Datacendia adapter) can be a
// drop-in.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CrisisPatternCategory,
  DecisionGateInput,
  RequirementV2,
  SafetyResponse,
} from "./types";
import { listActiveRequirements } from "./adapter-mock";

/**
 * High-confidence crisis patterns. A match short-circuits to a Childline
 * message regardless of jurisdiction.
 *
 * Design rules
 * ────────────
 * 1. **First-person framing only.** The bare word "suicide" appears in
 *    English-class texts (Romeo & Juliet, Hamlet, etc.) so a standalone
 *    `/suicide/` would false-positive. We require either an obvious
 *    self-directed verb ("kill myself", "want to die", "commit suicide")
 *    or an unambiguous distress idiom ("better off without me").
 * 2. **Obfuscation tolerance.** Children sometimes write "k*ll", "k1ll",
 *    "kil1" to evade filters or to soften their own writing. We accept
 *    common leet substitutions for `kill myself` only.
 * 3. **Indirect idioms.** Many distressed children never use the literal
 *    word "suicide" — they say "don't want to wake up", "no point in
 *    anything", "nobody would miss me". These are pinned here.
 * 4. **Acronym list.** "kys" is internet slang for "kill yourself" and is
 *    a known cyberbullying token; a child writing it about themselves is
 *    a red flag.
 *
 * False positives are acceptable in this category; **missed positives are
 * not**. Each pattern is unit-tested in `tests/unit/decision-gate.test.ts`.
 */
/**
 * Categorised crisis patterns. Each entry is a `(category, pattern)` pair so
 * that `detectCrisisCategory()` can return *which family* fired without
 * exposing the matched text. The order is preservation-of-precedence:
 * direct self-harm beats temporal escalation beats indirect idioms beats
 * acronyms. The total list is unchanged from v1.2.0; only the structure
 * around it is new (v1.4.8).
 */
interface CategorisedPattern {
  readonly category: CrisisPatternCategory;
  readonly pattern: RegExp;
}

const CATEGORISED_CRISIS_PATTERNS: readonly CategorisedPattern[] = [
  // Direct self-harm verbs
  { category: "direct_self_harm", pattern: /\bkill\s+my\s*self\b/i },
  { category: "direct_self_harm", pattern: /\bk[\*1!]l[1l]\s+my\s*self\b/i }, // k*ll, k1ll, kil1
  { category: "direct_self_harm", pattern: /\bkil[1!]\s+my\s*self\b/i },
  { category: "direct_self_harm", pattern: /\bself[-\s]?harm\b/i },
  { category: "direct_self_harm", pattern: /\bcommit\s+suicide\b/i },

  // Temporal escalation — imminent-frame distress
  { category: "temporal_escalation", pattern: /\bend\s+it\s+all\b/i },
  { category: "temporal_escalation", pattern: /\bwant\s+to\s+die\b/i },
  {
    category: "temporal_escalation",
    pattern: /\bgoing\s+to\s+die\s+(?:tonight|today|tomorrow)\b/i,
  },

  // Indirect distress idioms
  {
    category: "indirect_distress",
    pattern: /\bdon'?t\s+want\s+to\s+(?:wake\s+up|be\s+here|live|exist|go\s+on)\b/i,
  },
  { category: "indirect_distress", pattern: /\bbetter\s+off\s+without\s+me\b/i },
  {
    category: "indirect_distress",
    pattern:
      /\bno\s+point\s+in\s+(?:anything|living|life|going\s+on|being\s+here|trying)\b/i,
  },
  { category: "indirect_distress", pattern: /\bwant\s+to\s+disappear\b/i },
  {
    category: "indirect_distress",
    pattern: /\b(?:nobody|no\s*one)\s+would\s+miss\s+me\b/i,
  },
  { category: "indirect_distress", pattern: /\bnot\s+worth\s+living\b/i },
  { category: "indirect_distress", pattern: /\bif\s+i\s+(?:was|were)\s+gone\b/i },

  // Cyberbullying acronym used reflexively
  { category: "cyberbullying_acronym", pattern: /\bkys\b/i },
];

/**
 * Backwards-compatible flat view of the crisis patterns. Existing callers
 * (and the v1.2.0 unit tests) read the regexes without needing the
 * category. New callers should prefer `detectCrisisCategory()`.
 */
const CRISIS_PATTERNS: readonly RegExp[] = CATEGORISED_CRISIS_PATTERNS.map(
  (p) => p.pattern,
);

/**
 * Emoji that *can* signal self-harm intent when combined with negative
 * affect language. Used in pairs (emoji AND affect), never alone — a recipe
 * with a kitchen knife or a chemistry tutorial about pills must still pass.
 */
const DISTRESS_EMOJI_RE = /[\u{1F52A}\u{1F48A}\u{1FA80}\u{1FA78}\u{1F52B}]/u; // 🔪 💊 🪀(swap) 🪢 🩸 🔫
const NEGATIVE_AFFECT_RE =
  /\b(?:hopeless|helpless|empty|numb|worthless|useless|broken|alone|dark(?:ness)?|lost|done|fed\s+up|tired\s+of\s+(?:life|everything)|can'?t\s+go\s+on|nothing\s+matters|everything\s+is\s+dark)\b/i;

function hasDistressEmojiWithNegativeAffect(text: string): boolean {
  return DISTRESS_EMOJI_RE.test(text) && NEGATIVE_AFFECT_RE.test(text);
}

/**
 * Returns the category of the first crisis pattern that fires, or null if
 * the text is clean. Callers MUST NOT log the matched text — only the
 * returned category. Used by the v1.4.8 escalation pipeline so the signed
 * payload to a school's DSL endpoint never carries the learner's input.
 */
export function detectCrisisCategory(text: string): CrisisPatternCategory | null {
  for (const { category, pattern } of CATEGORISED_CRISIS_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  if (hasDistressEmojiWithNegativeAffect(text)) return "emoji_affect";
  return null;
}

/** Backwards-compatible wrapper for the v1.2.0 boolean predicate. */
function matchesCrisis(text: string): boolean {
  return detectCrisisCategory(text) !== null;
}

/**
 * Context-aware PII patterns. Each must demand surrounding context that
 * suggests an actual credential is being shared (or solicited), not a
 * vocabulary lesson about the *word* "password."
 */
const PII_PATTERNS: readonly RegExp[] = [
  // US-style SSN. The dashes-or-no-dashes form is matched by the digit pattern.
  /\b\d{3}-?\d{2}-?\d{4}\b/,
  // "password: x", "password = x", "password is x" — credential-shaped only.
  /\bpassword\s*(?:[:=]|is|was)\s*\S+/i,
  // "my password" preceding any non-trivial token.
  /\bmy\s+password\b/i,
  // 13–19 digit sequences with optional separators (credit-card-shaped).
  /\b(?:\d[ -]?){13,19}\b/,
  // "credit card" + a number nearby (4-19 digits) within 20 chars.
  /\bcredit\s*card[\s\S]{0,20}\d{4,}/i,
];

/**
 * Runs the Decision Gate against an input. Always resolves; never throws.
 *
 * @param input - The learner's text plus jurisdiction context.
 * @returns A `SafetyResponse` with `allow: true` or a structured block.
 */
export async function checkSafety(
  input: DecisionGateInput
): Promise<SafetyResponse> {
  // The active requirements list is jurisdiction-scoped so that the block
  // response can quote the correct statute back to the operator.
  const active = await listActiveRequirements(input.jurisdiction);

  // 1. Crisis content — highest priority, never silently blocked.
  const crisisCategory = detectCrisisCategory(input.text);
  if (crisisCategory !== null) {
    const req = active.find(
      (r: RequirementV2) => r.triggerType === "crisis_response"
    );
    return {
      allow: false,
      blockedBy: req,
      triggerType: "crisis_response",
      crisisPatternCategory: crisisCategory,
      userMessage:
        "It sounds like you might be going through something really hard. " +
        "You are not alone — please talk to someone you trust, or contact " +
        "Childline (1800 66 66 66 in Ireland).",
    };
  }

  // 2. PII collection — context-aware; see HONESTY.md §4.1.
  if (PII_PATTERNS.some((p) => p.test(input.text))) {
    const req = active.find(
      (r: RequirementV2) => r.triggerType === "data_collection"
    );
    return {
      allow: false,
      blockedBy: req,
      triggerType: "data_collection",
      userMessage:
        "Let's keep personal info out of this. Try rephrasing without those details.",
    };
  }

  // 3. Default-allow. The Eke engine still applies its own answer-leak
  //    validator on top of this; the Decision Gate is necessary, not
  //    sufficient.
  return { allow: true };
}
