// ─────────────────────────────────────────────────────────────────────────────
// lib/vertolearn/neutrality-shield.ts
//
// The Neutrality Shield watches for cognitive friction signals that suggest
// an *assignment* is flawed (ambiguous wording, impossible requirement,
// missing context) rather than the *learner* struggling. When the cumulative
// frustration intensity exceeds a threshold, the shield raises a flag the
// teacher surface can act on without penalising the learner.
//
// HONESTY
// ───────
// All thresholds are hand-tuned heuristics; there is no model. The shield
// is intentionally biased toward false positives because a wrongly-flagged
// good question is cheaper than a wrongly-blamed good student.
// ─────────────────────────────────────────────────────────────────────────────

export interface FrustrationSignal {
  timestamp: number;
  type: "extended_pause" | "repeated_deletion" | "rapid_pivot" | "abandonment";
  intensity: number;
  context?: string;
}

export interface FlawDetection {
  isFlawed: boolean;
  confidence: number;
  flawType?: "typo" | "missing_variable" | "contradiction" | "ambiguous" | "unsolvable";
  suggestedFix?: string;
  frustrationSignals: FrustrationSignal[];
}

export class NeutralityShield {
  private frustrationSignals: FrustrationSignal[] = [];
  private signalThreshold: number = 5;
  private intensityThreshold: number = 0.7;

  recordFrustration(type: FrustrationSignal["type"], intensity: number, context?: string): void {
    this.frustrationSignals.push({
      timestamp: Date.now(),
      type,
      intensity,
      context,
    });

    // Keep only recent signals (last 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    this.frustrationSignals = this.frustrationSignals.filter(s => s.timestamp > tenMinutesAgo);
  }

  detectFlaw(problemText: string): FlawDetection {
    const recentSignals = this.getRecentSignals(5 * 60 * 1000); // Last 5 minutes
    const highIntensitySignals = recentSignals.filter(s => s.intensity > this.intensityThreshold);
    
    // If not enough signals, no flaw detected
    if (recentSignals.length < this.signalThreshold) {
      return {
        isFlawed: false,
        confidence: 0,
        frustrationSignals: recentSignals,
      };
    }

    // Analyze signal patterns
    const signalPattern = this.analyzeSignalPattern(highIntensitySignals);
    const textAnalysis = this.analyzeProblemText(problemText);
    
    // Combine signal and text analysis
    const combinedAnalysis = this.combineAnalyses(signalPattern, textAnalysis);
    
    return {
      isFlawed: combinedAnalysis.isFlawed,
      confidence: combinedAnalysis.confidence,
      flawType: combinedAnalysis.flawType,
      suggestedFix: combinedAnalysis.suggestedFix,
      frustrationSignals: recentSignals,
    };
  }

  private getRecentSignals(timeWindow: number): FrustrationSignal[] {
    const cutoff = Date.now() - timeWindow;
    return this.frustrationSignals.filter(s => s.timestamp > cutoff);
  }

  private analyzeSignalPattern(signals: FrustrationSignal[]): Partial<FlawDetection> {
    if (signals.length === 0) {
      return { isFlawed: false, confidence: 0 };
    }

    const typeCounts: Record<string, number> = signals.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgIntensity = signals.reduce((sum, s) => sum + s.intensity, 0) / signals.length;

    // Pattern matching
    if (typeCounts.repeated_deletion > 3) {
      return {
        isFlawed: true,
        confidence: 0.8,
        flawType: "typo",
        suggestedFix: "Check for typos or unclear instructions in the problem statement.",
      };
    }

    if (typeCounts.rapid_pivot > 3) {
      return {
        isFlawed: true,
        confidence: 0.75,
        flawType: "ambiguous",
        suggestedFix: "Problem may be ambiguous. Clarify the requirements.",
      };
    }

    if (typeCounts.abandonment > 2) {
      return {
        isFlawed: true,
        confidence: 0.7,
        flawType: "unsolvable",
        suggestedFix: "Problem may be unsolvable as stated. Verify the given values.",
      };
    }

    if (avgIntensity > 0.85) {
      return {
        isFlawed: true,
        confidence: 0.65,
        flawType: "contradiction",
        suggestedFix: "Check for contradictory information in the problem.",
      };
    }

    return { isFlawed: false, confidence: 0 };
  }

  private analyzeProblemText(text: string): Partial<FlawDetection> {
    const lowerText = text.toLowerCase();
    
    // Check for common flaw indicators
    const flawIndicators = {
      typo: /typo|error|mistake|misprint/i,
      missing_variable: /missing|undefined|unknown|not given/i,
      contradiction: /but|however|although|yet/i,
      ambiguous: /or|either|approximately|about/i,
      unsolvable: /impossible|cannot|no solution/i,
    };

    for (const [flawType, pattern] of Object.entries(flawIndicators)) {
      if (pattern.test(text)) {
        return {
          isFlawed: true,
          confidence: 0.5,
          flawType: flawType as FlawDetection["flawType"],
          suggestedFix: "Review problem statement for potential issues.",
        };
      }
    }

    return { isFlawed: false, confidence: 0 };
  }

  private combineAnalyses(signalAnalysis: Partial<FlawDetection>, textAnalysis: Partial<FlawDetection>): FlawDetection {
    if (signalAnalysis.isFlawed && textAnalysis.isFlawed) {
      return {
        isFlawed: true,
        confidence: Math.min(1, (signalAnalysis.confidence || 0) + (textAnalysis.confidence || 0) * 0.5),
        flawType: signalAnalysis.flawType || textAnalysis.flawType,
        suggestedFix: signalAnalysis.suggestedFix || textAnalysis.suggestedFix,
        frustrationSignals: this.frustrationSignals,
      };
    }

    if (signalAnalysis.isFlawed) {
      return {
        ...signalAnalysis,
        frustrationSignals: this.frustrationSignals,
      } as FlawDetection;
    }

    if (textAnalysis.isFlawed) {
      return {
        ...textAnalysis,
        frustrationSignals: this.frustrationSignals,
      } as FlawDetection;
    }

    return {
      isFlawed: false,
      confidence: 0,
      frustrationSignals: this.frustrationSignals,
    };
  }

  getFrustrationReport(): FrustrationSignal[] {
    return [...this.frustrationSignals];
  }

  reset(): void {
    this.frustrationSignals = [];
  }

  setThreshold(threshold: number): void {
    this.signalThreshold = threshold;
  }

  setIntensityThreshold(threshold: number): void {
    this.intensityThreshold = threshold;
  }
}

export function createNeutralityShield(): NeutralityShield {
  return new NeutralityShield();
}
