// Unit tests for the v1.4.7 reproducibility-manifest pipeline. The
// helpers under test are JSDoc-typed plain JS modules under `scripts/`;
// vitest can import them directly and exercise them against the live
// repo (read-only) plus a temp directory for the round-trip case.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXCLUDE_DIRS,
  GOVERNANCE_DOCS,
  HASH_ALGORITHM,
  MANIFEST_PATH,
  EXCLUDE_FILES,
  SCHEMA_VERSION,
  SOURCE_EXTENSIONS,
  SOURCE_ROOTS,
  buildManifest,
  collectSourceFiles,
  fileExt,
  hashString,
  toPosix,
  writeManifest,
  // @ts-expect-error — JSDoc-typed .mjs module; vitest resolves it natively.
} from "@/scripts/build-repro-manifest.mjs";

import {
  verifyManifest,
  // @ts-expect-error — JSDoc-typed .mjs module; vitest resolves it natively.
} from "@/scripts/verify-repro-manifest.mjs";

const REPO = process.cwd();

describe("repro-manifest: pure helpers", () => {
  it("fileExt returns the lowercase extension including the dot", () => {
    expect(fileExt("foo.TS")).toBe(".ts");
    expect(fileExt("Bar.tsx")).toBe(".tsx");
    expect(fileExt("noext")).toBe("");
    expect(fileExt("dotfile.")).toBe(""); // trailing dot = no extension
    expect(fileExt(".gitignore")).toBe(".gitignore"); // dot-file = extension is rest of name
    expect(fileExt("archive.tar.gz")).toBe(".gz");
  });

  it("toPosix normalises Windows separators", () => {
    expect(toPosix("a\\b\\c.ts")).toBe("a/b/c.ts");
    expect(toPosix("a/b/c.ts")).toBe("a/b/c.ts");
  });

  it("hashString is deterministic for equal inputs", () => {
    const a = hashString("the quick brown fox");
    const b = hashString("the quick brown fox");
    const c = hashString("the quick brown fox.");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("source-roots and excludes are non-empty and disjoint", () => {
    expect(SOURCE_ROOTS.length).toBeGreaterThan(0);
    expect(EXCLUDE_DIRS.size).toBeGreaterThan(0);
    expect(SOURCE_EXTENSIONS.has(".ts")).toBe(true);
    expect(SOURCE_EXTENSIONS.has(".tsx")).toBe(true);
    for (const root of SOURCE_ROOTS) {
      expect(EXCLUDE_DIRS.has(root)).toBe(false);
    }
  });

  it("collectSourceFiles returns paths in deterministic POSIX order", () => {
    const files: string[] = collectSourceFiles(REPO);
    expect(files.length).toBeGreaterThan(0);
    for (let i = 1; i < files.length; i++) {
      expect(files[i]!.localeCompare(files[i - 1]!)).toBeGreaterThanOrEqual(0);
    }
    // Every collected path should use forward slashes.
    for (const f of files) {
      expect(f.includes("\\")).toBe(false);
    }
  });

  it("collectSourceFiles never includes anything under EXCLUDE_DIRS", () => {
    const files: string[] = collectSourceFiles(REPO);
    for (const f of files) {
      const segments = f.split("/");
      for (const seg of segments) {
        expect(EXCLUDE_DIRS.has(seg)).toBe(false);
      }
    }
  });

  it("collectSourceFiles excludes build artefacts listed in EXCLUDE_FILES", () => {
    // Regression guard: v1.4.9 had a circular hash dependency because
    // the repro manifest hashed `public/transparency-bundle.json`, which
    // is itself regenerated after the repro manifest is built.
    expect(EXCLUDE_FILES.has("public/transparency-bundle.json")).toBe(true);
    const files: string[] = collectSourceFiles(REPO);
    for (const excluded of EXCLUDE_FILES) {
      expect(files).not.toContain(excluded);
    }
  });
});

describe("repro-manifest: buildManifest schema", () => {
  it("returns the schema-1 envelope with deterministic shape", () => {
    const m = buildManifest(REPO);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.hashAlgorithm).toBe(HASH_ALGORITHM);
    expect(typeof m.generatedAtIso).toBe("string");
    expect(m.aggregateSha256).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.isArray(m.files)).toBe(true);
    expect(m.files.length).toBeGreaterThan(0);
    expect(Array.isArray(m.governance)).toBe(true);
    expect(m.governance.length).toBe(GOVERNANCE_DOCS.length);
    expect(typeof m.dependency).toBe("object");
    // `audit` and `git` may legitimately be null on a fresh checkout;
    // we don't pin their presence.
  });

  it("every file entry has path, bytes and a base64url sha256", () => {
    const m = buildManifest(REPO);
    for (const e of m.files) {
      expect(typeof e.path).toBe("string");
      expect(e.path.length).toBeGreaterThan(0);
      expect(typeof e.bytes).toBe("number");
      expect(e.bytes).toBeGreaterThanOrEqual(0);
      expect(e.sha256).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("dependency snapshot reads package.json and lockfile coherently", () => {
    const m = buildManifest(REPO);
    expect(m.dependency.packageName).toBe("even-keel-learning");
    expect(typeof m.dependency.packageVersion).toBe("string");
    expect(typeof m.dependency.packageJsonSha256).toBe("string");
    expect(typeof m.dependency.lockfilePresent).toBe("boolean");
    if (m.dependency.lockfilePresent) {
      expect(m.dependency.lockfileSha256).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(m.dependency.resolvedPackages).toBeGreaterThanOrEqual(0);
    }
  });

  it("governance entries cover the explicit GOVERNANCE_DOCS list", () => {
    const m = buildManifest(REPO);
    const paths = m.governance.map((g: { path: string }) => g.path).sort();
    const expected = [...GOVERNANCE_DOCS].map(toPosix).sort();
    expect(paths).toEqual(expected);
    // At minimum, HONESTY.md and CHANGELOG.md must be present in this repo.
    const honesty = m.governance.find((g: { path: string }) => g.path === "HONESTY.md");
    const changelog = m.governance.find((g: { path: string }) => g.path === "CHANGELOG.md");
    expect(honesty?.present).toBe(true);
    expect(changelog?.present).toBe(true);
    expect(honesty?.sha256).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("aggregate sha is the SHA-256 of the concatenated `${path}\\t${sha}` rows", () => {
    const m = buildManifest(REPO);
    const recomputed = hashString(
      m.files
        .map((e: { path: string; sha256: string }) => `${e.path}\t${e.sha256}`)
        .join("\n"),
    );
    expect(recomputed).toBe(m.aggregateSha256);
  });

  it("two builds against an unchanged tree produce identical file & governance hashes", () => {
    const a = buildManifest(REPO);
    const b = buildManifest(REPO);
    expect(b.aggregateSha256).toBe(a.aggregateSha256);
    expect(b.files.map((e: { sha256: string }) => e.sha256)).toEqual(
      a.files.map((e: { sha256: string }) => e.sha256),
    );
    expect(b.governance.map((g: { sha256: string | null }) => g.sha256)).toEqual(
      a.governance.map((g: { sha256: string | null }) => g.sha256),
    );
    // generatedAtIso may differ between calls; that's expected and not pinned.
  });
});

describe("repro-manifest: verify on the live repo", () => {
  it("MANIFEST_PATH points into evidence/", () => {
    expect(MANIFEST_PATH).toMatch(/evidence/);
  });

  it("buildManifest → verifyManifest round-trips against the same tree", () => {
    const m = buildManifest(REPO);
    const result = verifyManifest(REPO, m);
    expect(result.ok).toBe(true);
    expect(result.filesChecked).toBe(m.files.length);
    expect(result.filesMissing).toBe(0);
    expect(result.mismatches).toEqual([]);
  });
});

describe("repro-manifest: tamper detection (sandboxed)", () => {
  // Build a tiny disposable repo with the same directory shape, run the
  // full build → mutate → verify cycle. This proves the hash chain
  // catches tampering without depending on the live workspace.
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "repro-test-"));
    mkdirSync(join(sandbox, "lib"), { recursive: true });
    mkdirSync(join(sandbox, "app"), { recursive: true });
    mkdirSync(join(sandbox, "evidence"), { recursive: true });
    writeFileSync(
      join(sandbox, "package.json"),
      JSON.stringify({ name: "sandbox", version: "0.0.0" }, null, 2),
    );
    writeFileSync(join(sandbox, "lib", "alpha.ts"), "export const ALPHA = 1;\n");
    writeFileSync(join(sandbox, "lib", "beta.ts"), "export const BETA = 2;\n");
    writeFileSync(join(sandbox, "app", "page.tsx"), "export default function P() { return null; }\n");
    writeFileSync(join(sandbox, "HONESTY.md"), "# Sandbox HONESTY\n");
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("clean tree: build → write → verify is ok", () => {
    const m = buildManifest(sandbox);
    writeManifest(sandbox, m);
    const written = JSON.parse(
      readFileSync(join(sandbox, MANIFEST_PATH), "utf8"),
    );
    expect(written.aggregateSha256).toBe(m.aggregateSha256);
    const result = verifyManifest(sandbox, m);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("source mutation: verify reports a file-hash mismatch on the mutated file", () => {
    const m = buildManifest(sandbox);
    writeFileSync(join(sandbox, "lib", "alpha.ts"), "export const ALPHA = 999;\n");
    const result = verifyManifest(sandbox, m);
    expect(result.ok).toBe(false);
    const mismatch = result.mismatches.find(
      (mm: { kind: string; path: string }) =>
        mm.kind === "file-hash" && mm.path === "lib/alpha.ts",
    );
    expect(mismatch).toBeDefined();
  });

  it("file deletion: verify reports a file-missing entry", () => {
    // First, restore lib/alpha.ts so we have a known clean baseline,
    // then rebuild and delete a different file.
    writeFileSync(join(sandbox, "lib", "alpha.ts"), "export const ALPHA = 1;\n");
    const m = buildManifest(sandbox);
    rmSync(join(sandbox, "lib", "beta.ts"));
    const result = verifyManifest(sandbox, m);
    expect(result.ok).toBe(false);
    const missing = result.mismatches.find(
      (mm: { kind: string; path: string }) =>
        mm.kind === "file-missing" && mm.path === "lib/beta.ts",
    );
    expect(missing).toBeDefined();
    expect(result.filesMissing).toBeGreaterThanOrEqual(1);
  });

  it("governance tamper: verify reports a governance-hash mismatch", () => {
    // Restore beta.ts before this test so file-missing isn't conflated.
    writeFileSync(join(sandbox, "lib", "beta.ts"), "export const BETA = 2;\n");
    const m = buildManifest(sandbox);
    writeFileSync(join(sandbox, "HONESTY.md"), "# Sandbox HONESTY (tampered)\n");
    const result = verifyManifest(sandbox, m);
    expect(result.ok).toBe(false);
    const mismatch = result.mismatches.find(
      (mm: { kind: string; path: string }) =>
        mm.kind === "governance-hash" && mm.path === "HONESTY.md",
    );
    expect(mismatch).toBeDefined();
  });

  it("dependency tamper: verify reports a dependency-package-json mismatch", () => {
    // Restore HONESTY.md.
    writeFileSync(join(sandbox, "HONESTY.md"), "# Sandbox HONESTY\n");
    const m = buildManifest(sandbox);
    writeFileSync(
      join(sandbox, "package.json"),
      JSON.stringify({ name: "sandbox", version: "9.9.9" }, null, 2),
    );
    const result = verifyManifest(sandbox, m);
    expect(result.ok).toBe(false);
    const mismatch = result.mismatches.find(
      (mm: { kind: string }) => mm.kind === "dependency-package-json",
    );
    expect(mismatch).toBeDefined();
  });
});
