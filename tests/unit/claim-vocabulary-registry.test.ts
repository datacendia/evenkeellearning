import { describe, it, expect } from "vitest";
import {
  resolveSkillUriFromRegistry,
  resolveSkillUrisFromRegistry,
  type SkillUriResolver,
  type SpecPointClaim,
} from "@/lib/vc/claim-vocabulary";
import { buildRegistry, resolveSkillUri } from "@/lib/curriculum/registry";

const REG = buildRegistry([
  {
    id: "F1",
    name: "F1",
    awardingBody: "X",
    jurisdiction: "UK-EN",
    yearStart: 0,
    yearEnd: 0,
    specPoints: [
      { code: "A1", label: "x" },
      { code: "A2", label: "y" },
    ],
  },
]);

const resolver: SkillUriResolver = (framework, code) =>
  resolveSkillUri(REG, framework, code);

function claim(over: Partial<SpecPointClaim> = {}): SpecPointClaim {
  return {
    framework: "F1",
    code: "A1",
    claimVocabularyVersion: 1,
    ...over,
  };
}

describe("resolveSkillUriFromRegistry", () => {
  it("populates skillUri from the registry when absent", () => {
    const r = resolveSkillUriFromRegistry(claim(), resolver);
    expect(r.skillUri).toBe("https://evenkeel.org/curricula/f1/A1");
  });

  it("does NOT overwrite an existing skillUri", () => {
    const r = resolveSkillUriFromRegistry(
      claim({ skillUri: "urn:custom:claim" }),
      resolver,
    );
    expect(r.skillUri).toBe("urn:custom:claim");
  });

  it("returns claim unchanged when registry doesn't know the (framework, code)", () => {
    const r = resolveSkillUriFromRegistry(
      claim({ framework: "Unknown" }),
      resolver,
    );
    expect(r.skillUri).toBeUndefined();
    expect(r.framework).toBe("Unknown");
  });

  it("returns claim unchanged when code is unknown", () => {
    const r = resolveSkillUriFromRegistry(
      claim({ code: "MISSING" }),
      resolver,
    );
    expect(r.skillUri).toBeUndefined();
  });

  it("returns a NEW object (no aliasing)", () => {
    const c = claim();
    const r = resolveSkillUriFromRegistry(c, resolver);
    expect(r).not.toBe(c);
  });

  it("preserves label and other fields", () => {
    const r = resolveSkillUriFromRegistry(
      claim({ label: "Solve linear equations" }),
      resolver,
    );
    expect(r.label).toBe("Solve linear equations");
    expect(r.framework).toBe("F1");
    expect(r.claimVocabularyVersion).toBe(1);
  });
});

describe("resolveSkillUrisFromRegistry", () => {
  it("enriches every claim and preserves order", () => {
    const claims = [claim(), claim({ code: "A2" }), claim({ framework: "Unknown" })];
    const r = resolveSkillUrisFromRegistry(claims, resolver);
    expect(r).toHaveLength(3);
    expect(r[0]?.skillUri).toBe("https://evenkeel.org/curricula/f1/A1");
    expect(r[1]?.skillUri).toBe("https://evenkeel.org/curricula/f1/A2");
    expect(r[2]?.skillUri).toBeUndefined();
  });
});
