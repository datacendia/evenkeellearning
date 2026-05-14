// ─────────────────────────────────────────────────────────────────────────────
// lib/curriculum/coverage.ts
//
// v1.8.0 — Compute per-framework "X of Y spec-points covered by authored
// content" statistics. Pure. Used by the /teacher/curriculum coverage
// dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AuthoredSpecPointRef,
  CurriculumRegistry,
  CurriculumSpecPoint,
} from "./registry";

export interface FrameworkCoverage {
  /** Stable framework id. */
  framework: string;
  /** Display name (from the registry). */
  name: string;
  /** Awarding body (from the registry). */
  awardingBody: string;
  /** Total spec-points in the framework. */
  totalSpecPoints: number;
  /** Spec-points covered by ≥1 authored item. */
  coveredSpecPoints: number;
  /** 0..1. Equal to coveredSpecPoints / totalSpecPoints (or 0 when total=0). */
  coverageRatio: number;
  /** Per-spec-point breakdown, ordered by code. */
  rows: FrameworkCoverageRow[];
}

export interface FrameworkCoverageRow {
  code: string;
  label: string;
  topic?: string;
  /** How many authored items reference this spec-point. */
  authoredCount: number;
  /** True iff authoredCount > 0. */
  covered: boolean;
}

export interface CoverageReport {
  generatedAtIso: string;
  /** Per-framework stats, ordered alphabetically by id. */
  frameworks: FrameworkCoverage[];
  /** Spec-point references the registry doesn't know about. */
  unknownRefs: Array<AuthoredSpecPointRef & { source: string }>;
}

export function computeCoverage(
  registry: CurriculumRegistry,
  authoredRefs: Array<AuthoredSpecPointRef & { source: string }>,
  generatedAtIso: string = new Date().toISOString(),
): CoverageReport {
  // Bucket authored refs by (framework, code).
  const counts = new Map<string, number>();
  const unknown: Array<AuthoredSpecPointRef & { source: string }> = [];
  for (const r of authoredRefs) {
    const f = registry.frameworks[r.framework];
    const sp = f ? f.specPoints.find((s) => s.code === r.code) : null;
    if (!sp) {
      unknown.push(r);
      continue;
    }
    const key = `${r.framework}|${r.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const frameworks: FrameworkCoverage[] = Object.values(registry.frameworks)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => {
      const rows = [...f.specPoints]
        .sort((a, b) => compareCodes(a.code, b.code))
        .map<FrameworkCoverageRow>((sp: CurriculumSpecPoint) => {
          const c = counts.get(`${f.id}|${sp.code}`) ?? 0;
          return {
            code: sp.code,
            label: sp.label,
            ...(sp.topic ? { topic: sp.topic } : {}),
            authoredCount: c,
            covered: c > 0,
          };
        });
      const covered = rows.filter((r) => r.covered).length;
      return {
        framework: f.id,
        name: f.name,
        awardingBody: f.awardingBody,
        totalSpecPoints: rows.length,
        coveredSpecPoints: covered,
        coverageRatio: rows.length === 0 ? 0 : covered / rows.length,
        rows,
      };
    });

  return {
    generatedAtIso,
    frameworks,
    unknownRefs: unknown,
  };
}

/** Lexicographic but with numeric segment awareness so "A18" < "A21" and
 *  "1.3" < "1.13". Pure. */
function compareCodes(a: string, b: string): number {
  const re = /\d+|\D+/g;
  const ap = a.match(re) ?? [a];
  const bp = b.match(re) ?? [b];
  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; i++) {
    const av = ap[i]!;
    const bv = bp[i]!;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) {
      const d = Number(av) - Number(bv);
      if (d !== 0) return d;
    } else {
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
  }
  return ap.length - bp.length;
}
