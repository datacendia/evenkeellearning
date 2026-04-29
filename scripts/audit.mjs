#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/audit.mjs
//
// Even Keel Learning audit-manifest emitter. Runs a battery of build, lint, test and
// HTTP smoke checks, captures the result of each as an evidence record, and
// writes a single `evidence/test-manifest-enterprise-complete-<ts>.json`
// file. The shape mirrors the Datacendia audit-manifest format so the same
// downstream tooling can ingest both.
//
// USAGE
//   node scripts/audit.mjs                  # offline checks only (default)
//   node scripts/audit.mjs --http           # also probe localhost:3000 routes
//   node scripts/audit.mjs --http --strict  # exit non-zero on any failure
//
// EVERY MANIFEST ENTRY CONTAINS
//   {
//     testId, name, type, method, category,
//     endpoint, status, evidenceRecorded,
//     complianceTags, controls,
//     details                          // free-form per check
//   }
//
// COMPLIANCE TAGS / CONTROLS
//   We map every check to one or more frameworks:
//     SOC 2   — CCx.x ("Common Criteria")
//     ISO 27001:2022 — A.x.xx
//     GDPR    — Art. xx
//     COPPA   — 16 CFR §312.x
//
// HONESTY
//   This script does not pretend any check that did not run. If a step
//   throws or exits non-zero, the manifest records `status: "failed"` and
//   the captured stderr, and the overall summary reflects it.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { hostname, platform, release, userInfo, arch } from "node:os";
import { resolve, join } from "node:path";

const ROOT = resolve(process.cwd());
const ARGS = new Set(process.argv.slice(2));
const RUN_HTTP = ARGS.has("--http");
const STRICT = ARGS.has("--strict");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = () => new Date();
const toLocalIso = (d) => {
  // "2026-04-26T11:30:42.123-05:00" form, matching Datacendia manifests.
  const tzo = -d.getTimezoneOffset();
  const sign = tzo >= 0 ? "+" : "-";
  const pad = (n, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds()) +
    "." + pad(d.getMilliseconds(), 3) +
    sign + pad(tzo / 60) + pad(tzo % 60)
  );
};

const newTestId = (prefix) => `${prefix}-${randomBytes(4).toString("hex")}`;

/** Run a CLI command, capture exit code and stdout/stderr. Never throws. */
function run(label, command, args, opts = {}) {
  const started = Date.now();
  let result;
  // On Windows the .cmd shims (npx, tsc, eslint) need shell=true OR an
  // explicit ".cmd" suffix. We pick shell=true and pass `args` as a single
  // string we control so the regex chars below survive untouched.
  // We only enable cmd.exe when the binary is a Windows .cmd/.bat shim
  // (e.g. tsc.cmd, next.cmd). Plain `node` doesn't need a shell, and
  // shell-mode mangles regex args containing `|`.
  const isShim = /\.(cmd|bat)$/i.test(command);
  const useShell = platform() === "win32" && isShim;
  const quoted = useShell && /\s/.test(command) ? `"${command}"` : command;
  // When invoking through cmd.exe, double-quote any arg containing
  // shell-meta characters so they don't tokenise.
  const safeArgs = useShell
    ? args.map((a) => (/[|&^<>()" ]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    : args;
  try {
    result = spawnSync(quoted, safeArgs, {
      cwd: ROOT,
      encoding: "utf8",
      shell: useShell,
      timeout: opts.timeoutMs ?? 120_000,
      windowsHide: true,
    });
  } catch (err) {
    return { code: -1, stdout: "", stderr: String(err), durationMs: Date.now() - started };
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Date.now() - started,
  };
}

/** GET a URL via the built-in fetch and return the status code. */
async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
    return { ok: res.status < 500, status: res.status, durationMs: Date.now() - started };
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - started, error: String(err) };
  }
}

/** Build a manifest record. */
function record({
  prefix,
  type,
  method,
  category,
  name,
  endpoint = "N/A",
  status,
  complianceTags,
  controls,
  details,
}) {
  return {
    testId: newTestId(prefix),
    type,
    method,
    category,
    name,
    endpoint,
    status,
    evidenceRecorded: true,
    complianceTags: Array.isArray(complianceTags) ? complianceTags.join(",") : complianceTags,
    controls: Array.isArray(controls) ? controls.join(",") : controls,
    details: details ?? null,
  };
}

// ─── Inventory of source files (lightweight) ─────────────────────────────────

function fileExists(rel) {
  return existsSync(join(ROOT, rel));
}

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
}

function fileHash(rel) {
  if (!fileExists(rel)) return null;
  const buf = readFileSync(join(ROOT, rel));
  return createHash("sha256").update(buf).digest("base64url").slice(0, 16);
}

// ─── Checks ──────────────────────────────────────────────────────────────────

const manifest = [];
const counters = {
  totalPassed: 0,
  totalFailed: 0,
  totalSkipped: 0,
  buildChecks: 0,
  httpTests: 0,
  inlineAssertions: 0,
};

function pushAndTally(rec) {
  manifest.push(rec);
  if (rec.status === "passed") counters.totalPassed++;
  else if (rec.status === "failed") counters.totalFailed++;
  else if (rec.status === "skipped") counters.totalSkipped++;
  // "skipped" is neither pass nor fail — it indicates the check could not
  // run (e.g. tool not installed) and is reported in the manifest verbatim.
}

// ── Build / static checks ───────────────────────────────────────────────────

function buildCheck() {
  // 1. TypeScript compilation. We run `tsc` directly from node_modules when
  // available (avoids npm's --noEmit flag collision), else fall back to npx.
  const tscBin = join(
    ROOT,
    "node_modules",
    ".bin",
    platform() === "win32" ? "tsc.cmd" : "tsc"
  );
  const tsc = existsSync(tscBin)
    ? run("tsc", tscBin, ["--noEmit"])
    : run("tsc", "npx", ["tsc", "--noEmit"]);
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "build",
    name: "TypeScript Compilation (tsc --noEmit)",
    status: tsc.code === 0 ? "passed" : "failed",
    complianceTags: ["soc2-type2", "iso27001"],
    controls: ["CC6.8", "A.8.32"],
    details: { exitCode: tsc.code, stderr: tsc.stderr.slice(0, 4000) },
  }));
  counters.buildChecks++;

  // 2. package-lock integrity
  const lockExists = fileExists("package-lock.json");
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "build",
    name: "Dependency Lock Integrity",
    status: lockExists ? "passed" : "failed",
    complianceTags: ["soc2-type2", "iso27001"],
    controls: ["CC6.8", "A.8.32"],
    details: { lockfilePresent: lockExists },
  }));
  counters.buildChecks++;

  // 3. Required governance files present
  const required = ["HONESTY.md", "SECURITY.md", "CHANGELOG.md", "README.md", "EVEN_KEEL_BIBLE.md", "SAFEGUARDING.md", "docs/PROPOSAL_TRUTH_PACK.md", "docs/PROPOSAL_REWRITER_NOTES.md"];
  const missing = required.filter((f) => !fileExists(f));
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "governance",
    name: "Required governance files present",
    status: missing.length === 0 ? "passed" : "failed",
    complianceTags: ["soc2-type2", "iso27001"],
    controls: ["CC1.2", "A.5.2"],
    details: { required, missing },
  }));
  counters.buildChecks++;

  // 4. .well-known/security.txt exists
  const securityTxt = fileExists("public/.well-known/security.txt");
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "security",
    name: "RFC 9116 security.txt present",
    status: securityTxt ? "passed" : "failed",
    complianceTags: ["soc2-type2", "iso27001"],
    controls: ["CC2.3", "A.5.5"],
    details: { path: "public/.well-known/security.txt" },
  }));
  counters.buildChecks++;

  // 5. No biometric API call anywhere in the source
  const grepBio = run(
    "grep-biometrics",
    "node",
    ["scripts/grep-anti-pattern.mjs", "mediaDevices|userVerification\\s*:\\s*['\"]required['\"]"]
  );
  // grep-anti-pattern.mjs returns 1 on match, 0 on clean
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "privacy",
    name: "No biometric API call anywhere in src",
    status: grepBio.code === 0 ? "passed" : "failed",
    complianceTags: ["gdpr", "coppa", "iso27001"],
    controls: ["GDPR-Art.9", "COPPA-§312.5", "A.5.34"],
    details: { exitCode: grepBio.code, snippet: grepBio.stdout.slice(0, 1000) },
  }));
  counters.buildChecks++;

  // 6. No advertising / analytics scripts
  const grepAds = run(
    "grep-ads",
    "node",
    ["scripts/grep-anti-pattern.mjs", "googletagmanager|google-analytics|doubleclick|facebook"]
  );
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "privacy",
    name: "No advertising / tracking scripts present",
    status: grepAds.code === 0 ? "passed" : "failed",
    complianceTags: ["gdpr", "coppa"],
    controls: ["GDPR-Art.5(1)(b)", "COPPA-§312.5"],
    details: { exitCode: grepAds.code, snippet: grepAds.stdout.slice(0, 1000) },
  }));
  counters.buildChecks++;

  // 7. No dangerouslySetInnerHTML
  const grepDanger = run(
    "grep-xss",
    "node",
    ["scripts/grep-anti-pattern.mjs", "dangerouslySetInnerHTML"]
  );
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "security",
    name: "No dangerouslySetInnerHTML in source",
    status: grepDanger.code === 0 ? "passed" : "failed",
    complianceTags: ["soc2-type2", "iso27001"],
    controls: ["CC6.6", "A.8.27"],
    details: { exitCode: grepDanger.code, snippet: grepDanger.stdout.slice(0, 1000) },
  }));
  counters.buildChecks++;

  // 8. ESLint via Next's `next lint`. Use the binary in node_modules when
  // installed; otherwise mark as skipped (don't fake success).
  const nextBin = join(
    ROOT,
    "node_modules",
    ".bin",
    platform() === "win32" ? "next.cmd" : "next"
  );
  const lint = existsSync(nextBin)
    ? run("lint", nextBin, ["lint", "--max-warnings", "0"])
    : { code: 127, stdout: "", stderr: "next binary not installed", durationMs: 0 };
  pushAndTally(record({
    prefix: "build",
    type: "build",
    method: "CHECK",
    category: "code-quality",
    name: "ESLint (no warnings)",
    status: lint.code === 0 ? "passed" : lint.code === 127 ? "skipped" : "failed",
    complianceTags: ["soc2-type2", "iso27001"],
    controls: ["CC8.1", "A.8.28"],
    details: { exitCode: lint.code, stdout: lint.stdout.slice(0, 4000), stderr: lint.stderr.slice(0, 2000) },
  }));
  counters.buildChecks++;

  // 9. Vitest unit tests (skip gracefully if vitest not yet installed).
  // We invoke `node node_modules/vitest/vitest.mjs` directly rather than
  // the .cmd shim, because the PowerShell-wrapped shim on Windows can
  // return non-zero exit codes when stderr is non-empty even on a clean
  // suite.
  const vitestEntry = join(ROOT, "node_modules", "vitest", "vitest.mjs");
  if (existsSync(vitestEntry)) {
    const test = run("vitest", "node", [vitestEntry, "run", "--reporter=basic"]);
    pushAndTally(record({
      prefix: "test",
      type: "test",
      method: "CHECK",
      category: "unit-tests",
      name: "Vitest unit suite",
      status: test.code === 0 ? "passed" : "failed",
      complianceTags: ["soc2-type2", "iso27001"],
      controls: ["CC4.1", "A.8.29"],
      details: { exitCode: test.code, stdout: test.stdout.slice(0, 4000), stderr: test.stderr.slice(0, 2000) },
    }));
  } else {
    pushAndTally(record({
      prefix: "test",
      type: "test",
      method: "CHECK",
      category: "unit-tests",
      name: "Vitest unit suite",
      status: "skipped",
      complianceTags: ["soc2-type2", "iso27001"],
      controls: ["CC4.1", "A.8.29"],
      details: { reason: "vitest binary not installed; run `npm install` first" },
    }));
  }

  // 10. Proposal truth-pack marker integrity. Guards against silent drift
  // between docs/PROPOSAL_TRUTH_PACK.md and the extractor contract
  // (`scripts/extract-truth-pack-section.mjs`). If any section marker is
  // unbalanced, missing, or orphaned, the audit fails in --strict mode.
  const truthPack = join(ROOT, "docs", "PROPOSAL_TRUTH_PACK.md");
  const extractor = join(ROOT, "scripts", "extract-truth-pack-section.mjs");
  if (existsSync(truthPack) && existsSync(extractor)) {
    const check = run("truth-pack", "node", [extractor, "--check"]);
    pushAndTally(record({
      prefix: "build",
      type: "build",
      method: "CHECK",
      category: "documentation-integrity",
      name: "Proposal truth-pack section markers balanced",
      status: check.code === 0 ? "passed" : "failed",
      complianceTags: ["soc2-type2", "iso27001"],
      controls: ["CC2.2", "A.5.34"],
      details: {
        exitCode: check.code,
        stdout: check.stdout.slice(0, 2000),
        stderr: check.stderr.slice(0, 2000),
        file: "docs/PROPOSAL_TRUTH_PACK.md",
      },
    }));
    counters.buildChecks++;
  }
}

// ── HTTP smoke (optional, requires running dev server) ──────────────────────

async function httpCheck() {
  const routes = [
    { p: "/",           cat: "landing",     name: "Landing page",           tags: ["soc2-type2"], ctrls: ["CC7.2"] },
    { p: "/student",    cat: "learner",     name: "Student surface",        tags: ["soc2-type2", "coppa"], ctrls: ["CC7.2", "COPPA-§312.5"] },
    { p: "/teacher",    cat: "operator",    name: "Teacher surface",        tags: ["soc2-type2"], ctrls: ["CC7.2"] },
    { p: "/parent",     cat: "guardian",    name: "Parent surface",         tags: ["soc2-type2", "coppa"], ctrls: ["CC7.2", "COPPA-§312.5"] },
    { p: "/compliance", cat: "compliance",  name: "Compliance surface",     tags: ["soc2-type2", "iso27001"], ctrls: ["CC7.2", "A.5.31"] },
    { p: "/adult",      cat: "learner",     name: "Adult learner surface",  tags: ["soc2-type2"], ctrls: ["CC7.2"] },
    { p: "/trades",     cat: "learner",     name: "Apprentice surface",     tags: ["soc2-type2"], ctrls: ["CC7.2"] },
    { p: "/auth",       cat: "auth",        name: "Auth surface",           tags: ["soc2-type2"], ctrls: ["CC6.1"] },
    { p: "/.well-known/security.txt", cat: "security", name: "RFC 9116 security.txt served", tags: ["soc2-type2"], ctrls: ["CC2.3", "A.5.5"] },
    { p: "/this-is-not-a-route", cat: "errors", name: "404 handler", tags: ["soc2-type2"], ctrls: ["CC7.1"], expect: 404 },
  ];
  for (const r of routes) {
    const res = await probe(`http://localhost:3000${r.p}`);
    const expected = r.expect ?? 200;
    const passed = res.status === expected;
    pushAndTally(record({
      prefix: "http",
      type: "http",
      method: "GET",
      category: r.cat,
      name: r.name,
      endpoint: r.p,
      status: passed ? "passed" : "failed",
      complianceTags: r.tags,
      controls: r.ctrls,
      details: { httpStatus: res.status, expected, durationMs: res.durationMs, error: res.error ?? null },
    }));
    counters.httpTests++;
  }
}

// ── Inline assertions about the codebase ────────────────────────────────────

function inlineAssertions() {
  const pkg = readJson("package.json") ?? {};
  const assertions = [
    {
      name: "Project name is 'even-keel-learning'",
      ok: pkg.name === "even-keel-learning",
      tags: ["soc2-type2"], ctrls: ["CC1.2"],
      details: { name: pkg.name },
    },
    {
      name: "Version follows SemVer",
      ok: typeof pkg.version === "string" && /^\d+\.\d+\.\d+/.test(pkg.version),
      tags: ["soc2-type2"], ctrls: ["CC8.1"],
      details: { version: pkg.version },
    },
    {
      name: "HONESTY.md mentions data-bus",
      ok: existsSync(join(ROOT, "HONESTY.md")) &&
          readFileSync(join(ROOT, "HONESTY.md"), "utf8").includes("data-bus.ts"),
      tags: ["soc2-type2"], ctrls: ["CC1.2"],
      details: null,
    },
    {
      name: "WebCrypto signing module present",
      ok: fileExists("lib/crypto/signing.ts"),
      tags: ["soc2-type2", "iso27001"], ctrls: ["CC6.1", "A.8.24"],
      details: { hashPrefix: fileHash("lib/crypto/signing.ts") },
    },
    {
      name: "Decision Gate present",
      ok: fileExists("lib/regulatory-absorb/decision-gate.ts"),
      tags: ["gdpr", "coppa"], ctrls: ["GDPR-Art.32", "COPPA-§312.5"],
      details: { hashPrefix: fileHash("lib/regulatory-absorb/decision-gate.ts") },
    },
    {
      name: "i18n dictionary covers 9 locales",
      ok: (() => {
        const path = join(ROOT, "lib/i18n/dictionary.ts");
        if (!existsSync(path)) return false;
        const src = readFileSync(path, "utf8");
        return ["en", "ga", "fr", "es", "pt", "de", "hi", "zh", "ar"].every((l) => src.includes(`"${l}"`) || src.includes(`'${l}'`));
      })(),
      tags: ["iso27001"], ctrls: ["A.5.34"],
      details: null,
    },
    {
      name: "Transparency bundle present and verifies (build-time signed)",
      ...(() => {
        // Honours SAFEGUARDING.md §1.9: the bundle is the single artefact a
        // procurement team / regulator can verify offline. Drift between
        // bundle and disk MUST fail audit.
        const bundlePath = join(ROOT, "evidence", "transparency-bundle.json");
        if (!existsSync(bundlePath)) {
          return {
            ok: false,
            tags: ["soc2-type2", "iso27001"],
            ctrls: ["CC2.2", "A.5.34"],
            details: {
              reason:
                "evidence/transparency-bundle.json not found — run `npm run transparency:build`",
            },
          };
        }
        const verify = run(
          "transparency-verify",
          "node",
          [join("scripts", "verify-transparency-bundle.mjs"), "--quiet"],
        );
        return {
          ok: verify.code === 0,
          tags: ["soc2-type2", "iso27001", "gdpr"],
          ctrls: ["CC2.2", "A.5.34", "GDPR-Art.25"],
          details: {
            exitCode: verify.code,
            stdout: verify.stdout.slice(0, 1500),
            stderr: verify.stderr.slice(0, 1500),
          },
        };
      })(),
    },
    {
      name: "KCSIE 2025 / Prevent / DfE F&M control map: every cited evidence path exists",
      ...(() => {
        // Honours the `honestyContract` field in the JSON: drift between the
        // map and the codebase MUST fail audit (SAFEGUARDING.md §1.8).
        const mapPath = join(ROOT, "compliance", "kcsie-2025-prevent-duty-map.json");
        if (!existsSync(mapPath)) {
          return {
            ok: false,
            tags: ["soc2-type2", "iso27001"], ctrls: ["CC2.2", "A.5.34"],
            details: { reason: "compliance/kcsie-2025-prevent-duty-map.json not found" },
          };
        }
        let map;
        try {
          map = JSON.parse(readFileSync(mapPath, "utf8"));
        } catch (e) {
          return {
            ok: false,
            tags: ["soc2-type2", "iso27001"], ctrls: ["CC2.2", "A.5.34"],
            details: { reason: `JSON parse failed: ${e.message}` },
          };
        }
        const missing = [];
        for (const c of map.controls ?? []) {
          for (const ev of c.evidence ?? []) {
            if (!existsSync(join(ROOT, ev.path))) {
              missing.push(`${c.id} → ${ev.path}`);
            }
          }
        }
        return {
          ok: missing.length === 0,
          tags: ["soc2-type2", "iso27001", "gdpr"], ctrls: ["CC2.2", "A.5.34", "GDPR-Art.25"],
          details: {
            controlsChecked: (map.controls ?? []).length,
            missingPaths: missing,
          },
        };
      })(),
    },
  ];
  for (const a of assertions) {
    pushAndTally(record({
      prefix: "inline",
      type: "inline",
      method: "ASSERT",
      category: "inline-assertion",
      name: a.name,
      status: a.ok ? "passed" : "failed",
      complianceTags: a.tags,
      controls: a.ctrls,
      details: a.details,
    }));
    counters.inlineAssertions++;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const startedAt = now();

  // 1. Build/static checks always run
  buildCheck();

  // 2. Inline assertions always run
  inlineAssertions();

  // 3. HTTP smoke optional
  if (RUN_HTTP) {
    await httpCheck();
  }

  // 4. Emit manifest
  const generatedAt = toLocalIso(now());
  const stamp = generatedAt.replace(/[:T.+\-]/g, "").slice(0, 14);
  if (!existsSync("evidence")) mkdirSync("evidence");
  const outPath = join("evidence", `test-manifest-enterprise-complete-${stamp}.json`);

  const summary = {
    executedBy: userInfo().username,
    generatedAt,
    hostname: hostname(),
    platform: `${platform()} ${release()} ${arch()}`,
    repoRoot: ROOT,
    counters,
    manifest,
  };

  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  // 5. Console summary
  // eslint-disable-next-line no-console
  console.log(
    [
      `Even Keel Learning audit complete.`,
      `  passed:  ${counters.totalPassed}`,
      `  failed:  ${counters.totalFailed}`,
      `  skipped: ${counters.totalSkipped}`,
      `  build:   ${counters.buildChecks}`,
      `  http:    ${counters.httpTests}`,
      `  inline:  ${counters.inlineAssertions}`,
      `  manifest: ${outPath}`,
    ].join("\n")
  );

  // 6. Exit code
  if (STRICT && counters.totalFailed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[audit] fatal:", err);
  process.exit(2);
});
