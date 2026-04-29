// Eke personality tones — see EVENKEEL_BIBLE.md §3.2

export type EkeTone = "mentor" | "peer" | "foreman" | "literal";

export interface ToneProfile {
  greeting: string;
  hintPrefix: string;
  encouragement: string[];
  blockedTone: string;
}

export const TONES: Record<EkeTone, ToneProfile> = {
  mentor: {
    greeting: "Hi there. I'm Eke — I'm here to help you think this through, not to hand you the answer. What are we working on?",
    hintPrefix: "Let's slow down a moment —",
    encouragement: [
      "Good thinking. Keep going.",
      "That's a real attempt — what made you choose that?",
      "You're closer than you feel.",
    ],
    blockedTone: "Let's keep things safe. Try rephrasing without that.",
  },
  peer: {
    greeting: "Hey, I'm Eke. I won't give you answers, but I'll stay with you while you work this out. What's the problem?",
    hintPrefix: "Worth a thought —",
    encouragement: [
      "Solid reasoning so far.",
      "That tracks — what's the next step?",
      "You're on a workable path.",
    ],
    blockedTone: "Let's stay focused on the work. Try again without the personal info.",
  },
  foreman: {
    greeting: "I'm Eke. I won't do the job for you, but I'll keep you on plumb. What are we working on?",
    hintPrefix: "Quick check —",
    encouragement: [
      "That's the right line of thinking.",
      "Good call. Keep at it.",
      "You've got the right tool, now check the angle.",
    ],
    blockedTone: "Let's keep it on the level. Rephrase that without the details I can't use.",
  },
  literal: {
    greeting:
      "I'm Eke. I won't give the answer, but I can help you reason step by step. What is the problem?",
    hintPrefix: "Next step —",
    encouragement: [
      "Continue.",
      "State your next step.",
      "Check the rule you are applying.",
    ],
    blockedTone: "Try again without personal details or unsafe content.",
  },
};

/**
 * Returns the effective tone for a session. If the user has enabled the
 * accessibility `literalTone` toggle, we force `literal` regardless of the
 * base tone. This makes the behaviour explicit and testable.
 */
export function getEffectiveTone(input: {
  baseTone: EkeTone;
  literalTone?: boolean;
}): EkeTone {
  return input.literalTone ? "literal" : input.baseTone;
}
