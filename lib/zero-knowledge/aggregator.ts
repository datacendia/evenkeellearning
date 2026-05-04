// ─────────────────────────────────────────────────────────────────────────────
// lib/zero-knowledge/aggregator.ts
//
// Aggregates macro-level cognitive metrics across many learners and returns
// counts, averages and distributions — never per-learner identifiers.
//
// HONESTY
// ───────
// The "anonymisation" here is a 32-bit toy hash of the student id plus a
// salt. It is NOT cryptographic and does NOT meet the GDPR definition of
// anonymisation. Treat the output as pseudonymised, not anonymous. A real
// implementation would use a vetted differential-privacy library and a
// rotating, server-held salt. See HONESTY.md §4.4.
// ─────────────────────────────────────────────────────────────────────────────

import type { CognitiveReasoningTrace } from "../types";

interface AggregatedMetric {
  metric: string;
  count: number;
  average: number;
  distribution: { [key: string]: number };
}

interface StruggleRecord {
  studentId: string;
  status: string;
  frictionLevel: number;
}

interface AggregatedStrugglePatterns {
  totalStudents: number;
  statusDistribution: { [key: string]: number };
  averageFriction: number;
}

export class ZeroKnowledgeAggregator {
  private salt: string;

  constructor() {
    this.salt = process.env.ZK_SALT || "default-salt-change-in-production";
  }

  // Anonymize user ID for aggregation
  private anonymizeId(userId: string): string {
    const hash = this.simpleHash(userId + this.salt);
    return hash.substring(0, 12);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  // Aggregate cognitive metrics without exposing individual data
  aggregateCognitiveMetrics(traces: CognitiveReasoningTrace[]): AggregatedMetric[] {
    const anonymizedData = traces.map(trace => ({
      id: this.anonymizeId(trace.studentId),
      thinkTime: trace.totalThinkTime,
      deletionCount: trace.deletionCount,
      pivotCount: trace.pivotCount,
    }));

    return [
      {
        metric: "average_think_time",
        count: anonymizedData.length,
        average: this.calculateAverage(anonymizedData.map(d => d.thinkTime)),
        distribution: this.bucketize(anonymizedData.map(d => d.thinkTime), [0, 30, 60, 120, 300]),
      },
      {
        metric: "average_deletions",
        count: anonymizedData.length,
        average: this.calculateAverage(anonymizedData.map(d => d.deletionCount)),
        distribution: this.bucketize(anonymizedData.map(d => d.deletionCount), [0, 5, 10, 20, 50]),
      },
    ];
  }

  // Aggregate struggle patterns
  aggregateStrugglePatterns(struggleData: StruggleRecord[]): AggregatedStrugglePatterns {
    const anonymized = struggleData.map(d => ({
      id: this.anonymizeId(d.studentId),
      status: d.status,
      frictionLevel: d.frictionLevel,
    }));

    const statusCounts = anonymized.reduce((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    return {
      totalStudents: anonymized.length,
      statusDistribution: statusCounts,
      averageFriction: this.calculateAverage(anonymized.map(d => d.frictionLevel)),
    };
  }

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private bucketize(values: number[], boundaries: number[]): { [key: string]: number } {
    const buckets: { [key: string]: number } = {};
    
    boundaries.forEach((bound, i) => {
      const nextBound = boundaries[i + 1] || Infinity;
      const key = `${bound}-${nextBound}`;
      buckets[key] = values.filter(v => v >= bound && v < nextBound).length;
    });

    return buckets;
  }
}

export const aggregator = new ZeroKnowledgeAggregator();
