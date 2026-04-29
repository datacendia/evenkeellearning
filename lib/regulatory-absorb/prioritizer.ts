// ─────────────────────────────────────────────────────────────────────────────
// lib/regulatory-absorb/prioritizer.ts
//
// "Most Restrictive Wins" conflict resolution for the Regulatory Absorb V2
// engine. Given a set of `RequirementV2` objects from different
// jurisdictions that conflict on the same trigger, this module picks the
// winning requirement according to a deterministic score:
//
//     score = severityWeight + jurisdictionWeight + localOverrideBonus
//
// where severityWeight is one of {critical:100, high:75, medium:50, low:25},
// jurisdictionWeight is read from `JURISDICTIONS`, and the local override
// bonus (+10) applies when the operator's session is inside the
// requirement's own jurisdiction.
//
// See EVENKEEL_BIBLE.md §13.3 and §20 for the full specification.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RequirementV2,
  RegulatoryConflict,
  ConflictResolution,
} from "./types";
import {
  JURISDICTIONS,
  SEVERITY_WEIGHT,
  LOCAL_OVERRIDE_BONUS,
} from "./jurisdictions";

export function scoreRequirement(
  req: RequirementV2,
  studentJurisdiction?: string
): number {
  const severity = SEVERITY_WEIGHT[req.severity] ?? 0;
  const jurisdiction = JURISDICTIONS[req.jurisdiction]?.weight ?? 0;
  const local =
    studentJurisdiction && req.jurisdiction === studentJurisdiction
      ? LOCAL_OVERRIDE_BONUS
      : 0;
  return severity + jurisdiction + local;
}

export interface PrioritizeResult {
  status: ConflictResolution;
  winner?: RequirementV2;
  loser?: RequirementV2;
  justification: string;
  scoreA: number;
  scoreB: number;
}

export function prioritize(
  conflict: RegulatoryConflict,
  studentJurisdiction?: string
): PrioritizeResult {
  const scoreA = scoreRequirement(conflict.requirementA, studentJurisdiction);
  const scoreB = scoreRequirement(conflict.requirementB, studentJurisdiction);

  if (scoreA === scoreB) {
    return {
      status: "RESOLVED_MERGED",
      justification:
        "Tie in priority score. Applying the strictest subset of both requirements (conservative merge).",
      scoreA,
      scoreB,
    };
  }

  const winner = scoreA > scoreB ? conflict.requirementA : conflict.requirementB;
  const loser = scoreA > scoreB ? conflict.requirementB : conflict.requirementA;

  const localNote =
    studentJurisdiction && winner.jurisdiction === studentJurisdiction
      ? ` Local jurisdiction (${studentJurisdiction}) +${LOCAL_OVERRIDE_BONUS} weight applied.`
      : "";

  return {
    status: "RESOLVED_PRIORITY",
    winner,
    loser,
    justification: `${winner.jurisdiction} ${winner.documentRef} (${winner.severity}, score ${Math.max(
      scoreA,
      scoreB
    )}) takes precedence over ${loser.jurisdiction} ${loser.documentRef} (${loser.severity}, score ${Math.min(
      scoreA,
      scoreB
    )}).${localNote}`,
    scoreA,
    scoreB,
  };
}
