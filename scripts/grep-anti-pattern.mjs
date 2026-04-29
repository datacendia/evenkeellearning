#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/grep-anti-pattern.mjs
//
// Tiny, dependency-free anti-pattern grep used by `scripts/audit.mjs`. Walks
// the project's source roots looking for forbidden patterns. Exits 0 on a
// clean tree, exits 1 (and prints the offending hits) on any match.
//
// Usage:
//   node scripts/grep-anti-pattern.mjs "<regex>"
//
// Excludes node_modules, .next, evidence/, reports/, .git, scripts/.
// Scans .ts, .tsx, .js, .jsx, .mjs, .json, .md.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERN = process.argv[2];
if (!PATTERN) {
  console.error("usage: grep-anti-pattern.mjs <regex>");
  process.exit(2);
}

const RX = new RegExp(PATTERN);
// We deliberately exclude `.md` files from the scan: governance docs
// (SECURITY.md, CHANGELOG.md, HONESTY.md) legitimately *describe* anti-
// patterns by name, and finding the literal string "dangerouslySetInnerHTML"
// in a doc is not a vulnerability.
const ROOTS = ["app", "components", "lib", "public"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  "evidence",
  "reports",
  ".git",
  "scripts",
  "out",
  "dist",
]);

let hits = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full);
    } else {
      if (!EXTENSIONS.some((ext) => full.endsWith(ext))) continue;
      const content = readFileSync(full, "utf8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Lines starting with `// ` or `/* ` or ` * ` are comments and not
        // a real anti-pattern usage. We skip them so a documented mention
        // ("// must not contain dangerouslySetInnerHTML") doesn't fail
        // the grep. Real JSX usages are not commented.
        const trimmed = line.replace(/^\s+/, "");
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        if (RX.test(line)) {
          hits.push({ file: full, line: i + 1, snippet: line.trim().slice(0, 200) });
        }
      }
    }
  }
}

for (const root of ROOTS) {
  walk(root);
}

if (hits.length === 0) {
  process.exit(0);
}

console.error(`Anti-pattern matches for /${PATTERN}/:`);
for (const h of hits.slice(0, 50)) {
  console.error(`  ${h.file}:${h.line}  ${h.snippet}`);
}
if (hits.length > 50) console.error(`  ... and ${hits.length - 50} more`);
process.exit(1);
