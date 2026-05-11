// ─────────────────────────────────────────────────────────────────────────────
// scripts/build-repro-manifest.mjs
//
// Builds `evidence/reproducibility-manifest.json` — the artefact a reviewer
// can use to verify they're looking at exactly the codebase that produced a
// given audit pass. The manifest contains:
//
//   • SHA-256 hashes of every governed source file (lib, app, components,
//     scripts, tests).
//   • SHA-256 hashes of every governance document (HONESTY, CHANGELOG,
//     EVEN_KEEL_BIBLE, SAFEGUARDING, README, PROPOSAL_TRUTH_PACK,
//     PROPOSAL_REWRITER_NOTES).
//   • A dependency snapshot: package.json hash, package-lock.json hash,
//     resolved-dep count, declared engine version range.
//   • A pointer to the most recent audit test-manifest in `evidence/`,
//     plus its sha256 and pass/fail/skipped counters.
//   • Git HEAD sha and branch (graceful fallback if `git` is unavailable
//     or the workspace is not a git repo).
//   • An algorithm marker so a verifier knows which crypto to use.
//
// Why no signature on the manifest itself in v1?
// ──────────────────────────────────────────────
// The manifest's integrity is anchored in (a) the SHA-256 hashes it
// contains and (b) git history. Adding ECDSA on top of git would be
// aesthetically pleasing but operationally redundant, and the per-tab
// session signing key from `lib/crypto/signing.ts` is the wrong tool
// for an artefact that is meant to outlive a browser tab. The
// `transparency-bundle export` (Item 8) is the right place to wrap the
// manifest in an ECDSA-signed envelope using a longer-lived key.
//
// Usage
// ─────
//   node scripts/build-repro-manifest.mjs            # build to default path
//   node scripts/build-repro-manifest.mjs --quiet    # suppress progress
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, posix, relative, sep } from "node:path";

export const MANIFEST_PATH = join("evidence", "reproducibility-manifest.json");
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = "SHA-256";

/** Top-level directories to scan for source files. */
export const SOURCE_ROOTS = [
  "app",
  "components",
  "lib",
  "scripts",
  "tests",
  "public",
];

/** File extensions that count as "source" — TS/TSX/JS/MJS/CSS/JSON/MD. */
export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".html",
  ".svg",
]);

/** Directory names to skip recursively, no matter where they appear. */
export const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  ".vercel",
  ".turbo",
  "dist",
  "build",
  "evidence", // contents are themselves outputs we point at, not hash directly
  "reports",
]);

/**
 * Specific relative POSIX paths to skip, even though their directory is
 * included in SOURCE_ROOTS and their extension is in SOURCE_EXTENSIONS.
 *
 * These are *build artefacts* written AFTER this script runs, so hashing
 * them would create a circular dependency: the transparency bundle pins
 * the repro-manifest's sha, but the repro manifest would also pin the
 * transparency bundle's sha, which changes every time it's re-signed.
 * The transparency bundle is already cryptographically anchored by its
 * own signature; we don't need to double-anchor it here.
 */
export const EXCLUDE_FILES = new Set([
  "public/transparency-bundle.json",
]);

/**
 * Top-level governance documents whose contents are hashed individually
 * even though they're not in `SOURCE_ROOTS`. This is the explicit list
 * named in HONESTY.md §2.1 + the audit script's required-files check,
 * which means a missing or renamed governance doc shows up in two
 * places at once.
 */
export const GOVERNANCE_DOCS = [
  "README.md",
  "HONESTY.md",
  "CHANGELOG.md",
  "EVEN_KEEL_BIBLE.md",
  "SAFEGUARDING.md",
  "docs/PROPOSAL_TRUTH_PACK.md",
  "docs/PROPOSAL_REWRITER_NOTES.md",
];

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

/** Returns the lowercase `.ext` portion of a path, including the dot. */
export function fileExt(p) {
  const m = /(\.[^.\\/]+)$/.exec(p);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Normalises a path to forward-slash form for stable cross-OS hashing.
 * Replaces BOTH separators so a path built on Windows and a path built
 * on Linux hash to the same bytes. Splitting on the platform `sep` only
 * works on the platform that produced the path — which is exactly the
 * thing this function exists to undo.
 */
export function toPosix(p) {
  return p.replace(/[\\/]+/g, posix.sep);
}

/**
 * Returns an array of source file paths under `cwd`, deterministically
 * ordered (lexicographic by POSIX-normalised path). Excludes anything
 * under EXCLUDE_DIRS and any extension not in SOURCE_EXTENSIONS.
 */
export function collectSourceFiles(cwd) {
  /** @type {string[]} */
  const out = [];
  for (const root of SOURCE_ROOTS) {
    const abs = join(cwd, root);
    if (!existsSync(abs)) continue;
    walk(abs, cwd, out);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function walk(dir, cwd, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, cwd, out);
    } else if (entry.isFile()) {
      const ext = fileExt(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      const rel = toPosix(relative(cwd, abs));
      if (EXCLUDE_FILES.has(rel)) continue;
      out.push(rel);
    }
  }
}

/** Returns base64url SHA-256 of the file's bytes. Throws on missing file. */
export function hashFile(absolutePath) {
  const bytes = readFileSync(absolutePath);
  return base64Url(createHash("sha256").update(bytes).digest());
}

/** Returns base64url SHA-256 of an arbitrary string. */
export function hashString(s) {
  return base64Url(createHash("sha256").update(s).digest());
}

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds the dependency snapshot. Reads `package.json` (deps + dev counts +
 * engines.node) and `package-lock.json` (hash + total resolved-package
 * count). Both are required; if `package-lock.json` is missing, returns
 * `lockfilePresent: false` and the bundle is flagged in `verify`.
 */
export function buildDependencySnapshot(cwd) {
  const pkgPath = join(cwd, "package.json");
  const pkgRaw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const lockPath = join(cwd, "package-lock.json");
  const lockfilePresent = existsSync(lockPath);
  const lockHash = lockfilePresent ? hashFile(lockPath) : null;
  let resolvedPackages = 0;
  if (lockfilePresent) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      // npm v7+ uses "packages"; v6 used "dependencies". Count both.
      const packages = lock.packages
        ? Object.keys(lock.packages).filter((k) => k !== "")
        : Object.keys(lock.dependencies ?? {});
      resolvedPackages = packages.length;
    } catch {
      resolvedPackages = -1;
    }
  }
  return {
    packageName: pkg.name,
    packageVersion: pkg.version,
    enginesNode: pkg.engines?.node ?? null,
    declaredDependencies: Object.keys(pkg.dependencies ?? {}).length,
    declaredDevDependencies: Object.keys(pkg.devDependencies ?? {}).length,
    packageJsonSha256: hashString(pkgRaw),
    lockfilePresent,
    lockfileSha256: lockHash,
    resolvedPackages,
  };
}

/**
 * Returns `{ filename, sha256, counters }` for the most recent
 * `evidence/test-manifest-enterprise-complete-*.json`, or `null` if no
 * audit has ever run on this checkout.
 */
export function buildAuditPointer(cwd) {
  const dir = join(cwd, "evidence");
  if (!existsSync(dir)) return null;
  const candidates = readdirSync(dir)
    .filter(
      (f) =>
        f.startsWith("test-manifest-enterprise-complete-") &&
        f.endsWith(".json"),
    )
    .sort();
  if (candidates.length === 0) return null;
  const latest = candidates[candidates.length - 1];
  const abs = join(dir, latest);
  const sha = hashFile(abs);
  let counters = null;
  try {
    const json = JSON.parse(readFileSync(abs, "utf8"));
    counters = json.counters ?? null;
  } catch {
    // ignore — leave counters null
  }
  return {
    filename: latest,
    sha256: sha,
    counters,
  };
}

/**
 * Captures git HEAD sha + branch via `git` if available. Returns `null`
 * (not an error) when the workspace is not a git repo or `git` is not on
 * the PATH — the manifest is still valid without it; git is provenance
 * gravy on top of file hashes.
 */
export function buildGitFingerprint(cwd) {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    let branch = null;
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // detached HEAD — leave branch null
    }
    let dirty = false;
    try {
      const status = execSync("git status --porcelain", {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      dirty = status.length > 0;
    } catch {
      // ignore
    }
    return { headSha: sha, branch, workingTreeDirty: dirty };
  } catch {
    return null;
  }
}

/** Builds the full manifest object (no I/O beyond reading files). */
export function buildManifest(cwd, now = new Date()) {
  const sources = collectSourceFiles(cwd);
  const fileEntries = sources.map((relPath) => ({
    path: relPath,
    bytes: statSync(join(cwd, relPath)).size,
    sha256: hashFile(join(cwd, relPath)),
  }));

  const governance = GOVERNANCE_DOCS.map((relPath) => {
    const abs = join(cwd, relPath);
    if (!existsSync(abs)) {
      return { path: toPosix(relPath), present: false, sha256: null };
    }
    return {
      path: toPosix(relPath),
      present: true,
      sha256: hashFile(abs),
    };
  });

  const dependency = buildDependencySnapshot(cwd);
  const audit = buildAuditPointer(cwd);
  const git = buildGitFingerprint(cwd);

  // The aggregate hash is the SHA-256 of the deterministic concatenation of
  // every per-file hash. A reviewer who recomputes it from the manifest's
  // own `files` array can verify nothing was added, removed, or re-ordered
  // in the manifest itself.
  const aggregate = hashString(
    fileEntries.map((e) => `${e.path}\t${e.sha256}`).join("\n"),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    generatedAtIso: now.toISOString(),
    aggregateSha256: aggregate,
    dependency,
    audit,
    git,
    governance,
    files: fileEntries,
  };
}

/**
 * Writes the manifest to disk. Returns the path written. Creates
 * `evidence/` if it doesn't exist.
 */
export function writeManifest(cwd, manifest, manifestPath = MANIFEST_PATH) {
  const abs = join(cwd, manifestPath);
  const dir = abs.slice(0, abs.lastIndexOf(sep));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return abs;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function isMain() {
  // Robust on Windows + POSIX. `import.meta.url` is `file:///...`, while
  // `process.argv[1]` is a plain path on both.
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  const argvUrl = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
  return import.meta.url === argvUrl;
}

if (isMain()) {
  const quiet = process.argv.includes("--quiet");
  const cwd = process.cwd();
  if (!quiet) console.log("Building reproducibility manifest…");
  const manifest = buildManifest(cwd);
  const out = writeManifest(cwd, manifest);
  if (!quiet) {
    console.log(`Wrote ${out}`);
    console.log(`  files:           ${manifest.files.length}`);
    console.log(`  governance docs: ${manifest.governance.filter((g) => g.present).length}/${manifest.governance.length}`);
    console.log(`  aggregate sha:   ${manifest.aggregateSha256.slice(0, 16)}…`);
    if (manifest.git) {
      console.log(`  git HEAD:        ${manifest.git.headSha.slice(0, 12)}${manifest.git.workingTreeDirty ? " (dirty)" : ""}`);
    } else {
      console.log("  git HEAD:        (not a git checkout)");
    }
  }
}
