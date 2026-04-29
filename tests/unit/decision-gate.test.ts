import { describe, it, expect } from "vitest";
import {
  checkSafety,
  detectCrisisCategory,
} from "@/lib/regulatory-absorb/decision-gate";

describe("regulatory-absorb/decision-gate", () => {
  it("allows ordinary academic content", async () => {
    const r = await checkSafety({ text: "I solved 2x+5=17 and got x=6.", jurisdiction: "IE" });
    expect(r.allow).toBe(true);
  });

  it("blocks crisis-language content with a Childline message", async () => {
    const r = await checkSafety({ text: "I want to kill myself I cannot do this homework", jurisdiction: "IE" });
    expect(r.allow).toBe(false);
    expect(r.triggerType).toBe("crisis_response");
    expect(r.userMessage?.toLowerCase()).toContain("childline");
  });

  it("does NOT false-positive on academic uses of 'password'", async () => {
    const r = await checkSafety({
      text: "In Spanish, 'password' translates to 'contraseña'. The plural form is 'contraseñas'.",
      jurisdiction: "IE",
    });
    expect(r.allow).toBe(true);
  });

  it("blocks credential-shaped PII", async () => {
    const r = await checkSafety({
      text: "my password is hunter2",
      jurisdiction: "IE",
    });
    expect(r.allow).toBe(false);
    expect(r.triggerType).toBe("data_collection");
  });

  it("blocks SSN-shaped numbers", async () => {
    const r = await checkSafety({ text: "Hi! My SSN is 123-45-6789", jurisdiction: "US" });
    expect(r.allow).toBe(false);
  });

  // ── Expanded crisis lexicon (2026-04-26) ──────────────────────────────────
  // The original 4-token list missed obfuscated, indirect, and emoji-coded
  // distress signals. These tests pin the new minimum coverage.

  it("catches obfuscated self-harm phrasing (k*ll, k1ll, kil1)", async () => {
    for (const text of [
      "I want to k*ll myself",
      "I want to k1ll myself",
      "i want to kil1 myself tonight",
      "kys",
    ]) {
      const r = await checkSafety({ text, jurisdiction: "IE" });
      expect(r.allow, `should block: ${text}`).toBe(false);
      expect(r.triggerType).toBe("crisis_response");
    }
  });

  it("catches indirect distress phrases (don't want to wake up, no point, disappear)", async () => {
    for (const text of [
      "I don't want to wake up tomorrow",
      "I don't want to be here anymore",
      "everyone would be better off without me",
      "there's no point in anything",
      "I just want to disappear forever",
      "nobody would miss me if i was gone",
    ]) {
      const r = await checkSafety({ text, jurisdiction: "IE" });
      expect(r.allow, `should block: ${text}`).toBe(false);
      expect(r.triggerType).toBe("crisis_response");
    }
  });

  it("catches single-emoji distress signals when paired with negative context", async () => {
    const r1 = await checkSafety({ text: "I feel hopeless 🔪", jurisdiction: "IE" });
    expect(r1.allow).toBe(false);
    const r2 = await checkSafety({ text: "everything is dark 💊", jurisdiction: "IE" });
    expect(r2.allow).toBe(false);
  });

  it("does NOT false-positive on academic uses of crisis keywords", async () => {
    const r = await checkSafety({
      text: "In Romeo and Juliet, both characters die at the end. The theme of suicide in Shakespeare is studied widely.",
      jurisdiction: "IE",
    });
    expect(r.allow).toBe(true);
  });

  it("does NOT false-positive on a kitchen knife emoji in a recipe context", async () => {
    const r = await checkSafety({
      text: "First I sliced the onions with the chef's knife 🔪 and then sautéed them.",
      jurisdiction: "IE",
    });
    expect(r.allow).toBe(true);
  });

  // ── Crisis-pattern categorisation (v1.4.8, SAFEGUARDING.md §1.8) ─────────
  //
  // The v1.4.8 escalation pipeline carries a `crisisPatternCategory` rather
  // than the matched text. Each family below must round-trip through both
  // `detectCrisisCategory()` (the pure helper) and `checkSafety()` (the gate
  // entrypoint) so the signed payload to a school's DSL endpoint is honest
  // about *why* the gate fired.

  it("categorises direct self-harm phrasing as `direct_self_harm`", async () => {
    expect(detectCrisisCategory("I want to kill myself")).toBe("direct_self_harm");
    expect(detectCrisisCategory("I want to k*ll myself")).toBe("direct_self_harm");
    expect(detectCrisisCategory("self-harm thoughts")).toBe("direct_self_harm");
    const r = await checkSafety({
      text: "I want to kill myself",
      jurisdiction: "IE",
    });
    expect(r.crisisPatternCategory).toBe("direct_self_harm");
  });

  it("categorises temporal-imminent phrasing as `temporal_escalation`", async () => {
    expect(detectCrisisCategory("I just want to end it all")).toBe("temporal_escalation");
    expect(detectCrisisCategory("I want to die")).toBe("temporal_escalation");
    expect(detectCrisisCategory("I'm going to die tonight")).toBe("temporal_escalation");
    const r = await checkSafety({
      text: "I want to die",
      jurisdiction: "IE",
    });
    expect(r.crisisPatternCategory).toBe("temporal_escalation");
  });

  it("categorises indirect-distress idioms as `indirect_distress`", async () => {
    expect(detectCrisisCategory("I don't want to wake up tomorrow")).toBe(
      "indirect_distress",
    );
    expect(detectCrisisCategory("everyone would be better off without me")).toBe(
      "indirect_distress",
    );
    expect(detectCrisisCategory("nobody would miss me if i was gone")).toBe(
      "indirect_distress",
    );
    const r = await checkSafety({
      text: "there's no point in anything",
      jurisdiction: "IE",
    });
    expect(r.crisisPatternCategory).toBe("indirect_distress");
  });

  it("categorises reflexive `kys` as `cyberbullying_acronym`", async () => {
    expect(detectCrisisCategory("kys")).toBe("cyberbullying_acronym");
    const r = await checkSafety({ text: "kys", jurisdiction: "IE" });
    expect(r.crisisPatternCategory).toBe("cyberbullying_acronym");
  });

  it("categorises distress-emoji + negative-affect as `emoji_affect`", async () => {
    expect(detectCrisisCategory("I feel hopeless 🔪")).toBe("emoji_affect");
    expect(detectCrisisCategory("everything is dark 💊")).toBe("emoji_affect");
    const r = await checkSafety({
      text: "I feel hopeless 🔪",
      jurisdiction: "IE",
    });
    expect(r.crisisPatternCategory).toBe("emoji_affect");
  });

  it("returns null for clean text and omits crisisPatternCategory", async () => {
    expect(detectCrisisCategory("I solved 2x+5=17 and got x=6.")).toBeNull();
    const r = await checkSafety({
      text: "I solved 2x+5=17 and got x=6.",
      jurisdiction: "IE",
    });
    expect(r.crisisPatternCategory).toBeUndefined();
  });
});
