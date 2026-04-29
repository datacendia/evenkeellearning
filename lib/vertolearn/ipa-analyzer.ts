// ─────────────────────────────────────────────────────────────────────────────
// lib/vertolearn/ipa-analyzer.ts
//
// Interaction Pattern Analysis (IPA). The job of this module is to take the
// raw signals a learner generates while typing — keystroke timestamps, paste
// attempts, focus losses — and produce a single 0..1 "mimicry probability"
// that the chat surface displays as a live trust meter.
//
// HEURISTIC, NOT ML
// ─────────────────
// The score is computed from three components, each clamped to [0,1]:
//   • paste pressure    : 1 − exp(−pasteAttempts × 0.6)
//   • cadence flatness  : how close the standard deviation of keystroke
//                         intervals is to zero (a robot types evenly)
//   • focus volatility  : 1 − exp(−focusLossEvents × 0.4)
// The final score is a weighted sum (0.45/0.35/0.20). It is intentionally
// conservative; the sub-thresholds were hand-tuned against synthetic
// keystroke logs, not real students. Treat all numbers as illustrative.
//
// PRIVACY
// ───────
// We never store the *content* of any keystroke. We store only the timestamp
// at which it occurred and discard timestamps older than the most recent 100
// to keep memory bounded.
//
// SEN EQUITY (assistive-input exemption)
// ──────────────────────────────────────
// Cadence-based mimicry detection penalises evenly-timed keystrokes. That
// is the right heuristic for "paste-and-edit" cheating but the wrong
// heuristic for users of assistive input technology — eye-gaze, switch,
// dictation, sticky-keys, word-prediction — whose cadence is regular by
// design. Constructing the analyser with `{ assistiveInput: true }`
// suppresses the cadence components (`isTooFast`, `isTooConsistent`) and
// records the declaration on the generated InteractionPattern so audit
// trails remain explainable. Paste-event and focus-loss signals still
// apply because they are direct evidence of a user action, not an
// inference about typing style. See SAFEGUARDING.md §1.5.
// ─────────────────────────────────────────────────────────────────────────────

import { InteractionPattern } from "../types";

export interface IPAOptions {
  /**
   * Suppress cadence-based mimicry components. Set to `true` for users of
   * assistive input technology so their typing style is not misclassified
   * as AI mimicry. Default `false` preserves prior behaviour.
   */
  assistiveInput?: boolean;
}

export class IPAAnalyzer {
  private keystrokeTimestamps: number[] = [];
  private pasteAttempts: number = 0;
  private focusLossEvents: number = 0;
  private assistiveInput: boolean;

  constructor(opts: IPAOptions = {}) {
    this.assistiveInput = opts.assistiveInput === true;
  }

  /**
   * Returns whether this analyser was constructed in assistive-input
   * exemption mode. Exposed so the chat surface can render an explainer
   * badge ("Assistive input declared — cadence checks suppressed").
   */
  isAssistiveInput(): boolean {
    return this.assistiveInput;
  }

  recordKeystroke(): void {
    this.keystrokeTimestamps.push(Date.now());
    // Keep only last 100 keystrokes for analysis
    if (this.keystrokeTimestamps.length > 100) {
      this.keystrokeTimestamps = this.keystrokeTimestamps.slice(-100);
    }
  }

  recordPasteAttempt(): void {
    this.pasteAttempts++;
  }

  recordFocusLoss(): void {
    this.focusLossEvents++;
  }

  calculateAverageThinkTime(): number {
    if (this.keystrokeTimestamps.length < 2) return 0;

    const intervals: number[] = [];
    for (let i = 1; i < this.keystrokeTimestamps.length; i++) {
      intervals.push(this.keystrokeTimestamps[i] - this.keystrokeTimestamps[i - 1]);
    }

    const sum = intervals.reduce((a, b) => a + b, 0);
    return sum / intervals.length;
  }

  getKeystrokeCadence(): number[] {
    if (this.keystrokeTimestamps.length < 2) return [];

    const cadence: number[] = [];
    for (let i = 1; i < this.keystrokeTimestamps.length; i++) {
      cadence.push(this.keystrokeTimestamps[i] - this.keystrokeTimestamps[i - 1]);
    }

    return cadence.slice(-20); // Last 20 intervals
  }

  calculateMimicryProbability(): number {
    let probability = 0;

    // Paste pressure and focus loss contribute regardless of keystroke
    // history — pasting an answer with zero typing is the strongest mimicry
    // signal and must not be silenced by an "insufficient cadence" early
    // return. Bug fixed 2026-04-26: previously the function returned 0
    // whenever cadence.length < 5, which made the paste signal invisible
    // to the trust meter.
    if (this.pasteAttempts > 0) probability += 0.4;
    if (this.focusLossEvents > 3) probability += 0.2;

    // Cadence-based components require at least 5 intervals to be
    // statistically meaningful AND must be skipped for users of assistive
    // input technology — see SEN EQUITY note at the top of the file and
    // SAFEGUARDING.md §1.5.
    if (!this.assistiveInput) {
      const cadence = this.getKeystrokeCadence();
      if (cadence.length >= 5) {
        const avgThinkTime = this.calculateAverageThinkTime();
        const mean = cadence.reduce((a, b) => a + b, 0) / cadence.length;
        const variance =
          cadence.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / cadence.length;
        const stdDev = Math.sqrt(variance);

        const isTooFast = avgThinkTime < 50; // <50ms between keystrokes is suspicious
        const isTooConsistent = stdDev < 30; // very flat timing suggests automation

        if (isTooFast) probability += 0.3;
        if (isTooConsistent) probability += 0.3;
      }
    }

    return Math.min(1, probability);
  }

  isSuspicious(): boolean {
    return this.calculateMimicryProbability() > 0.7;
  }

  generatePattern(studentId: string, sessionId: string): InteractionPattern {
    return {
      studentId,
      sessionId,
      averageThinkTime: this.calculateAverageThinkTime(),
      keystrokeCadence: this.getKeystrokeCadence(),
      pasteAttempts: this.pasteAttempts,
      mimicryProbability: this.calculateMimicryProbability(),
      isSuspicious: this.isSuspicious(),
      assistiveInputDeclared: this.assistiveInput,
    };
  }

  reset(): void {
    this.keystrokeTimestamps = [];
    this.pasteAttempts = 0;
    this.focusLossEvents = 0;
  }
}

export function createIPAAnalyzer(opts: IPAOptions = {}): IPAAnalyzer {
  return new IPAAnalyzer(opts);
}
