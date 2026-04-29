#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/build-transparency-bundle.mjs
//
// Builds `evidence/transparency-bundle.json` — a single, signed artefact a
// school's procurement / DPO / Compliance Officer can download once and
// hand to a regulator. Aggregates four already-signed-or-hashed evidence
// streams into one envelope:
//
//   1. Governance documents (HONESTY.md, SAFEGUARDING.md, CHANGELOG.md,
//      EVEN_KEEL_BIBLE.md, README.md, the truth pack docs) — sha256 each.
//   2. The KCSIE 2025 / Prevent Duty / DfE F&M control map JSON, parsed +
//      hashed, with frameworks / control counts surfaced for quick scan.
//   3. The reproducibility manifest pointer + its aggregateSha256.
//   4. The latest audit test-manifest pointer + its passed/failed counters.
//
// The whole bundle (minus the signature itself) is canonicalised and signed
// with a build-time ECDSA P-256 key. The signature is honest about its
// provenance: the key is freshly generated per build and embedded in the
// bundle, exactly the way the per-tab WebCrypto session key works in
// `lib/crypto/signing.ts`. A verifier confirms the bundle has not been
// tampered with after signing; binding the key to a long-lived
// organisational identity is Phase 2 (KMS / passkey-derived).
//
// SAFEGUARDING.md §1.9 documents the operational contract.
//
// Usage
// ─────
//   node scripts/build-transparency-bundle.mjs            # build + sign
//   node scripts/build-transparency-bundle.mjs --quiet    # suppress progress
//   node scripts/build-transparency-bundle.mjs --no-public-copy
//                                                # skip writing to public/
//
// On a successful build it writes:
//   • evidence/transparency-bundle.json  (canonical artefact)
//   • public/transparency-bundle.json    (so the /compliance UI can offer it
//                                         as a static download — skip with
//                                         --no-public-copy)
// ─────────────────────────────────────────────────────────────────────────────

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";

export const BUNDLE_PATH = join("evidence", "transparency-bundle.json");
export const PUBLIC_BUNDLE_PATH = join("public", "transparency-bundle.json");
export const SCHEMA_VERSION = 1;
export const HASH_ALGORITHM = "SHA-256";
export const SIGNING_ALGORITHM = "ECDSA-P256-SHA256";

/** The governance docs whose sha256 the bundle pins. Same list as the
 *  reproducibility manifest, kept in sync intentionally. */
export const GOVERNANCE_DOCS = [
  "README.md",
  "HONESTY.md",
  "CHANGELOG.md",
  "EVEN_KEEL_BIBLE.md",
  "SAFEGUARDING.md",
  "docs/PROPOSAL_TRUTH_PACK.md",
  "docs/PROPOSAL_REWRITER_NOTES.md",
];

export const CONTROL_MAP_PATH = join("compliance", "kcsie-2025-prevent-duty-map.json");
export const REPRO_MANIFEST_PATH = join("evidence", "reproducibility-manifest.json");

const HONESTY_CONTRACT =
  "This bundle pins, by sha256, the exact governance documents, control " +
  "map, reproducibility manifest, and latest audit run that this engine " +
  "version claims to honour. The signing key is a build-time ephemeral " +
  "ECDSA P-256 key whose public half is embedded in the bundle. A verifier " +
  "can confirm integrity offline; binding the key to a long-lived " +
  "organisational identity (KMS / passkey-derived) is Phase 2.";

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function base64Url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function hashFile(absolutePath) {
  const bytes = readFileSync(absolutePath);
  return base64Url(createHash("sha256").update(bytes).digest());
}

export function hashString(s) {
  return base64Url(createHash("sha256").update(s).digest());
}

/** Build a stable, key-sorted JSON of the bundle minus the `signature`
 *  field so signing is independent of object-key insertion order. */
export function canonicaliseForSigning(bundle) {
  const { signature: _drop, ...rest } = bundle;
  return canonicalJsonStringify(rest);
}

function canonicalJsonStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJsonStringify(v)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(value[k]))
      .join(",") +
    "}"
  );
}

// ─── Component builders ──────────────────────────────────────────────────────

function buildGovernanceComponent(cwd) {
  return GOVERNANCE_DOCS.map((relPath) => {
    const abs = join(cwd, relPath);
    if (!existsSync(abs)) {
      return { path: toPosix(relPath), present: false, sha256: null, sizeBytes: 0 };
    }
    const bytes = readFileSync(abs);
    return {
      path: toPosix(relPath),
      present: true,
      sha256: base64Url(createHash("sha256").update(bytes).digest()),
      sizeBytes: bytes.byteLength,
    };
  });
}

function buildControlMapComponent(cwd) {
  const abs = join(cwd, CONTROL_MAP_PATH);
  if (!existsSync(abs)) {
    return { path: toPosix(CONTROL_MAP_PATH), present: false };
  }
  const raw = readFileSync(abs, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      path: toPosix(CONTROL_MAP_PATH),
      present: true,
      sha256: hashString(raw),
      parseError: String(e),
    };
  }
  const frameworks = Array.from(
    new Set((parsed.controls ?? []).map((c) => c.framework)),
  ).sort();
  const phase1Counts = (parsed.controls ?? []).reduce((acc, c) => {
    acc[c.phase1Status] = (acc[c.phase1Status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    path: toPosix(CONTROL_MAP_PATH),
    present: true,
    sha256: hashString(raw),
    sizeBytes: Buffer.byteLength(raw, "utf8"),
    title: parsed.title ?? null,
    version: parsed.version ?? null,
    publishedAt: parsed.publishedAt ?? null,
    engineVersion: parsed.engineVersion ?? null,
    controlsCount: (parsed.controls ?? []).length,
    frameworks,
    phase1Counts,
  };
}

function buildReproducibilityComponent(cwd) {
  const abs = join(cwd, REPRO_MANIFEST_PATH);
  if (!existsSync(abs)) {
    return { path: toPosix(REPRO_MANIFEST_PATH), present: false };
  }
  const raw = readFileSync(abs, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  return {
    path: toPosix(REPRO_MANIFEST_PATH),
    present: true,
    sha256: hashString(raw),
    aggregateSha256: parsed?.aggregateSha256 ?? null,
    schemaVersion: parsed?.schemaVersion ?? null,
    fileCount: parsed?.files?.length ?? 0,
    governanceDocsCount: (parsed?.governance ?? []).filter((g) => g.present).length,
    generatedAtIso: parsed?.generatedAtIso ?? null,
  };
}

function buildAuditComponent(cwd) {
  const dir = join(cwd, "evidence");
  if (!existsSync(dir)) return { present: false };
  const candidates = readdirSync(dir)
    .filter(
      (f) =>
        f.startsWith("test-manifest-enterprise-complete-") &&
        f.endsWith(".json"),
    )
    .sort();
  if (candidates.length === 0) return { present: false };
  const latest = candidates[candidates.length - 1];
  const abs = join(dir, latest);
  const raw = readFileSync(abs, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // ignore
  }
  return {
    path: toPosix(join("evidence", latest)),
    present: true,
    sha256: hashString(raw),
    generatedAt: parsed?.generatedAt ?? null,
    counters: parsed?.counters ?? null,
  };
}

function toPosix(p) {
  return p.split(sep).join("/");
}

// ─── Signing (build-time ephemeral key) ──────────────────────────────────────

/**
 * Generates a fresh ECDSA P-256 key pair, signs the canonical bundle bytes,
 * and returns the signature + SPKI-exported public key, both base64url.
 * The verifier reconstructs the public key with `createPublicKey` from the
 * SPKI-DER bytes.
 */
export function signBundle(canonicalBytes, keyPair) {
  const kp =
    keyPair ??
    generateKeyPairSync("ec", {
      namedCurve: "prime256v1", // == P-256
    });
  const signature = nodeSign("sha256", canonicalBytes, {
    key: kp.privateKey,
    dsaEncoding: "ieee-p1363", // raw r||s, matches WebCrypto SubtleCrypto
  });
  const spki = kp.publicKey.export({ type: "spki", format: "der" });
  return {
    publicKeyB64url: base64Url(spki),
    signatureB64url: base64Url(signature),
    signedAtIso: new Date().toISOString(),
    keyType: "ephemeral-build-time",
    note:
      "Key generated at build time and embedded in the bundle. Phase 2 " +
      "binds this to a longer-lived KMS / passkey-derived key.",
  };
}

// ─── Top-level ───────────────────────────────────────────────────────────────

export function buildBundle(cwd, now = new Date(), keyPair = undefined) {
  const pkgPath = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const governance = buildGovernanceComponent(cwd);
  const controlMap = buildControlMapComponent(cwd);
  const reproducibility = buildReproducibilityComponent(cwd);
  const audit = buildAuditComponent(cwd);

  // The componentDigest is the sha256 of the deterministic concatenation of
  // every component's sha256, so a verifier can spot drift in any one of the
  // four streams without having to re-derive each.
  const lines = [
    ...governance.map((g) => `governance\t${g.path}\t${g.sha256 ?? "(missing)"}`),
    `controlMap\t${controlMap.path}\t${controlMap.sha256 ?? "(missing)"}`,
    `reproducibility\t${reproducibility.path}\t${reproducibility.sha256 ?? "(missing)"}`,
    `audit\t${audit.path ?? "(none)"}\t${audit.sha256 ?? "(none)"}`,
  ];
  const componentDigestB64url = hashString(lines.join("\n"));

  const bundle = {
    schemaVersion: SCHEMA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    signingAlgorithm: SIGNING_ALGORITHM,
    generatedAtIso: now.toISOString(),
    engineVersion: `evenkeel@${pkg.version}`,
    packageName: pkg.name,
    packageVersion: pkg.version,
    honestyContract: HONESTY_CONTRACT,
    components: {
      governance,
      controlMap,
      reproducibility,
      audit,
    },
    componentDigestB64url,
  };

  const canonical = canonicaliseForSigning(bundle);
  const canonicalBytes = Buffer.from(canonical, "utf8");
  const signature = signBundle(canonicalBytes, keyPair);

  bundle.signature = signature;
  return bundle;
}

export function writeBundle(cwd, bundle, opts = {}) {
  const written = [];
  const targets = [join(cwd, BUNDLE_PATH)];
  if (opts.copyToPublic !== false) targets.push(join(cwd, PUBLIC_BUNDLE_PATH));
  for (const abs of targets) {
    const dir = abs.slice(0, abs.lastIndexOf(sep));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(abs, JSON.stringify(bundle, null, 2) + "\n", "utf8");
    written.push(abs);
  }
  return written;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function isMain() {
  if (typeof process === "undefined" || !process.argv?.[1]) return false;
  const argvUrl = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
  return import.meta.url === argvUrl;
}

if (isMain()) {
  const args = new Set(process.argv.slice(2));
  const quiet = args.has("--quiet");
  const noPublicCopy = args.has("--no-public-copy");
  const cwd = process.cwd();
  if (!quiet) console.log("Building transparency bundle…");
  const bundle = buildBundle(cwd);
  const written = writeBundle(cwd, bundle, { copyToPublic: !noPublicCopy });
  if (!quiet) {
    for (const w of written) console.log(`Wrote ${w}`);
    console.log(`  schema:        v${bundle.schemaVersion}`);
    console.log(`  engine:        ${bundle.engineVersion}`);
    console.log(
      `  governance:    ${bundle.components.governance.filter((g) => g.present).length}/${bundle.components.governance.length}`,
    );
    console.log(
      `  control map:   ${bundle.components.controlMap.controlsCount ?? 0} controls (${(bundle.components.controlMap.frameworks ?? []).join(", ")})`,
    );
    console.log(
      `  repro pinned:  ${bundle.components.reproducibility.aggregateSha256?.slice(0, 12) ?? "(missing)"}…`,
    );
    console.log(
      `  audit pinned:  ${bundle.components.audit.counters?.totalPassed ?? 0} passed / ${bundle.components.audit.counters?.totalFailed ?? 0} failed`,
    );
    console.log(
      `  componentSha:  ${bundle.componentDigestB64url.slice(0, 16)}…`,
    );
    console.log(`  signature:     ${bundle.signature.signatureB64url.slice(0, 16)}…`);
  }
}

// Used by the verify script to re-import the public-key SPKI bytes.
export function importPublicKeyFromB64url(b64url) {
  const padded = b64url + "=".repeat((4 - (b64url.length % 4)) % 4);
  const der = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

export function importPrivateKeyFromPem(pem) {
  return createPrivateKey({ key: pem, format: "pem" });
}
