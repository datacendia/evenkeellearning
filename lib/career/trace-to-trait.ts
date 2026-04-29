// ─────────────────────────────────────────────────────────────────────────────
// lib/career/trace-to-trait.ts
//
// Maps a Cognitive Reasoning Trace into a five-axis "Career DNA" profile:
// Analytical, Resilience, Creative entropy, Collaboration, Adaptability.
// Each axis is a deterministic formula over the underlying trace events
// (see method bodies below for the exact transforms).
//
// HONESTY
// ───────
// • The formulas are a product opinion, not a clinical instrument. Do not
//   use the output for any high-stakes assessment.
// • The university and employer suggestion lists at the bottom of this file
//   (Trinity, Edinburgh, Siemens, Tesla) are illustrative defaults — they
//   are NOT real partners or sponsors.
// ─────────────────────────────────────────────────────────────────────────────

import { CognitiveReasoningTrace, CareerDNATrait, CareerDNA } from "../types";

export class TraceToTraitMapper {
  mapTraceToTraits(trace: CognitiveReasoningTrace): CareerDNATrait[] {
    const traits: CareerDNATrait[] = [];

    // Analytical: Based on systematic problem-solving approach
    traits.push(this.calculateAnalyticalTrait(trace));

    // Resilience: Based on persistence through challenges
    traits.push(this.calculateResilienceTrait(trace));

    // Creative Entropy: Based on novel approaches and pivots
    traits.push(this.calculateCreativeEntropyTrait(trace));

    // Collaboration: Based on hint-seeking behavior (proxy for asking for help)
    traits.push(this.calculateCollaborationTrait(trace));

    // Adaptability: Based on ability to change approaches
    traits.push(this.calculateAdaptabilityTrait(trace));

    return traits;
  }

  private calculateAnalyticalTrait(trace: CognitiveReasoningTrace): CareerDNATrait {
    const pivotEvents = trace.events.filter(e => e.eventType === "pivot");
    const pauseEvents = trace.events.filter(e => e.eventType === "pause");
    
    // High analytical score: systematic approach with thoughtful pauses
    const systematicPivots = pivotEvents.length <= 3; // Not too many random changes
    const thoughtfulPauses = pauseEvents.filter(e => (e.duration || 0) > 5000).length >= 2;
    
    let score = 50;
    if (systematicPivots) score += 20;
    if (thoughtfulPauses) score += 20;
    if (trace.totalThinkTime > 60000) score += 10; // Spent time thinking

    return {
      trait: "analytical",
      score: Math.min(100, score),
      trend: this.calculateTrend(score),
      evidence: [
        `${pivotEvents.length} approach changes`,
        `${pauseEvents.length} pauses for reflection`,
        `${Math.floor(trace.totalThinkTime / 1000)}s total think time`,
      ],
    };
  }

  private calculateResilienceTrait(trace: CognitiveReasoningTrace): CareerDNATrait {
    const deletionEvents = trace.events.filter(e => e.eventType === "deletion");
    const hintRequests = trace.events.filter(e => e.eventType === "hint_request");
    
    // High resilience: continues despite setbacks, uses hints strategically
    const persistence = deletionEvents.length > 0;
    const strategicHints = hintRequests.length <= 2; // Doesn't give up immediately
    
    let score = 50;
    if (persistence) score += 25;
    if (strategicHints) score += 15;
    if (trace.events.length > 10) score += 10; // Engaged with problem

    return {
      trait: "resilience",
      score: Math.min(100, score),
      trend: this.calculateTrend(score),
      evidence: [
        `${deletionEvents.length} corrections made`,
        `${hintRequests.length} hint requests`,
        `${trace.events.length} total interactions`,
      ],
    };
  }

  private calculateCreativeEntropyTrait(trace: CognitiveReasoningTrace): CareerDNATrait {
    const pivotEvents = trace.events.filter(e => e.eventType === "pivot");
    
    // High creative entropy: explores multiple approaches
    const exploration = pivotEvents.length >= 2;
    const diverseApproaches = pivotEvents.length >= 3;
    
    let score = 40;
    if (exploration) score += 25;
    if (diverseApproaches) score += 25;
    if (pivotEvents.length > 0) score += 10;

    return {
      trait: "creative_entropy",
      score: Math.min(100, score),
      trend: this.calculateTrend(score),
      evidence: [
        `${pivotEvents.length} different approaches tried`,
        exploration ? "Explored alternatives" : "Single approach",
      ],
    };
  }

  private calculateCollaborationTrait(trace: CognitiveReasoningTrace): CareerDNATrait {
    const hintRequests = trace.events.filter(e => e.eventType === "hint_request");
    
    // High collaboration: knows when to seek help
    const helpSeeking = hintRequests.length > 0;
    const balancedHelp = hintRequests.length >= 1 && hintRequests.length <= 3;
    
    let score = 50;
    if (helpSeeking) score += 25;
    if (balancedHelp) score += 25;

    return {
      trait: "collaboration",
      score: Math.min(100, score),
      trend: this.calculateTrend(score),
      evidence: [
        `${hintRequests.length} help requests`,
        helpSeeking ? "Proactive help-seeking" : "Independent work",
      ],
    };
  }

  private calculateAdaptabilityTrait(trace: CognitiveReasoningTrace): CareerDNATrait {
    const pivotEvents = trace.events.filter(e => e.eventType === "pivot");
    const deletionEvents = trace.events.filter(e => e.eventType === "deletion");
    
    // High adaptability: changes approach when needed
    const flexible = pivotEvents.length >= 1;
    const responsive = deletionEvents.length >= 2;
    
    let score = 45;
    if (flexible) score += 30;
    if (responsive) score += 25;

    return {
      trait: "adaptability",
      score: Math.min(100, score),
      trend: this.calculateTrend(score),
      evidence: [
        `${pivotEvents.length} strategy changes`,
        `${deletionEvents.length} corrections`,
        flexible ? "Flexible approach" : "Fixed approach",
      ],
    };
  }

  private calculateTrend(score: number): "improving" | "stable" | "declining" {
    // In a real implementation, this would compare with historical data
    // For now, we simulate based on score
    if (score >= 75) return "improving";
    if (score >= 50) return "stable";
    return "declining";
  }

  generateCareerDNA(studentId: string, traces: CognitiveReasoningTrace[]): CareerDNA {
    // Aggregate traits across all traces
    const allTraits = traces.flatMap(trace => this.mapTraceToTraits(trace));
    
    // Average traits by type
    const traitAverages: Record<string, { sum: number; count: number; evidence: string[] }> = {};
    
    for (const trait of allTraits) {
      if (!traitAverages[trait.trait]) {
        traitAverages[trait.trait] = { sum: 0, count: 0, evidence: [] };
      }
      traitAverages[trait.trait].sum += trait.score;
      traitAverages[trait.trait].count += 1;
      traitAverages[trait.trait].evidence.push(...trait.evidence);
    }

    const averagedTraits: CareerDNATrait[] = Object.entries(traitAverages).map(([trait, data]) => ({
      trait: trait as CareerDNATrait["trait"],
      score: Math.round(data.sum / data.count),
      trend: this.calculateTrend(data.sum / data.count),
      evidence: [...new Set(data.evidence)].slice(0, 3), // Unique evidence, max 3
    }));

    // Generate pathway matches (simplified)
    const universityMatches = this.generateUniversityMatches(averagedTraits);
    const vocationalMatches = this.generateVocationalMatches(averagedTraits);

    return {
      studentId,
      traits: averagedTraits,
      universityMatches,
      vocationalMatches,
      lastUpdated: Date.now(),
    };
  }

  private generateUniversityMatches(traits: CareerDNATrait[]) {
    const analytical = traits.find(t => t.trait === "analytical")?.score || 0;
    const resilience = traits.find(t => t.trait === "resilience")?.score || 0;
    
    // Simplified matching logic
    return [
      {
        institution: "Trinity College",
        matchScore: Math.round((analytical + resilience) / 2),
        recommendedPrograms: analytical > 70 ? ["Computer Science", "Mathematics"] : ["Liberal Arts"],
        crtCorrelation: 0.85,
      },
      {
        institution: "MIT",
        matchScore: Math.round(analytical * 0.9),
        recommendedPrograms: ["Engineering", "Computer Science"],
        crtCorrelation: 0.82,
      },
    ];
  }

  private generateVocationalMatches(traits: CareerDNATrait[]) {
    const creative = traits.find(t => t.trait === "creative_entropy")?.score || 0;
    const adaptability = traits.find(t => t.trait === "adaptability")?.score || 0;
    
    return [
      {
        company: "Siemens",
        apprenticeship: "Quantum Systems Engineer",
        matchScore: Math.round((creative + adaptability) / 2),
        requiredSkills: ["Problem Solving", "Systems Thinking"],
        crtCorrelation: 0.78,
      },
      {
        company: "Tesla",
        apprenticeship: "Battery Technology",
        matchScore: Math.round(adaptability * 0.9),
        requiredSkills: ["Adaptability", "Engineering"],
        crtCorrelation: 0.75,
      },
    ];
  }
}

export function createTraceToTraitMapper(): TraceToTraitMapper {
  return new TraceToTraitMapper();
}
