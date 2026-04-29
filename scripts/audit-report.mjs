#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/audit-report.mjs
//
// Reads the most recent `evidence/test-manifest-enterprise-complete-*.json`
// and renders a human-readable Markdown summary into
// `reports/AUDIT_REPORT.md`.
//
// The report is intentionally short and scannable: counts at the top, table
// of every test, and a control-coverage section. Pair it with the full
// `reports/PLATFORM_AUDIT.md` for the narrative analysis.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE_DIR = "evidence";
const REPORT_PATH = join("reports", "AUDIT_REPORT.md");

if (!existsSync(EVIDENCE_DIR)) {
  console.error(`No ${EVIDENCE_DIR}/ directory. Run \`npm run audit:offline\` first.`);
  process.exit(1);
}

const files = readdirSync(EVIDENCE_DIR)
  .filter((f) => f.startsWith("test-manifest-enterprise-complete-") && f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error(`No manifests in ${EVIDENCE_DIR}/. Run \`npm run audit:offline\` first.`);
  process.exit(1);
}

const latest = files.at(-1);
const data = JSON.parse(readFileSync(join(EVIDENCE_DIR, latest), "utf8"));

const passRate = data.counters.totalPassed + data.counters.totalFailed === 0
  ? 100
  : (
      (data.counters.totalPassed /
        (data.counters.totalPassed + data.counters.totalFailed)) *
      100
    ).toFixed(2);

// Aggregate control coverage
const controlsCount = new Map();
for (const m of data.manifest) {
  const ctrls = (m.controls ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const c of ctrls) {
    if (!controlsCount.has(c)) controlsCount.set(c, { passed: 0, failed: 0 });
    const slot = controlsCount.get(c);
    if (m.status === "passed") slot.passed += 1;
    else if (m.status === "failed") slot.failed += 1;
  }
}
const sortedControls = [...controlsCount.entries()].sort(([a], [b]) => a.localeCompare(b));

const md = [
  "# Even Keel Learning — Audit Report",
  "",
  `**Generated from:** \`${EVIDENCE_DIR}/${latest}\`  `,
  `**Run at:** ${data.generatedAt}  `,
  `**Executed by:** ${data.executedBy} on ${data.hostname} (${data.platform})  `,
  `**Pass rate:** **${passRate}%** — ${data.counters.totalPassed} passed / ${data.counters.totalFailed} failed`,
  "",
  "## Summary",
  "",
  "| Category            | Count |",
  "|---------------------|-------|",
  `| Build / static checks | ${data.counters.buildChecks} |`,
  `| HTTP smoke tests      | ${data.counters.httpTests} |`,
  `| Inline assertions     | ${data.counters.inlineAssertions} |`,
  `| **Total passed**      | **${data.counters.totalPassed}** |`,
  `| **Total failed**      | **${data.counters.totalFailed}** |`,
  "",
  "## Control coverage",
  "",
  "| Control | Tests passed | Tests failed |",
  "|---------|--------------|--------------|",
  ...sortedControls.map(([c, v]) => `| \`${c}\` | ${v.passed} | ${v.failed} |`),
  "",
  "## Test ledger",
  "",
  "| Test ID | Type | Category | Name | Status | Endpoint |",
  "|---------|------|----------|------|--------|----------|",
  ...data.manifest.map((m) =>
    `| \`${m.testId}\` | ${m.type} | ${m.category} | ${m.name.replace(/\|/g, "\\|")} | ${statusBadge(m.status)} | \`${m.endpoint}\` |`
  ),
  "",
  "## Failed tests",
  "",
  ...failedSection(data.manifest),
  "",
  "## Raw manifest",
  "",
  `See [\`${EVIDENCE_DIR}/${latest}\`](../${EVIDENCE_DIR}/${latest}) for the full machine-readable record.`,
  "",
].join("\n");

if (!existsSync("reports")) mkdirSync("reports");
writeFileSync(REPORT_PATH, md);
console.log(`Wrote ${REPORT_PATH}`);

function statusBadge(s) {
  if (s === "passed") return "✅ pass";
  if (s === "failed") return "❌ fail";
  if (s === "skipped") return "⏭ skip";
  return s;
}

function failedSection(items) {
  const failed = items.filter((m) => m.status === "failed");
  if (failed.length === 0) return ["_None — all checks passed._"];
  return failed.flatMap((m) => [
    `### \`${m.testId}\` — ${m.name}`,
    "",
    `- Type: ${m.type}`,
    `- Category: ${m.category}`,
    `- Endpoint: \`${m.endpoint}\``,
    `- Compliance: ${m.complianceTags || "—"}`,
    `- Controls: ${m.controls || "—"}`,
    `- Details:`,
    "",
    "```json",
    JSON.stringify(m.details ?? {}, null, 2),
    "```",
    "",
  ]);
}
