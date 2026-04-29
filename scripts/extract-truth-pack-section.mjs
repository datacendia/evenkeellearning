#!/usr/bin/env node
// scripts/extract-truth-pack-section.mjs
//
// Extracts a single section from `docs/PROPOSAL_TRUTH_PACK.md` by reading
// between the HTML-comment section markers, e.g.
//
//   <!-- truth-pack:section-a:start -->
//   ## §A — What's already built …
//   <!-- truth-pack:section-a:end -->
//
// This makes the truth pack mechanically parseable so a build script (or
// a Claude-with-docx-skill prompt template) can drop a single section in
// without manual copy-paste.
//
// Usage:
//   node scripts/extract-truth-pack-section.mjs a            # prints §A
//   node scripts/extract-truth-pack-section.mjs b > out.md   # writes §B
//   node scripts/extract-truth-pack-section.mjs --list       # lists IDs
//   node scripts/extract-truth-pack-section.mjs --check      # CI sanity:
//                                                            #   prints
//                                                            #   nothing,
//                                                            #   exits 0
//                                                            #   if every
//                                                            #   marker
//                                                            #   pair is
//                                                            #   well-formed
//
// Exit code is non-zero on any problem (missing section, unbalanced
// markers, file not found) so CI can guard the truth pack.
//
// No dependencies beyond node:fs / node:path.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const TRUTH_PACK = path.join(ROOT, "docs", "PROPOSAL_TRUTH_PACK.md");

const args = process.argv.slice(2);

function fail(msg, code = 1) {
  process.stderr.write(`extract-truth-pack-section: ${msg}\n`);
  process.exit(code);
}

async function readPack() {
  try {
    return await fs.readFile(TRUTH_PACK, "utf8");
  } catch (err) {
    fail(`could not read ${TRUTH_PACK}: ${err.message}`);
  }
}

const MARKER = (id, kind) => `<!-- truth-pack:section-${id}:${kind} -->`;

/**
 * Returns the list of section ids that have a `start` marker.
 */
function listSections(text) {
  const ids = new Set();
  const rx = /<!--\s*truth-pack:section-([a-z0-9-]+):start\s*-->/gi;
  for (const m of text.matchAll(rx)) ids.add(m[1].toLowerCase());
  return [...ids];
}

/**
 * Verifies every section has a balanced start/end pair and that they
 * appear in `start` then `end` order. Returns the list of issues.
 */
function lintMarkers(text) {
  const issues = [];
  const ids = listSections(text);
  for (const id of ids) {
    const startIdx = text.indexOf(MARKER(id, "start"));
    const endIdx = text.indexOf(MARKER(id, "end"));
    if (startIdx < 0) issues.push(`section ${id}: missing start marker`);
    if (endIdx < 0) issues.push(`section ${id}: missing end marker`);
    if (startIdx >= 0 && endIdx >= 0 && endIdx <= startIdx) {
      issues.push(`section ${id}: end marker precedes start marker`);
    }
  }
  // Detect orphan end markers (end without a matching start).
  const orphans = [
    ...text.matchAll(/<!--\s*truth-pack:section-([a-z0-9-]+):end\s*-->/gi),
  ]
    .map((m) => m[1].toLowerCase())
    .filter((id) => !ids.includes(id));
  for (const id of orphans) {
    issues.push(`section ${id}: end marker without start`);
  }
  return issues;
}

function extract(text, id) {
  const start = text.indexOf(MARKER(id, "start"));
  const end = text.indexOf(MARKER(id, "end"));
  if (start < 0) fail(`section "${id}" not found (no start marker)`);
  if (end < 0) fail(`section "${id}" has no end marker`);
  if (end <= start) fail(`section "${id}" has end marker before start`);
  // Slice between the markers, excluding the marker lines themselves.
  const after = text.indexOf("\n", start) + 1;
  return text.slice(after, end).trimEnd() + "\n";
}

async function main() {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "Usage: extract-truth-pack-section.mjs <section-id|--list|--check>\n",
    );
    process.exit(args.length === 0 ? 1 : 0);
  }

  const pack = await readPack();

  if (args.includes("--list")) {
    for (const id of listSections(pack)) process.stdout.write(`${id}\n`);
    return;
  }

  if (args.includes("--check")) {
    const issues = lintMarkers(pack);
    if (issues.length > 0) {
      for (const i of issues) process.stderr.write(`  ${i}\n`);
      process.exit(1);
    }
    return; // exit 0
  }

  const id = args[0].toLowerCase().replace(/^§/, "");
  const out = extract(pack, id);
  process.stdout.write(out);
}

main().catch((err) => fail(err?.message ?? String(err)));
