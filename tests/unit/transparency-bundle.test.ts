// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/transparency-bundle.test.ts
//
// Pins SAFEGUARDING.md §1.9. The transparency bundle must:
//   1. Build to a stable schema (v1) with all four components present.
//   2. Sign the canonical bundle with a build-time ECDSA P-256 key.
//   3. Round-trip through the verifier with no errors when nothing has
//      changed on disk.
//   4. Detect any single-byte tamper of any component.
//   5. Detect any tamper of the embedded `componentDigestB64url`.
//   6. Detect any tamper of the embedded signature bytes.
//   7. Use a canonical-JSON serializer so signing is independent of
//      object-key insertion order.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  buildBundle,
  canonicaliseForSigning,
} from "@/scripts/build-transparency-bundle.mjs";
import { verifyBundle } from "@/scripts/verify-transparency-bundle.mjs";
import { writeFileSync, mkdirSync, existsSync, readFileSync, mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Build a bundle in a fresh temp working directory that contains real,
 * minimal copies of the four input streams, then run the verifier in that
 * same dir. We do NOT mutate the real `evidence/` to keep the repo's
 * canonical bundle deterministic and out-of-band of the test run.
 */
function setupSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "evenkeel-tb-"));
  // package.json
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "even-keel-learning", version: "1.4.9" }),
    "utf8",
  );
  // governance docs (minimal stubs — the bundle pins sha256, not content)
  for (const rel of [
    "README.md",
    "HONESTY.md",
    "CHANGELOG.md",
    "EVEN_KEEL_BIBLE.md",
    "SAFEGUARDING.md",
  ]) {
    writeFileSync(join(dir, rel), `# ${rel}\nstub for sandbox test\n`, "utf8");
  }
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "PROPOSAL_TRUTH_PACK.md"), "# pack\n", "utf8");
  writeFileSync(join(dir, "docs", "PROPOSAL_REWRITER_NOTES.md"), "# notes\n", "utf8");

  // Use the real control map so the schema invariants hold.
  mkdirSync(join(dir, "compliance"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "compliance", "kcsie-2025-prevent-duty-map.json"),
    join(dir, "compliance", "kcsie-2025-prevent-duty-map.json"),
  );

  // A minimal, syntactically-valid reproducibility manifest.
  mkdirSync(join(dir, "evidence"), { recursive: true });
  writeFileSync(
    join(dir, "evidence", "reproducibility-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      hashAlgorithm: "SHA-256",
      generatedAtIso: "2026-04-27T00:00:00.000Z",
      aggregateSha256: "AAAA_test_aggregate_BBBB",
      governance: [{ path: "HONESTY.md", present: true, sha256: "x" }],
      files: [{ path: "lib/x.ts", bytes: 1, sha256: "x" }],
    }),
    "utf8",
  );
  // A minimal audit manifest.
  writeFileSync(
    join(dir, "evidence", "test-manifest-enterprise-complete-20260427000000.json"),
    JSON.stringify({
      generatedAt: "2026-04-27T00:00:00.000+00:00",
      counters: { totalPassed: 17, totalFailed: 0, totalSkipped: 0 },
    }),
    "utf8",
  );
  return dir;
}

function buildAndWrite(dir: string) {
  const bundle = buildBundle(dir, new Date("2026-04-27T12:00:00.000Z"));
  writeFileSync(
    join(dir, "evidence", "transparency-bundle.json"),
    JSON.stringify(bundle, null, 2),
    "utf8",
  );
  return bundle;
}

describe("transparency-bundle: schema", () => {
  it("emits v1 schema with all four component streams", () => {
    const dir = setupSandbox();
    const bundle = buildBundle(dir);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.signingAlgorithm).toBe("ECDSA-P256-SHA256");
    expect(bundle.components.governance.length).toBeGreaterThanOrEqual(7);
    expect(bundle.components.controlMap.present).toBe(true);
    expect(bundle.components.reproducibility.present).toBe(true);
    expect(bundle.components.audit.present).toBe(true);
    expect(bundle.componentDigestB64url.length).toBeGreaterThan(0);
    expect(bundle.signature.publicKeyB64url.length).toBeGreaterThan(0);
    expect(bundle.signature.signatureB64url.length).toBeGreaterThan(0);
    expect(bundle.signature.keyType).toBe("ephemeral-build-time");
  });

  it("surfaces control-map summary fields", () => {
    const dir = setupSandbox();
    const bundle = buildBundle(dir);
    const cm = bundle.components.controlMap;
    expect(cm.controlsCount).toBeGreaterThanOrEqual(10);
    expect(cm.frameworks).toContain("KCSIE_2025");
    expect(typeof cm.phase1Counts).toBe("object");
  });
});

describe("transparency-bundle: canonical JSON for signing", () => {
  it("is independent of object-key insertion order", () => {
    const a = canonicaliseForSigning({
      schemaVersion: 1,
      generatedAtIso: "z",
      components: { governance: [], controlMap: {}, reproducibility: {}, audit: {} },
    });
    const b = canonicaliseForSigning({
      components: { audit: {}, reproducibility: {}, controlMap: {}, governance: [] },
      generatedAtIso: "z",
      schemaVersion: 1,
    });
    expect(a).toBe(b);
  });

  it("strips the signature field from the canonical input", () => {
    const c = canonicaliseForSigning({
      schemaVersion: 1,
      signature: { signatureB64url: "ZZZZ" },
    });
    expect(c).not.toContain("ZZZZ");
  });
});

describe("transparency-bundle: round-trip verify", () => {
  it("verifies a freshly built bundle in the same sandbox", () => {
    const dir = setupSandbox();
    buildAndWrite(dir);
    const r = verifyBundle(dir);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("returns ok=false when the bundle is missing", () => {
    const dir = setupSandbox();
    const r = verifyBundle(dir);
    expect(r.ok).toBe(false);
    expect(r.errors[0].toLowerCase()).toContain("not found");
  });
});

describe("transparency-bundle: tamper detection", () => {
  it("detects a governance-doc edit after the bundle was built", () => {
    const dir = setupSandbox();
    buildAndWrite(dir);
    writeFileSync(join(dir, "HONESTY.md"), "# tampered after build\n", "utf8");
    const r = verifyBundle(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => e.includes("HONESTY.md"))).toBe(true);
  });

  it("detects componentDigestB64url tampering", () => {
    const dir = setupSandbox();
    const bundle = buildAndWrite(dir);
    const tampered = { ...bundle, componentDigestB64url: "AAAAforged" };
    writeFileSync(
      join(dir, "evidence", "transparency-bundle.json"),
      JSON.stringify(tampered, null, 2),
      "utf8",
    );
    const r = verifyBundle(dir);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => e.toLowerCase().includes("componentdigest"))).toBe(true);
  });

  it("detects signature bytes tampering", () => {
    const dir = setupSandbox();
    const bundle = buildAndWrite(dir);
    const flippedSig =
      bundle.signature.signatureB64url.charAt(0) === "A"
        ? "B" + bundle.signature.signatureB64url.slice(1)
        : "A" + bundle.signature.signatureB64url.slice(1);
    const tampered = {
      ...bundle,
      signature: { ...bundle.signature, signatureB64url: flippedSig },
    };
    writeFileSync(
      join(dir, "evidence", "transparency-bundle.json"),
      JSON.stringify(tampered, null, 2),
      "utf8",
    );
    const r = verifyBundle(dir);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e: string) =>
          e.toLowerCase().includes("signature") || e.toLowerCase().includes("verify"),
      ),
    ).toBe(true);
  });

  it("detects a control-map edit after the bundle was built", () => {
    const dir = setupSandbox();
    buildAndWrite(dir);
    const cmPath = join(dir, "compliance", "kcsie-2025-prevent-duty-map.json");
    const raw = readFileSync(cmPath, "utf8");
    writeFileSync(cmPath, raw + "\n", "utf8");
    const r = verifyBundle(dir);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some(
        (e: string) =>
          e.toLowerCase().includes("control map") || e.toLowerCase().includes("controlmap"),
      ),
    ).toBe(true);
  });
});

describe("transparency-bundle: real-codebase build (smoke)", () => {
  it("builds against the actual repo without throwing and signs cleanly", () => {
    // We only assert the bundle constructs and is internally consistent;
    // we do NOT write the real evidence/ artefact from a unit test.
    const bundle = buildBundle(REPO_ROOT);
    expect(bundle.engineVersion.startsWith("evenkeel@")).toBe(true);
    expect(bundle.signature.signatureB64url.length).toBeGreaterThan(0);
    expect(existsSync(REPO_ROOT)).toBe(true); // sanity
  });
});
