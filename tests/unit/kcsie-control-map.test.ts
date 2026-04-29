// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/kcsie-control-map.test.ts
//
// Pins the honesty contract on `compliance/kcsie-2025-prevent-duty-map.json`
// (SAFEGUARDING.md §1.8): every cited evidence path must exist on disk, and
// every control must declare a known framework + phase1Status. CI step
// `node scripts/audit.mjs --strict` re-checks the path contract; this test
// is the developer-feedback-loop equivalent.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const MAP_PATH = resolve(REPO_ROOT, "compliance/kcsie-2025-prevent-duty-map.json");

interface Evidence {
  path: string;
  claim: string;
}
interface Control {
  id: string;
  framework: string;
  clause: string;
  summary: string;
  phase1Status: string;
  evidence: Evidence[];
  phase2Gap: string | null;
}
interface ControlMap {
  title: string;
  version: string;
  publishedAt: string;
  engineVersion: string;
  scope: string;
  honestyContract: string;
  phase1Limitations: string[];
  controls: Control[];
}

const MAP: ControlMap = JSON.parse(readFileSync(MAP_PATH, "utf-8")) as ControlMap;

const KNOWN_FRAMEWORKS = new Set([
  "KCSIE_2025",
  "Prevent_Duty",
  "DfE_F_M_2023",
  "GDPR_UK",
]);
const KNOWN_PHASE1 = new Set(["supported", "partial", "phase2"]);

describe("kcsie-2025-prevent-duty-map.json: schema invariants", () => {
  it("declares all top-level honesty fields", () => {
    expect(MAP.title.length).toBeGreaterThan(0);
    expect(MAP.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MAP.engineVersion).toMatch(/^evenkeel@/);
    expect(MAP.scope.length).toBeGreaterThan(0);
    expect(MAP.honestyContract.length).toBeGreaterThan(0);
    expect(Array.isArray(MAP.phase1Limitations)).toBe(true);
    expect(MAP.phase1Limitations.length).toBeGreaterThan(0);
    expect(Array.isArray(MAP.controls)).toBe(true);
    expect(MAP.controls.length).toBeGreaterThanOrEqual(10);
  });

  it("every control declares known framework + phase1Status + evidence", () => {
    for (const c of MAP.controls) {
      expect(c.id, `control id present`).toBeTruthy();
      expect(KNOWN_FRAMEWORKS.has(c.framework), `unknown framework: ${c.framework}`)
        .toBe(true);
      expect(KNOWN_PHASE1.has(c.phase1Status), `unknown status: ${c.phase1Status}`)
        .toBe(true);
      expect(Array.isArray(c.evidence), `${c.id} evidence is array`).toBe(true);
      expect(c.evidence.length, `${c.id} has at least one evidence entry`)
        .toBeGreaterThan(0);
    }
  });

  it("every control id is unique", () => {
    const ids = MAP.controls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("`partial` and `phase2` controls declare a phase2Gap; `supported` MAY be null", () => {
    for (const c of MAP.controls) {
      if (c.phase1Status === "partial" || c.phase1Status === "phase2") {
        expect(c.phase2Gap, `${c.id} (${c.phase1Status}) must declare phase2Gap`)
          .toBeTruthy();
      }
    }
  });
});

describe("kcsie-2025-prevent-duty-map.json: evidence paths exist", () => {
  it("every cited evidence path resolves to a real file", () => {
    const missing: string[] = [];
    for (const c of MAP.controls) {
      for (const e of c.evidence) {
        const abs = resolve(REPO_ROOT, e.path);
        if (!existsSync(abs)) {
          missing.push(`${c.id} → ${e.path}`);
        }
      }
    }
    expect(missing, `missing evidence paths: ${missing.join(", ")}`).toEqual([]);
  });

  it("every evidence entry has a non-empty claim string", () => {
    for (const c of MAP.controls) {
      for (const e of c.evidence) {
        expect(e.claim.length, `${c.id} → ${e.path} claim`).toBeGreaterThan(0);
      }
    }
  });
});

describe("kcsie-2025-prevent-duty-map.json: required-coverage spot checks", () => {
  it("includes the v1.4.8 DSL escalation control", () => {
    const c = MAP.controls.find((x) => x.id === "KCSIE_2025_Part_2_DSL_Escalation");
    expect(c).toBeDefined();
    expect(c?.phase1Status).toBe("partial");
  });

  it("includes the GDPR Art. 25 privacy-by-design control", () => {
    const c = MAP.controls.find((x) => x.id === "GDPR_Art_25_Privacy_By_Design");
    expect(c).toBeDefined();
    expect(c?.framework).toBe("GDPR_UK");
  });

  it("includes the Prevent radicalisation control as honestly Phase 2", () => {
    const c = MAP.controls.find((x) => x.id === "Prevent_Duty_Risk_Assessment");
    expect(c).toBeDefined();
    expect(c?.phase1Status).toBe("phase2");
  });
});
