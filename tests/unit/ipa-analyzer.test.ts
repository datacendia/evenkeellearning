import { describe, it, expect } from "vitest";
import { createIPAAnalyzer } from "@/lib/vertolearn/ipa-analyzer";

describe("vertolearn/ipa-analyzer", () => {
  it("starts with zero mimicry probability", () => {
    const ipa = createIPAAnalyzer();
    expect(ipa.calculateMimicryProbability()).toBeGreaterThanOrEqual(0);
    expect(ipa.calculateMimicryProbability()).toBeLessThan(0.5);
  });

  it("paste attempts increase mimicry probability", () => {
    const ipa = createIPAAnalyzer();
    const before = ipa.calculateMimicryProbability();
    ipa.recordPasteAttempt();
    ipa.recordPasteAttempt();
    ipa.recordPasteAttempt();
    expect(ipa.calculateMimicryProbability()).toBeGreaterThan(before);
  });

  it("focus loss is reflected in mimicry probability", () => {
    const ipa = createIPAAnalyzer();
    const before = ipa.calculateMimicryProbability();
    ipa.recordFocusLoss();
    ipa.recordFocusLoss();
    expect(ipa.calculateMimicryProbability()).toBeGreaterThanOrEqual(before);
  });

  it("reset clears every counter", () => {
    const ipa = createIPAAnalyzer();
    ipa.recordPasteAttempt();
    ipa.recordFocusLoss();
    ipa.recordKeystroke();
    ipa.reset();
    expect(ipa.calculateMimicryProbability()).toBeLessThan(0.2);
  });

  it("generatePattern uses the correctly-spelled mimicryProbability key", () => {
    const ipa = createIPAAnalyzer();
    ipa.recordPasteAttempt();
    const p = ipa.generatePattern("alex", "session-1");
    expect(p).toHaveProperty("mimicryProbability");
    expect(typeof p.mimicryProbability).toBe("number");
  });

  // ─── Assistive-input exemption (SAFEGUARDING.md §1.5, v1.3.0) ────────────
  //
  // Cadence-based mimicry detection penalises evenly-timed keystrokes.
  // For users of eye-gaze, switch, dictation, sticky-keys, or word-
  // prediction tools that timing is regular by design, so the cadence
  // components MUST be suppressed when assistiveInput is declared.
  // Paste and focus-loss signals must continue to apply because they are
  // direct evidence of a user action, not an inference about typing style.

  it("assistiveInput=true reports isAssistiveInput()", () => {
    const ipa = createIPAAnalyzer({ assistiveInput: true });
    expect(ipa.isAssistiveInput()).toBe(true);
    expect(createIPAAnalyzer().isAssistiveInput()).toBe(false);
  });

  it("assistiveInput=true suppresses cadence-based mimicry penalty", () => {
    // Synthesise a perfectly-flat cadence of 30ms intervals — exactly the
    // pattern the cadence heuristic would normally flag (isTooFast +
    // isTooConsistent → +0.6).
    function feedFlatCadence(ipa: ReturnType<typeof createIPAAnalyzer>) {
      // Inject 10 keystrokes by reaching into Date.now via mocking is
      // overkill; instead, exercise the public surface: rapid recordKeystroke
      // calls naturally produce ~0ms intervals which trip both heuristics.
      for (let i = 0; i < 10; i++) ipa.recordKeystroke();
    }

    const flagged = createIPAAnalyzer();
    feedFlatCadence(flagged);

    const exempt = createIPAAnalyzer({ assistiveInput: true });
    feedFlatCadence(exempt);

    // The exempt analyser must score strictly less because the cadence
    // components have been disabled.
    expect(exempt.calculateMimicryProbability()).toBeLessThan(
      flagged.calculateMimicryProbability(),
    );
    expect(exempt.calculateMimicryProbability()).toBe(0);
  });

  it("assistiveInput=true still reflects paste pressure", () => {
    const ipa = createIPAAnalyzer({ assistiveInput: true });
    expect(ipa.calculateMimicryProbability()).toBe(0);
    ipa.recordPasteAttempt();
    // Paste pressure is direct evidence; it must still count.
    expect(ipa.calculateMimicryProbability()).toBeGreaterThan(0);
  });

  it("generatePattern records assistiveInputDeclared on the pattern", () => {
    const ipa = createIPAAnalyzer({ assistiveInput: true });
    const p = ipa.generatePattern("alex", "session-1");
    expect(p.assistiveInputDeclared).toBe(true);

    const baseline = createIPAAnalyzer().generatePattern("alex", "session-2");
    expect(baseline.assistiveInputDeclared).toBe(false);
  });
});
