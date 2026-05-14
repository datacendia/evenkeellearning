// ─────────────────────────────────────────────────────────────────────────────
// scripts/build-curriculum-registry.mjs
//
// v1.8.0 — Compiles every framework data file under content/curriculum/*.mjs
// into a single signed registry blob at public/curriculum/registry.json.
// Also cross-validates every authored content pack against the compiled
// registry and prints any unknown spec-point references.
//
// Usage
// ─────
//   node scripts/build-curriculum-registry.mjs           # default (warn on unknowns)
//   node scripts/build-curriculum-registry.mjs --strict  # fail build on unknowns
//
// Why a separate script (and not just rolled into build-content-manifest)?
// The curriculum registry is the SOURCE of truth that the content manifest
// validates AGAINST. Building it first, in its own pass, gives clean
// separation: a malformed framework data file fails this script (not the
// content build), and a content pack that references an unknown spec-point
// fails the manifest build (not this script).
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "content", "curriculum");
const OUT_DIR = join(ROOT, "public", "curriculum");
const OUT_PATH = join(OUT_DIR, "registry.json");
const PACKS_DIR = join(ROOT, "content", "packs-raw");

const STRICT = process.argv.includes("--strict");

// Mirror of lib/curriculum/registry.ts uriFor() — kept inline so this
// .mjs script doesn't need a TS loader.
const SKILL_URI_BASE = "https://evenkeel.org/curricula";
function uriFor(framework, code) {
  const slug = framework
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${SKILL_URI_BASE}/${slug}/${encodeURIComponent(code)}`;
}

function sha256B64url(s) {
  return createHash("sha256")
    .update(s)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") +
    "}"
  );
}

async function loadFrameworkFile(absPath) {
  const mod = await import(pathToFileURL(absPath).href);
  return mod.default;
}

function buildFrameworkFromInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("framework input must be an object");
  }
  for (const k of ["id", "name", "awardingBody", "jurisdiction", "yearStart", "yearEnd", "specPoints"]) {
    if (!(k in input)) throw new Error(`framework missing field: ${k}`);
  }
  if (!Array.isArray(input.specPoints)) {
    throw new Error(`framework ${input.id}: specPoints must be array`);
  }
  const seen = new Set();
  const specPoints = [];
  for (const sp of input.specPoints) {
    if (!sp || typeof sp.code !== "string" || typeof sp.label !== "string") {
      throw new Error(`framework ${input.id}: malformed spec-point ${JSON.stringify(sp)}`);
    }
    if (seen.has(sp.code)) {
      throw new Error(`framework ${input.id}: duplicate code ${sp.code}`);
    }
    seen.add(sp.code);
    const out = {
      framework: input.id,
      code: sp.code,
      label: sp.label,
      skillUri: uriFor(input.id, sp.code),
    };
    if (sp.topic) out.topic = sp.topic;
    if (sp.references) out.references = sp.references;
    specPoints.push(out);
  }
  const f = {
    id: input.id,
    name: input.name,
    awardingBody: input.awardingBody,
    jurisdiction: input.jurisdiction,
    yearStart: input.yearStart,
    yearEnd: input.yearEnd,
    specPoints,
  };
  if (input.references) f.references = input.references;
  return f;
}

function extractAuthoredRefsFromPack(packSrc, packId) {
  // Lightweight regex scan. Mirrors what scripts/build-content-manifest.mjs
  // does for indexing purposes. Captures (framework, code) pairs.
  const refs = [];
  const re = /framework:\s*"([^"]+)"\s*,\s*code:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(packSrc))) {
    refs.push({ framework: m[1], code: m[2], source: packId });
  }
  return refs;
}

async function main() {
  // 1. Load + build every framework.
  if (!existsSync(SRC_DIR)) {
    console.error(`source dir missing: ${SRC_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
  if (files.length === 0) {
    console.error(`no framework files in ${SRC_DIR}`);
    process.exit(1);
  }

  const frameworks = {};
  for (const f of files) {
    const abs = join(SRC_DIR, f);
    console.log(`[curriculum] loading ${f}`);
    const input = await loadFrameworkFile(abs);
    const built = buildFrameworkFromInput(input);
    if (frameworks[built.id]) {
      console.error(`[curriculum] duplicate framework id: ${built.id}`);
      process.exit(1);
    }
    frameworks[built.id] = built;
    console.log(`  ✔ ${built.id}: ${built.specPoints.length} spec-points`);
  }

  const registry = {
    schemaVersion: 1,
    generatedAtIso: new Date().toISOString(),
    frameworks,
  };

  // 2. Cross-validate authored content packs against the registry.
  let unknownTotal = 0;
  if (existsSync(PACKS_DIR)) {
    const packs = readdirSync(PACKS_DIR)
      .filter((f) => f.endsWith(".mjs"))
      .sort();
    for (const p of packs) {
      const src = readFileSync(join(PACKS_DIR, p), "utf8");
      const refs = extractAuthoredRefsFromPack(src, p);
      const unknown = refs.filter((r) => {
        const f = frameworks[r.framework];
        return !f || !f.specPoints.some((s) => s.code === r.code);
      });
      if (unknown.length > 0) {
        console.warn(
          `[curriculum] ${p}: ${unknown.length} unknown spec-point ref(s):`,
        );
        for (const u of unknown) {
          console.warn(`    framework=${u.framework}  code=${u.code}`);
        }
        unknownTotal += unknown.length;
      }
    }
  } else {
    console.log("[curriculum] no packs dir; skipping cross-validation");
  }

  // 3. Emit registry.json.
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(registry, null, 2) + "\n";
  writeFileSync(OUT_PATH, json, "utf8");
  const canon = canonicalJson(registry);
  const hash = sha256B64url(canon);
  console.log(`\n[curriculum] wrote ${OUT_PATH}`);
  console.log(
    `  frameworks: ${Object.keys(frameworks).length}`,
  );
  console.log(
    `  spec-points: ${Object.values(frameworks).reduce((n, f) => n + f.specPoints.length, 0)}`,
  );
  console.log(`  canonical sha256 (b64url): ${hash}`);
  if (unknownTotal > 0) {
    console.log(`  unknown authored refs: ${unknownTotal}`);
    if (STRICT) {
      console.error("[curriculum] --strict and unknown refs present; failing");
      process.exit(2);
    }
  }
}

main().catch((e) => {
  console.error("[curriculum] failed:", e);
  process.exit(1);
});
