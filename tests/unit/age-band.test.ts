// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/age-band.test.ts
//
// Pin the observable contract of the age-band module:
//   1. Default state is null (no band declared).
//   2. setAgeBand persists, getAgeBand reads it back.
//   3. Invalid stored values are treated as null.
//   4. requiresGuardianSafeguards is true only for "under-13".
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAgeBand,
  getAgeBand,
  requiresGuardianSafeguards,
  setAgeBand,
} from "@/lib/auth/age-band";

describe("auth/age-band", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no band is set", () => {
    expect(getAgeBand()).toBeNull();
  });

  it("round-trips each known band", () => {
    setAgeBand("under-13");
    expect(getAgeBand()).toBe("under-13");
    setAgeBand("13-17");
    expect(getAgeBand()).toBe("13-17");
    setAgeBand("18-plus");
    expect(getAgeBand()).toBe("18-plus");
  });

  it("returns null for malformed stored value", () => {
    window.localStorage.setItem("evenkeel/age-band", "bogus");
    expect(getAgeBand()).toBeNull();
  });

  it("clearAgeBand removes the value", () => {
    setAgeBand("13-17");
    clearAgeBand();
    expect(getAgeBand()).toBeNull();
  });

  it("only under-13 requires guardian safeguards", () => {
    expect(requiresGuardianSafeguards("under-13")).toBe(true);
    expect(requiresGuardianSafeguards("13-17")).toBe(false);
    expect(requiresGuardianSafeguards("18-plus")).toBe(false);
    expect(requiresGuardianSafeguards(null)).toBe(false);
  });
});
