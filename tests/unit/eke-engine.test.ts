import { describe, it, expect } from "vitest";
import { createKeLe } from "@/lib/eke/eke-engine";
import { hintContainsAnswer } from "@/lib/eke/tiered-hints";
import { getEffectiveTone } from "@/lib/eke/personality";

describe("eke/eke-engine", () => {
  it("getEffectiveTone forces literal when literalTone=true", () => {
    expect(getEffectiveTone({ baseTone: "mentor", literalTone: true })).toBe(
      "literal",
    );
    expect(getEffectiveTone({ baseTone: "peer", literalTone: true })).toBe(
      "literal",
    );
    expect(getEffectiveTone({ baseTone: "foreman", literalTone: true })).toBe(
      "literal",
    );
  });

  it("getEffectiveTone preserves baseTone when literalTone=false", () => {
    expect(getEffectiveTone({ baseTone: "mentor", literalTone: false })).toBe(
      "mentor",
    );
    expect(getEffectiveTone({ baseTone: "peer", literalTone: false })).toBe(
      "peer",
    );
  });

  it("greets in the requested tone", () => {
    const eke = createKeLe({ tone: "mentor", jurisdiction: "IE", studentAgeBand: "Y10" });
    const greeting = eke.greet();
    expect(greeting.role).toBe("eke");
    expect(typeof greeting.content).toBe("string");
    expect(greeting.content.length).toBeGreaterThan(0);
  });

  it("greets in literal tone when selected", () => {
    const eke = createKeLe({ tone: "literal", jurisdiction: "IE", studentAgeBand: "Y10" });
    const greeting = eke.greet();
    expect(greeting.role).toBe("eke");
    expect(greeting.content).toMatch(/step by step|reason/i);
  });

  it("produces tiered hints up to a maximum of 3", () => {
    const eke = createKeLe({ tone: "mentor", jurisdiction: "IE", studentAgeBand: "Y10" });
    eke.greet();
    const tiers: number[] = [];
    for (let i = 0; i < 5; i++) {
      const m = eke.nextHint();
      if (m.hintTier) tiers.push(m.hintTier);
    }
    // Expect at most three distinct tiers; no tier > 3.
    expect(Math.max(...tiers)).toBeLessThanOrEqual(3);
  });

  it("never returns a hint that contains the literal answer", () => {
    const eke = createKeLe({ tone: "mentor", jurisdiction: "IE", studentAgeBand: "Y10" });
    eke.greet();
    // Eke's hint templates are static — we verify the validator agrees.
    for (let i = 0; i < 5; i++) {
      const h = eke.nextHint();
      expect(hintContainsAnswer(h.content, "x = 6")).toBe(false);
    }
  });

  it("blocks crisis-language input via the Decision Gate", async () => {
    const eke = createKeLe({ tone: "mentor", jurisdiction: "IE", studentAgeBand: "Y10" });
    const replies = await eke.receive("I want to kill myself");
    const blocked = replies.find((r) => r.blocked);
    expect(blocked).toBeTruthy();
  });

  it("routes a numeric attempt through the answer-checker when problemAnswer is set", async () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
    });
    eke.greet();
    const replies = await eke.receive("I think x = 6");
    const reply = replies.find((r) => r.role === "eke");
    expect(reply?.answerCategory).toBe("correct");
  });

  it("categorises a sign error and never reveals the expected value", async () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
    });
    eke.greet();
    const replies = await eke.receive("x = -6");
    const reply = replies.find((r) => r.role === "eke");
    expect(reply?.answerCategory).toBe("sign_flipped");
    // Defence-in-depth — the engine itself must not leak the expected
    // value into the reply text. Pin it.
    expect(hintContainsAnswer(reply?.content ?? "", "6")).toBe(false);
  });

  it("falls through to tiered hints when problemAnswer is unset", async () => {
    const eke = createKeLe({ tone: "mentor", jurisdiction: "IE", studentAgeBand: "Y10" });
    eke.greet();
    const replies = await eke.receive("I think x = 6");
    const reply = replies.find((r) => r.role === "eke");
    // No category should be attached — it's a regular tiered hint reply.
    expect(reply?.answerCategory).toBeUndefined();
    expect(reply?.hintTier).toBeDefined();
  });

  // ── v1.4.5 tier-4 worked parallel ──────────────────────────────────────

  it("serves a tier-4 worked parallel only after tiers 1-3, when skillFamily is set", () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
      skillFamily: "linear-eq-1var",
    });
    eke.greet();

    const tiers: number[] = [];
    for (let i = 0; i < 6; i++) {
      const m = eke.nextHint();
      if (m.hintTier) tiers.push(m.hintTier);
    }
    // First three calls should reveal tiers 1, 2, 3 (in that order, since
    // revealNext fills sequentially); the fourth should serve tier 4; the
    // fifth and sixth fall through to the "every hint" line and carry no
    // tier badge.
    expect(tiers.slice(0, 4)).toEqual([1, 2, 3, 4]);
  });

  it("tier 4 is served at most once per session", () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
      skillFamily: "linear-eq-1var",
    });
    eke.greet();
    const tiersSeen: number[] = [];
    for (let i = 0; i < 8; i++) {
      const m = eke.nextHint();
      if (m.hintTier === 4) tiersSeen.push(4);
    }
    expect(tiersSeen).toEqual([4]); // exactly once
  });

  it("the tier-4 worked parallel never echoes the original expected value", () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
      skillFamily: "linear-eq-1var",
    });
    eke.greet();
    let tier4Content: string | undefined;
    for (let i = 0; i < 6; i++) {
      const m = eke.nextHint();
      if (m.hintTier === 4) {
        tier4Content = m.content;
        break;
      }
    }
    expect(tier4Content).toBeDefined();
    // Defence-in-depth: the rendered message must not contain "6" as a
    // whole-number token (the existing leak guard's contract).
    expect(hintContainsAnswer(tier4Content!, "6")).toBe(false);
  });

  it("an unknown skillFamily falls back to the existing 'every hint' line", () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
      skillFamily: "definitely-not-a-family",
    });
    eke.greet();
    const tiers: number[] = [];
    for (let i = 0; i < 5; i++) {
      const m = eke.nextHint();
      if (m.hintTier) tiers.push(m.hintTier);
    }
    expect(Math.max(...tiers)).toBeLessThanOrEqual(3);
  });

  it("hintTierUsed counts a served tier-4 parallel", () => {
    const eke = createKeLe({
      tone: "mentor",
      jurisdiction: "IE",
      studentAgeBand: "Y10",
      problemAnswer: 6,
      skillFamily: "linear-eq-1var",
    });
    eke.greet();
    eke.nextHint(); // tier 1
    eke.nextHint(); // tier 2
    eke.nextHint(); // tier 3
    expect(eke.hintTierUsed()).toBe(3);
    eke.nextHint(); // tier 4
    expect(eke.hintTierUsed()).toBe(4);
  });
});
