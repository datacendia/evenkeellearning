import { describe, it, expect } from "vitest";
import {
  validateCRTEvent,
  validateRequirementV2,
  validateRegulatoryConflict,
  validateBusEvent,
  validateInteractionPattern,
  assertOk,
} from "@/lib/validators";

describe("validators", () => {
  it("validates a well-formed CRTEvent", () => {
    const r = validateCRTEvent({
      id: "evt-1",
      timestamp: 123,
      eventType: "submission",
      hash: "abcdef",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a CRTEvent with a bad eventType", () => {
    const r = validateCRTEvent({
      id: "evt-1",
      timestamp: 123,
      eventType: "explosion",
      hash: "abcdef",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(",")).toMatch(/eventType/);
  });

  it("validates a RequirementV2 with active status", () => {
    const r = validateRequirementV2({
      id: "ie-1",
      jurisdiction: "IE",
      documentRef: "IE-DPA",
      severity: "high",
      triggerType: "age_gate",
      constraint: "x",
      status: "active",
    });
    expect(r.ok).toBe(true);
  });

  it("validates a regulatory conflict", () => {
    const req = {
      id: "x",
      jurisdiction: "IE",
      documentRef: "X",
      severity: "high",
      triggerType: "age_gate",
      constraint: "c",
    };
    const r = validateRegulatoryConflict({
      id: "c1",
      requirementA: req,
      requirementB: req,
      conflictType: "DIRECT",
      resolutionStatus: "UNRESOLVED",
      detectedAt: 1,
    });
    expect(r.ok).toBe(true);
  });

  it("validates a BusEvent", () => {
    const r = validateBusEvent({
      type: "student.submit",
      payload: { trust: 80 },
      ts: 1,
      id: "1-a",
      source: "student",
    });
    expect(r.ok).toBe(true);
  });

  it("validates an InteractionPattern with mimicryProbability ∈ [0,1]", () => {
    const r = validateInteractionPattern({
      studentId: "s",
      sessionId: "s1",
      averageThinkTime: 10,
      keystrokeCadence: [10, 12, 14],
      pasteAttempts: 0,
      mimicryProbability: 0.2,
      isSuspicious: false,
    });
    expect(r.ok).toBe(true);
  });

  it("assertOk throws on a failed result", () => {
    expect(() =>
      assertOk(validateCRTEvent({}), "CRTEvent")
    ).toThrow(/CRTEvent failed/);
  });
});
