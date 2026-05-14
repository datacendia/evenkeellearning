// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-transparency-bundle.mjs
//
// Re-derives every component sha256 in `evidence/transparency-bundle.json`
// against what's on disk RIGHT NOW, recomputes `componentDigestB64url`, and
// verifies the embedded ECDSA P-256 signature over the canonical bundle.
//
// Exits non-zero on:
//   • Bundle missing, malformed, or wrong schemaVersion
//   • Any governance / control-map / repro / audit sha256 differs from disk
//   • componentDigestB64url disagrees with the recomputed value
//   • Signature does not verify against the embedded public key
//
// Drift between the bundle and the codebase is treated as a failure, not a
// documentation update — same discipline as the KCSIE control map.
//
// SAFEGUARDING.md §1.9.
//
// Usage
// ─────
//   node scripts/verify-transparency-bundle.mjs           # human output
//   node scripts/verify-transparency-bundle.mjs --quiet   # silent on success
//   node scripts/verify-transparency-bundle.mjs --json    # machine output
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, verify as nodeVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLE_PATH,
  GOVERNANCE_DOCS,
  CONTROL_MAP_PATH,
  REPRO_MANIFEST_PATH,
  SCHEMA_VERSION,
  base64Url,
  canonicaliseForSigning,
  hashString,
  importPublicKeyFromB64url,
} from "./build-transparency-bundle.mjs";

function hashFileBytes(absolutePath) {
  const bytes = readFileSync(absolutePath);
  return base64Url(createHash("sha256").update(bytes).digest());
}

/**
 * Hash a TEXT file with line-ending normalisation. Mirrors the build
 * script's `hashTextFile` so a CRLF working tree (Windows) and an LF
 * working tree (Linux/CI) produce identical hashes for the same logical
 * content. See build-transparency-bundle.mjs for rationale.
 */
function hashTextFile(absolutePath) {
  const raw = readFileSync(absolutePath, "utf8");
  return hashString(raw);
}

function fromB64url(s) {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verifyBundle(cwd) {
  const errors = [];
  const findings = [];
  const abs = join(cwd, BUNDLE_PATH);
  if (!existsSync(abs)) {
    return {
      ok: false,
      bundlePath: abs,
      errors: ["Bundle not found. Run `npm run transparency:build` first."],
      findings,
    };
  }
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    return {
      ok: false,
      bundlePath: abs,
      errors: [`Bundle JSON parse failed: ${e.message}`],
      findings,
    };
  }
  if (bundle.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      `Unsupported schemaVersion ${bundle.schemaVersion} (expected ${SCHEMA_VERSION})`,
    );
  }

  // 1. Governance docs — re-hash each.
  for (const g of bundle.components?.governance ?? []) {
    const fileAbs = join(cwd, g.path);
    if (!existsSync(fileAbs)) {
      if (g.present) errors.push(`Governance ${g.path}: bundle says present but file is missing`);
      continue;
    }
    const sha = hashTextFile(fileAbs);
    if (sha !== g.sha256) {
      errors.push(`Governance ${g.path}: sha256 mismatch (bundle=${g.sha256?.slice(0, 12)}…, disk=${sha.slice(0, 12)}…)`);
    } else {
      findings.push(`governance.ok\t${g.path}`);
    }
  }
  // Also catch missing-from-bundle docs.
  const knownPaths = new Set((bundle.components?.governance ?? []).map((g) => g.path));
  for (const expected of GOVERNANCE_DOCS) {
    const norm = expected.replace(/\\/g, "/");
    if (!knownPaths.has(norm)) {
      errors.push(`Governance ${norm}: declared in build script but absent from bundle`);
    }
  }

  // 2. Control map.
  const cm = bundle.components?.controlMap;
  if (cm?.present) {
    const fileAbs = join(cwd, CONTROL_MAP_PATH);
    if (!existsSync(fileAbs)) {
      errors.push(`Control map: bundle says present but ${CONTROL_MAP_PATH} is missing`);
    } else {
      const sha = hashString(readFileSync(fileAbs, "utf8"));
      if (sha !== cm.sha256) {
        errors.push(`Control map: sha256 mismatch`);
      } else {
        findings.push(`controlMap.ok\t${cm.path}`);
      }
    }
  }

  // 3. Repro manifest.
  const rm = bundle.components?.reproducibility;
  if (rm?.present) {
    const fileAbs = join(cwd, REPRO_MANIFEST_PATH);
    if (!existsSync(fileAbs)) {
      errors.push(`Repro manifest: bundle says present but ${REPRO_MANIFEST_PATH} is missing`);
    } else {
      const sha = hashString(readFileSync(fileAbs, "utf8"));
      if (sha !== rm.sha256) {
        errors.push(`Repro manifest: sha256 mismatch`);
      } else {
        findings.push(`reproducibility.ok\t${rm.path}`);
      }
    }
  }

  // 4. Audit pointer.
  const au = bundle.components?.audit;
  if (au?.present) {
    const fileAbs = join(cwd, au.path);
    if (!existsSync(fileAbs)) {
      errors.push(`Audit manifest: bundle points at ${au.path} but it is gone`);
    } else {
      const sha = hashString(readFileSync(fileAbs, "utf8"));
      if (sha !== au.sha256) {
        errors.push(`Audit manifest: sha256 mismatch (file changed since build)`);
      } else {
        findings.push(`audit.ok\t${au.path}`);
      }
    }
  }

  // 5. Recompute componentDigest from in-bundle component shas.
  const lines = [
    ...(bundle.components?.governance ?? []).map(
      (g) => `governance\t${g.path}\t${g.sha256 ?? "(missing)"}`,
    ),
    `controlMap\t${cm?.path ?? CONTROL_MAP_PATH.replace(/\\/g, "/")}\t${cm?.sha256 ?? "(missing)"}`,
    `reproducibility\t${rm?.path ?? REPRO_MANIFEST_PATH.replace(/\\/g, "/")}\t${rm?.sha256 ?? "(missing)"}`,
    `audit\t${au?.path ?? "(none)"}\t${au?.sha256 ?? "(none)"}`,
  ];
  const recomputed = hashString(lines.join("\n"));
  if (recomputed !== bundle.componentDigestB64url) {
    errors.push(
      `componentDigestB64url mismatch (bundle=${bundle.componentDigestB64url?.slice(0, 12)}…, recomputed=${recomputed.slice(0, 12)}…)`,
    );
  } else {
    findings.push(`componentDigest.ok`);
  }

  // 6. Signature over canonical bundle.
  if (!bundle.signature) {
    errors.push("Bundle has no signature block");
  } else {
    try {
      const canonical = canonicaliseForSigning(bundle);
      const canonicalBytes = Buffer.from(canonical, "utf8");
      const pubKey = importPublicKeyFromB64url(bundle.signature.publicKeyB64url);
      const sigBytes = fromB64url(bundle.signature.signatureB64url);
      const ok = nodeVerify(
        "sha256",
        canonicalBytes,
        { key: pubKey, dsaEncoding: "ieee-p1363" },
        sigBytes,
      );
      if (!ok) {
        errors.push("ECDSA signature did NOT verify against embedded public key");
      } else {
        findings.push(`signature.ok\t${bundle.signature.signatureB64url.slice(0, 12)}…`);
      }
    } catch (e) {
      errors.push(`Signature verification threw: ${e.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    bundlePath: abs,
    engineVersion: bundle.engineVersion,
    componentDigestB64url: bundle.componentDigestB64url,
    errors,
    findings,
  };
}

function isMain() {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  const argvUrl = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
  return import.meta.url === argvUrl;
}

if (isMain()) {
  const args = new Set(process.argv.slice(2));
  const quiet = args.has("--quiet");
  const json = args.has("--json");
  const cwd = process.cwd();
  const result = verifyBundle(cwd);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet || !result.ok) {
    console.log(`Transparency bundle: ${result.ok ? "OK" : "FAILED"}`);
    console.log(`  bundle:        ${result.bundlePath}`);
    if (result.engineVersion) console.log(`  engine:        ${result.engineVersion}`);
    if (result.componentDigestB64url)
      console.log(`  componentSha:  ${result.componentDigestB64url.slice(0, 16)}…`);
    if (result.findings.length) {
      console.log("  findings:");
      for (const f of result.findings) console.log(`    ${f}`);
    }
    if (result.errors.length) {
      console.log("  errors:");
      for (const e of result.errors) console.log(`    ${e}`);
    }
  }
  if (!result.ok) process.exit(1);
}
