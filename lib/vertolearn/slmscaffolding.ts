// Small Language Model (SLM) Scaffolding
// Socratic AI restricted from giving answers, only providing tiered hints

import { SocraticHint } from "../types";

export class SLMScaffolding {
  private currentTier: number = 0;
  private hintsRevealed: number = 0;

  constructor(private problemContext: string, private maxTiers: number = 3) {}

  generateTieredHints(problem: string, studentProgress: string[]): SocraticHint[] {
    // In a real implementation, this would use an actual SLM
    // For now, we simulate tiered hint generation based on problem analysis
    
    const hints: SocraticHint[] = [
      {
        tier: 1,
        content: this.generateTier1Hint(problem),
        isRevealed: false,
        timestamp: Date.now(),
      },
      {
        tier: 2,
        content: this.generateTier2Hint(problem, studentProgress),
        isRevealed: false,
        timestamp: Date.now(),
      },
      {
        tier: 3,
        content: this.generateTier3Hint(problem, studentProgress),
        isRevealed: false,
        timestamp: Date.now(),
      },
    ];

    return hints;
  }

  private generateTier1Hint(problem: string): string {
    // Very general guidance, no direct help
    const templates = [
      "What's the first step you would take to approach this problem?",
      "Can you identify what type of problem this is?",
      "What information do you know, and what are you trying to find?",
      "Have you seen a similar problem before?",
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  private generateTier2Hint(problem: string, progress: string[]): string {
    // More specific guidance based on student's current approach
    const templates = [
      "Consider breaking the problem into smaller parts.",
      "Think about the relationship between the given values.",
      "What formula or concept might apply here?",
      "Try working backwards from what you're trying to find.",
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  private generateTier3Hint(problem: string, progress: string[]): string {
    // Most specific hint, still not giving the answer
    const templates: string[] = [
      "Focus on isolating the variable you're solving for.",
      "Remember the order of operations.",
      "Check if you can simplify the expression first.",
      "Consider whether substitution or elimination would work better.",
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  revealNextHint(hints: SocraticHint[]): SocraticHint[] {
    const nextHintIndex = hints.findIndex(h => !h.isRevealed);
    
    if (nextHintIndex === -1) return hints; // All hints already revealed
    
    const updatedHints = [...hints];
    updatedHints[nextHintIndex] = {
      ...updatedHints[nextHintIndex],
      isRevealed: true,
      timestamp: Date.now(),
    };
    
    this.hintsRevealed++;
    this.currentTier = nextHintIndex + 1;
    
    return updatedHints;
  }

  getCurrentTier(): number {
    return this.currentTier;
  }

  getHintsRevealed(): number {
    return this.hintsRevealed;
  }

  shouldAllowNextHint(): boolean {
    return this.currentTier < this.maxTiers;
  }

  reset(): void {
    this.currentTier = 0;
    this.hintsRevealed = 0;
  }

  // Validate that a hint doesn't give away the answer
  validateHintContent(content: string, problemAnswer: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerAnswer = problemAnswer.toLowerCase();
    
    // Check if hint contains the answer
    if (lowerContent.includes(lowerAnswer)) {
      return false;
    }
    
    // Check if hint contains numeric values that are the answer
    const numbersInContent = (lowerContent.match(/\d+/g) || []) as string[];
    const numbersInAnswer = (lowerAnswer.match(/\d+/g) || []) as string[];
    
    for (const num of numbersInAnswer) {
      if (numbersInContent.includes(num)) {
        return false;
      }
    }
    
    return true;
  }
}

export function createSLMScaffolding(problemContext: string, maxTiers?: number): SLMScaffolding {
  return new SLMScaffolding(problemContext, maxTiers);
}
