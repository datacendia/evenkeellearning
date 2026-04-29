import { describe, it, expect } from "vitest";
import { prioritize } from "@/lib/regulatory-absorb/prioritizer";
import type { RegulatoryConflict, RequirementV2 } from "@/lib/regulatory-absorb/types";

const reqA: RequirementV2 = {
  id: "ie-dpa-2018-s31",
  jurisdiction: "IE",
  documentRef: "IE-DPA-2018-s31",
  severity: "high",
  triggerType: "age_gate",
  constraint: "Children under 13 require verified parental consent.",
  status: "active",
};

const reqB: RequirementV2 = {
  id: "us-coppa-312-5",
  jurisdiction: "US",
  documentRef: "US-COPPA-§312.5",
  severity: "critical",
  triggerType: "age_gate",
  constraint: "Verifiable parental consent for under-13 in the United States.",
  status: "active",
};

const conflict: RegulatoryConflict = {
  id: "conflict-1",
  requirementA: reqA,
  requirementB: reqB,
  conflictType: "DIRECT",
  resolutionStatus: "UNRESOLVED",
  detectedAt: Date.now(),
};

describe("regulatory-absorb/prioritizer", () => {
  it("higher severity beats lower severity", () => {
    const r = prioritize(conflict, "IE");
    // Even though IE gets a local-override bonus, US's severity=critical (100) > IE's high (75).
    // IE local bonus is +10. We expect US (100 + 15) = 115 vs IE (75 + 25 + 10) = 110. US wins.
    expect(r.winner?.id).toBe(reqB.id);
  });

  it("operator jurisdiction adds a local-override bonus", () => {
    // Tie the severities so the local bonus matters.
    const a = { ...reqA, severity: "high" as const };
    const b = { ...reqB, severity: "high" as const };
    const c: RegulatoryConflict = { ...conflict, requirementA: a, requirementB: b };
    const local = prioritize(c, "IE");
    expect(local.winner?.id).toBe(a.id);
  });

  it("returns deterministic scores for both requirements", () => {
    const r1 = prioritize(conflict, "IE");
    const r2 = prioritize(conflict, "IE");
    expect(r1.scoreA).toBe(r2.scoreA);
    expect(r1.scoreB).toBe(r2.scoreB);
  });
});
