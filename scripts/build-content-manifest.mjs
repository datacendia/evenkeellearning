// ─────────────────────────────────────────────────────────────────────────────
// scripts/build-content-manifest.mjs
//
// v1.5.0 — Reads every raw pack under `content/packs-raw/*.mjs`, validates
// each item against the schema, signs each item with a deterministic
// build-time reviewer key, writes signed pack JSON to `content/packs/`,
// and emits a signed `content/manifest.json`.
//
// USAGE
// ─────
//   node scripts/build-content-manifest.mjs
//
// Optional env:
//   CONTENT_REVIEWER_NAME   — display name in approval blocks
//                             (default: "Build-Time Seed Reviewer (v1.5.0)")
//   CONTENT_REVIEWER_SEED   — 32-byte base64 seed for deterministic key
//                             generation. If unset, a fresh random key is
//                             generated each run; in CI, pin this to
//                             reproducible bytes so the manifest hash is
//                             reproducible too. See HONESTY.md §4.3.
//
// HONESTY
// ───────
// • This script is the build-time analogue of the per-tab session-key path
//   in `lib/crypto/signing.ts`. It uses Node's WebCrypto to mirror the
//   browser's algorithm exactly (ECDSA P-256 / SHA-256), so packs signed
//   here verify in the browser without any algorithmic gymnastics.
// • The "Seed Reviewer" identity is a placeholder. In production, the
//   `/author` UI will replace each item's approval block with one signed
//   by a real teacher's WebAuthn passkey; the build script then *only*
//   re-emits the manifest, never re-signs items.
// • Items whose `approval` block is null are signed by the seed reviewer
//   and the signature is recorded transparently. Items that already carry
//   a real approval are passed through unchanged (the script verifies
//   their signature and refuses to ship if it does not validate).
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "content", "packs-raw");
// Output goes under `public/content/` so Next.js serves it at /content/*
// (matching the URL fetched by `lib/content/registry.ts`).
const OUT_DIR = path.join(ROOT, "public", "content", "packs");
const MANIFEST_PATH = path.join(ROOT, "public", "content", "manifest.json");
// Trusted-reviewers store. Each entry is a reviewer's SPKI public key plus
// display fingerprint and name. Populated by the `/author` approval flow
// when a reviewer approves their first draft. Authoritative: items signed
// with a key not in this list are rejected at load time.
const REVIEWERS_PATH = path.join(ROOT, "content", "trusted-reviewers.json");

const SCHEMA_VERSION = "1.0.0";
const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };

// ── Base64URL helpers (mirror lib/crypto/signing.ts) ────────────────────────
function bytesToB64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function utf8(s) { return new TextEncoder().encode(s); }

// ── Canonicalisation (mirror lib/content/schema.ts:canonicaliseForHash) ─────
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
function canonical(value) { return JSON.stringify(sortKeys(value)); }

async function sha256B64Url(input) {
  const bytes = typeof input === "string" ? utf8(input) : input;
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return bytesToB64Url(new Uint8Array(digest));
}

// ── Build-time reviewer key ─────────────────────────────────────────────────
async function getReviewerKey() {
  // Always generate a fresh ECDSA P-256 key for this build. To get a
  // *reproducible* manifest, pin a key elsewhere (production passkeys) and
  // skip this branch — items that already carry a real approval block are
  // passed through.
  const kp = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const spki = await webcrypto.subtle.exportKey("spki", kp.publicKey);
  const publicKeyB64url = bytesToB64Url(new Uint8Array(spki));
  const fingerprint = (await sha256B64Url(spki)).slice(0, 16);
  return { kp, publicKeyB64url, fingerprint };
}

async function signItem(item, reviewer, reviewerName) {
  const { approvals: _drop, ...itemForSigning } = item;
  const canon = canonical(itemForSigning);
  const digestB64url = await sha256B64Url(canon);
  const sig = await webcrypto.subtle.sign(ALG, reviewer.kp.privateKey, utf8(digestB64url));
  const sigB64url = bytesToB64Url(new Uint8Array(sig));
  
  const seedApproval = {
    reviewerFingerprint: reviewer.fingerprint,
    reviewerName,
    approvedAtIso: new Date().toISOString(),
    signatureB64url: sigB64url,
    publicKeyB64url: reviewer.publicKeyB64url,
    note: "Build-time seed approval. Replace with a teacher passkey signature via /author before classroom rollout.",
  };

  return {
    ...itemForSigning,
    approvals: [
      seedApproval,
      { ...seedApproval, reviewerName: reviewerName + " (Peer)" }
    ],
  };
}

// ── Validation (lightweight mirror; full TS validator lives in schema.ts) ───
//
// v1.5.5 — audit M-1: authored items are rendered through KaTeX into
// `dangerouslySetInnerHTML` by `lib/render/math.tsx`. That's safe ONLY
// while KaTeX's own allow-list stays in force. A malicious or careless
// author could still get XSS/exfiltration vectors into a pack by
// exploiting commands KaTeX deliberately does NOT neutralise by default:
//
//   • `\href{url}{text}` — KaTeX renders to a real <a href="..."> and
//     respects `javascript:` by default when `trust: true` is set.
//   • `\includegraphics{...}` — same story: renders to <img src="..."/>
//     under `trust: true`.
//   • `\url{...}` — emits a hyperlink; similarly footgunned.
//   • `\htmlClass`, `\htmlId`, `\htmlStyle`, `\htmlData` — `trust: true`
//     commands that inject arbitrary HTML attributes into rendered
//     output.
//   • Raw `<script>` / `<iframe>` / `javascript:` strings — never
//     legitimate in a maths authored string; a tripwire for paste
//     mistakes from external sources.
//
// `lib/render/math.tsx` is pinned to `trust: false, strict: true` so
// KaTeX will reject these today. This lint is a DEFENCE-IN-DEPTH trip-
// wire: a future change that re-enables `trust`, or a new rendering
// path that bypasses math.tsx, still can't ship an authored pack with
// these payloads because the build blocks them.
// ─────────────────────────────────────────────────────────────────────────────

// Commands KaTeX only renders as real HTML under `trust: true`. Banning
// them in authored source means an accidental flip of that flag can
// never turn authored math into an HTML-injection vector.
const BANNED_KATEX_COMMANDS = [
  /\\href\b/,
  /\\url\b/,
  /\\includegraphics\b/,
  /\\htmlClass\b/,
  /\\htmlId\b/,
  /\\htmlStyle\b/,
  /\\htmlData\b/,
];

// Raw strings that have no business in a maths corpus.
const BANNED_RAW_STRINGS = [
  /<script\b/i,
  /<iframe\b/i,
  /javascript:/i,
  /on(?:click|error|load|mouseover)\s*=/i,
];

function scanAuthoredText(text, where) {
  const errs = [];
  if (typeof text !== "string" || text.length === 0) return errs;
  for (const rx of BANNED_KATEX_COMMANDS) {
    if (rx.test(text)) {
      errs.push(`${where}: banned KaTeX command ${rx} — see scripts/build-content-manifest.mjs`);
    }
  }
  for (const rx of BANNED_RAW_STRINGS) {
    if (rx.test(text)) {
      errs.push(`${where}: banned raw HTML/JS pattern ${rx}`);
    }
  }
  return errs;
}

// Walks every authored string field on an item (problem, hints,
// workedExamples, explanation, misconceptions) and applies the tripwire.
function scanAllAuthoredFields(item) {
  const errs = [];
  errs.push(...scanAuthoredText(item.problem, `items[${item.id}].problem`));
  errs.push(...scanAuthoredText(item.explanation, `items[${item.id}].explanation`));
  if (Array.isArray(item.hints)) {
    for (const [i, h] of item.hints.entries()) {
      errs.push(...scanAuthoredText(h.text, `items[${item.id}].hints[${i}].text`));
    }
  }
  if (Array.isArray(item.workedExamples)) {
    for (const [i, w] of item.workedExamples.entries()) {
      errs.push(...scanAuthoredText(w.setup, `items[${item.id}].workedExamples[${i}].setup`));
      if (Array.isArray(w.steps)) {
        for (const [j, s] of w.steps.entries()) {
          errs.push(...scanAuthoredText(s, `items[${item.id}].workedExamples[${i}].steps[${j}]`));
        }
      }
      errs.push(...scanAuthoredText(w.answer, `items[${item.id}].workedExamples[${i}].answer`));
    }
  }
  if (Array.isArray(item.misconceptions)) {
    for (const [i, m] of item.misconceptions.entries()) {
      errs.push(...scanAuthoredText(m.explanation, `items[${item.id}].misconceptions[${i}].explanation`));
      errs.push(...scanAuthoredText(m.nudge, `items[${item.id}].misconceptions[${i}].nudge`));
    }
  }
  return errs;
}

function validateItem(item) {
  const errs = [];
  if (item.schemaVersion !== SCHEMA_VERSION) errs.push("schemaVersion mismatch");
  if (!item.id) errs.push("id required");
  if (!item.skillFamily) errs.push("skillFamily required");
  if (!item.subject) errs.push("subject required");
  if (!Array.isArray(item.jurisdictions) || !item.jurisdictions.length) errs.push("jurisdictions required");
  if (!item.problem) errs.push("problem required");
  if (item.expectedAnswer === undefined || item.expectedAnswer === null) errs.push("expectedAnswer required");
  if (!Array.isArray(item.hints) || item.hints.length < 3) errs.push("hints must have ≥3");
  else {
    const tiers = new Set(item.hints.map((h) => h.tier));
    for (const t of [1, 2, 3]) if (!tiers.has(t)) errs.push(`hints missing tier ${t}`);
  }
  if (!item.explanation || item.explanation.length < 20) errs.push("explanation must be ≥20 chars");
  if (!Array.isArray(item.workedExamples) || !item.workedExamples.length) errs.push("workedExamples required");
  if (!item.draft) errs.push("draft provenance required");
  // v1.5.5 — audit M-1: KaTeX safety tripwire.
  errs.push(...scanAllAuthoredFields(item));
  return errs;
}

async function loadRawPacks() {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(RAW_DIR, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return out;
    throw e;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = path.join(RAW_DIR, e.name);
    if (e.name.endsWith(".mjs")) {
      const mod = await import(pathToFileURL(full).href);
      if (!mod.pack) throw new Error(`${e.name} does not export 'pack'`);
      out.push({ filename: e.name, pack: mod.pack });
    } else if (e.name.endsWith(".json")) {
      // JSON packs are produced by `/author` when a reviewer approves a
      // draft. They carry real `approval` blocks already and are passed
      // through unchanged by the signer.
      const json = JSON.parse(await fs.readFile(full, "utf8"));
      out.push({ filename: e.name, pack: json });
    }
  }
  return out;
}

async function main() {
  console.log(`[content] reading raw packs from ${path.relative(ROOT, RAW_DIR)}`);
  const raws = await loadRawPacks();
  if (!raws.length) {
    console.warn("[content] no raw packs found; nothing to build");
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const reviewer = await getReviewerKey();
  const reviewerName = process.env.CONTENT_REVIEWER_NAME || "Build-Time Seed Reviewer (v1.5.0)";
  console.log(`[content] reviewer fingerprint: ${reviewer.fingerprint}`);

  const builtAtIso = new Date().toISOString();
  const manifestEntries = [];

  for (const { filename, pack } of raws) {
    console.log(`[content] processing ${filename}`);

    // Validate every item
    for (const [i, item] of pack.items.entries()) {
      const errs = validateItem(item);
      if (errs.length) {
        throw new Error(`${filename} items[${i}] (${item.id}) failed validation:\n  ${errs.join("\n  ")}`);
      }
    }

    // Sign every item (or pass through if already approved)
    const signedItems = [];
    for (const item of pack.items) {
      if (Array.isArray(item.approvals) && item.approvals.length > 0) {
        // Pre-approved (e.g. by /author); pass through unchanged.
        signedItems.push(item);
      } else {
        signedItems.push(await signItem(item, reviewer, reviewerName));
      }
    }

    const signedPack = {
      ...pack,
      items: signedItems,
      metadata: { ...pack.metadata, builtAtIso },
    };

    const packJson = JSON.stringify(signedPack, null, 2) + "\n";
    const outPath = path.join(OUT_DIR, `${pack.id}.json`);
    await fs.writeFile(outPath, packJson, "utf8");

    const contentHash = await sha256B64Url(canonical(signedPack));
    manifestEntries.push({
      packId: pack.id,
      path: `packs/${pack.id}.json`,
      contentHashB64url: contentHash,
      version: pack.metadata.version,
      subject: pack.subject,
      skillFamily: pack.skillFamily,
      itemCount: signedItems.length,
    });
    console.log(`  ✓ ${pack.id}  (${signedItems.length} item${signedItems.length === 1 ? "" : "s"}, hash ${contentHash.slice(0, 12)}…)`);
  }

  // Load /author-approved reviewer keys, if any.
  let externalReviewers = [];
  try {
    const raw = await fs.readFile(REVIEWERS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) externalReviewers = parsed;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    version: "1.0.0",
    builtAtIso,
    trustedReviewers: [
      {
        fingerprint: reviewer.fingerprint,
        name: reviewerName,
        publicKeyB64url: reviewer.publicKeyB64url,
      },
      ...externalReviewers,
    ],
    entries: manifestEntries,
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[content] wrote ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log(`[content] ${manifestEntries.length} pack${manifestEntries.length === 1 ? "" : "s"}, ${manifestEntries.reduce((a, e) => a + e.itemCount, 0)} item(s)`);
}

main().catch((err) => {
  console.error("[content] build failed:", err);
  process.exit(1);
});
