// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-repro-manifest.mjs
//
// Re-derives every hash recorded in `evidence/reproducibility-manifest.json`
// against the current working tree and reports mismatches. Exits with
// non-zero status when any per-file hash, governance-doc hash,
// dependency-snapshot hash, or audit-pointer hash differs from the
// manifest. The git fingerprint is informational only — a working tree
// that has moved past the manifest's HEAD sha is not, by itself, a
// reproducibility failure (the file hashes are the source of truth).
//
// Usage
// ─────
//   node scripts/verify-repro-manifest.mjs            # exit 0 on match
//   node scripts/verify-repro-manifest.mjs --quiet    # suppress per-row output
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MANIFEST_PATH,
  buildAuditPointer,
  buildDependencySnapshot,
  hashFile,
  toPosix,
} from "./build-repro-manifest.mjs";

/**
 * Verifies a manifest against a working tree. Returns a result object;
 * does no I/O beyond the file reads required to compute hashes.
 *
 * Exposed for unit tests; the CLI entry below is a thin wrapper.
 */
export function verifyManifest(cwd, manifest) {
  /** @type {Array<{ kind: string, path: string, expected: string|null, actual: string|null, reason?: string }>} */
  const mismatches = [];
  let filesChecked = 0;
  let filesMissing = 0;

  // Per-file hashes.
  for (const entry of manifest.files ?? []) {
    const abs = join(cwd, entry.path);
    if (!existsSync(abs)) {
      mismatches.push({
        kind: "file-missing",
        path: entry.path,
        expected: entry.sha256,
        actual: null,
        reason: "file no longer exists",
      });
      filesMissing += 1;
      continue;
    }
    filesChecked += 1;
    const actual = hashFile(abs);
    if (actual !== entry.sha256) {
      mismatches.push({
        kind: "file-hash",
        path: entry.path,
        expected: entry.sha256,
        actual,
      });
    }
    // Optional sanity: byte-length difference is a strong hint why the
    // hash mismatched — keep it informational only.
    if (typeof entry.bytes === "number") {
      const sz = statSync(abs).size;
      if (sz !== entry.bytes) {
        // Already reported as file-hash above; skip to keep noise down.
      }
    }
  }

  // Governance documents.
  for (const g of manifest.governance ?? []) {
    const abs = join(cwd, g.path);
    if (g.present && !existsSync(abs)) {
      mismatches.push({
        kind: "governance-missing",
        path: g.path,
        expected: g.sha256,
        actual: null,
        reason: "governance file no longer exists",
      });
      continue;
    }
    if (!g.present && existsSync(abs)) {
      mismatches.push({
        kind: "governance-added",
        path: g.path,
        expected: null,
        actual: hashFile(abs),
        reason: "governance file appeared since manifest was built",
      });
      continue;
    }
    if (g.present) {
      const actual = hashFile(abs);
      if (actual !== g.sha256) {
        mismatches.push({
          kind: "governance-hash",
          path: g.path,
          expected: g.sha256,
          actual,
        });
      }
    }
  }

  // Dependency snapshot.
  const dep = buildDependencySnapshot(cwd);
  if (manifest.dependency) {
    if (dep.packageJsonSha256 !== manifest.dependency.packageJsonSha256) {
      mismatches.push({
        kind: "dependency-package-json",
        path: "package.json",
        expected: manifest.dependency.packageJsonSha256,
        actual: dep.packageJsonSha256,
      });
    }
    if (dep.lockfilePresent !== manifest.dependency.lockfilePresent) {
      mismatches.push({
        kind: "dependency-lockfile-presence",
        path: "package-lock.json",
        expected: String(manifest.dependency.lockfilePresent),
        actual: String(dep.lockfilePresent),
      });
    } else if (
      dep.lockfilePresent &&
      dep.lockfileSha256 !== manifest.dependency.lockfileSha256
    ) {
      mismatches.push({
        kind: "dependency-lockfile-hash",
        path: "package-lock.json",
        expected: manifest.dependency.lockfileSha256,
        actual: dep.lockfileSha256,
      });
    }
  }

  // Audit pointer (best-effort: if the manifest pointed at a specific
  // test-manifest filename, that file should still exist with the same
  // hash; a *new* audit run is fine — it just doesn't get re-checked
  // here, because the pointer in the repro manifest is by design a
  // snapshot of "what was attested at build time").
  if (manifest.audit?.filename) {
    const auditPath = join("evidence", manifest.audit.filename);
    const abs = join(cwd, auditPath);
    if (!existsSync(abs)) {
      mismatches.push({
        kind: "audit-pointer-missing",
        path: toPosix(auditPath),
        expected: manifest.audit.sha256,
        actual: null,
        reason: "referenced audit manifest no longer present",
      });
    } else {
      const actual = hashFile(abs);
      if (actual !== manifest.audit.sha256) {
        mismatches.push({
          kind: "audit-pointer-hash",
          path: toPosix(auditPath),
          expected: manifest.audit.sha256,
          actual,
        });
      }
    }
    // Inform the caller if a *newer* audit has run since manifest
    // generation. This is not a mismatch — just a freshness signal.
  }

  return {
    ok: mismatches.length === 0,
    filesChecked,
    filesMissing,
    mismatches,
    latestAuditPointer: buildAuditPointer(cwd),
  };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function isMain() {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  const argvUrl = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
  return import.meta.url === argvUrl;
}

if (isMain()) {
  const quiet = process.argv.includes("--quiet");
  const cwd = process.cwd();
  const manifestAbs = join(cwd, MANIFEST_PATH);
  if (!existsSync(manifestAbs)) {
    console.error(
      `No reproducibility manifest at ${MANIFEST_PATH}. Run \`npm run repro:build\` first.`,
    );
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestAbs, "utf8"));
  const result = verifyManifest(cwd, manifest);

  if (!quiet) {
    console.log(
      `Reproducibility manifest: ${MANIFEST_PATH} (built ${manifest.generatedAtIso})`,
    );
    console.log(
      `  files checked:   ${result.filesChecked} / ${manifest.files?.length ?? 0}`,
    );
    console.log(`  files missing:   ${result.filesMissing}`);
    console.log(`  mismatches:      ${result.mismatches.length}`);
    if (result.mismatches.length > 0) {
      console.log("");
      for (const m of result.mismatches) {
        const exp = m.expected ? `${m.expected.slice(0, 12)}…` : "(none)";
        const act = m.actual ? `${m.actual.slice(0, 12)}…` : "(none)";
        const reason = m.reason ? `  // ${m.reason}` : "";
        console.log(`  [${m.kind}] ${m.path}`);
        console.log(`      expected ${exp}`);
        console.log(`      actual   ${act}${reason}`);
      }
    }
    if (
      result.latestAuditPointer &&
      manifest.audit &&
      result.latestAuditPointer.filename !== manifest.audit.filename
    ) {
      console.log("");
      console.log(
        `Note: a newer audit manifest (${result.latestAuditPointer.filename}) is present;`,
      );
      console.log(
        `      this is informational, not a mismatch.`,
      );
    }
  }

  process.exit(result.ok ? 0 : 1);
}
