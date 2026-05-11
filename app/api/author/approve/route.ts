// ─────────────────────────────────────────────────────────────────────────────
// app/api/author/approve/route.ts
//
// v1.5.0 — POST /api/author/approve
//
// Accepts a fully-signed `SchemaContentItem` (with a real `approval`
// block produced by the reviewer's browser session key) plus the original
// draft filename. On success:
//
//   1. Verifies the approval signature server-side (defence-in-depth).
//   2. Adds the reviewer's public key to `content/trusted-reviewers.json`
//      (idempotent — keys already present are skipped).
//   3. Reads the existing `content/packs-raw/<subject>.<skillFamily>.json`
//      (or creates a new one), appends/replaces the item by id, writes back.
//   4. Deletes the draft JSON.
//   5. Spawns `node scripts/build-content-manifest.mjs` to regenerate the
//      signed manifest and the served pack JSON in `public/content/`.
//
// HONESTY
// ───────
// • Demo-grade auth: there is no session at the network layer. In prod
//   this endpoint must require a server-issued session bound to the
//   reviewer's enrolled passkey. SAFEGUARDING.md §3 documents the gap.
// • All writes are atomic-ish (read-modify-write with no transaction).
//   Concurrent /author approvals from two tabs may race; the UI keeps
//   approvals serialised by waiting for the response before enabling
//   the next click.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = process.cwd();
const DRAFTS_DIR = path.join(ROOT, "content", "drafts");
const RAW_DIR = path.join(ROOT, "content", "packs-raw");
const REVIEWERS_PATH = path.join(ROOT, "content", "trusted-reviewers.json");
const SCHEMA_VERSION = "1.0.0";
const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

// ─────────────────────────────────────────────────────────────────────────────
// v1.5.5 — Hardening pass.
//
// Pre-v1.5.5, this route accepted any POST body whose `approvals` array
// contained two valid ECDSA signatures from two distinct keys. There was
// no session, no API key, no allowlist of trusted reviewer fingerprints,
// and no path-traversal protection on `subject`, `skillFamily`, or
// `filename`. Anyone who could reach the endpoint could:
//   • generate two ECDSA keypairs locally
//   • add themselves to content/trusted-reviewers.json
//   • write a pack JSON anywhere on the filesystem `path.join` would
//     resolve (e.g. subject="../../public" → escape RAW_DIR)
//   • delete any file under DRAFTS_DIR via the same traversal in `filename`
//   • spawn `node scripts/build-content-manifest.mjs` arbitrarily
//
// This pass adds three concentric defences:
//
//   1. Production refusal. If NODE_ENV === "production", the route
//      returns 404. The /author flow is a development tool today; until
//      a real reviewer-passkey-bound session ships, it MUST NOT be
//      reachable in a deployed app.
//   2. Input validation. `subject`, `skillFamily`, `id`, and `filename`
//      must match conservative slug patterns. Path traversal characters
//      are rejected outright.
//   3. Trust-on-first-use with audit. If trusted-reviewers.json already
//      contains entries, every approval must come from a key already on
//      that list. The first time a reviewer approves anything, the file
//      is created with their keys; subsequent approvals from unknown
//      keys are rejected with 403.
//
// Phase-2 work tracked in HONESTY.md §4.3: replace defence (1) with a
// server session bound to the reviewer's enrolled WebAuthn passkey.
// ─────────────────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const FILENAME_RE = /^[a-z0-9][a-z0-9._-]*\.json$/i;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function isValidSlug(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= 64 && SLUG_RE.test(s);
}

function isValidFilename(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 128 &&
    FILENAME_RE.test(s) &&
    !s.includes("..") &&
    !s.includes("/") &&
    !s.includes("\\")
  );
}

/**
 * Resolve `child` under `parent`, then verify the result has not escaped
 * the parent directory. Returns the resolved path on success, null on
 * any traversal attempt. Belt-and-braces over the slug regex above.
 */
function safeJoin(parent: string, child: string): string | null {
  const resolved = path.resolve(parent, child);
  const parentResolved = path.resolve(parent) + path.sep;
  if (!resolved.startsWith(parentResolved) && resolved !== path.resolve(parent)) {
    return null;
  }
  return resolved;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function bytesToB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}
function canonical(v: unknown): string { return JSON.stringify(sortKeys(v)); }
async function sha256B64Url(s: string): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToB64Url(new Uint8Array(digest));
}

interface ApprovalBlock {
  reviewerFingerprint: string;
  reviewerName: string;
  approvedAtIso: string;
  signatureB64url: string;
  publicKeyB64url: string;
  note?: string;
}

interface IncomingItem {
  schemaVersion: string;
  id: string;
  subject: string;
  skillFamily: string;
  approvals: ApprovalBlock[];
  // ...rest of schema; we don't fully type it here, schema.ts is the source of truth
  [k: string]: unknown;
}

async function verifyApprovals(item: IncomingItem): Promise<boolean> {
  try {
    const { approvals, ...rest } = item;
    if (!Array.isArray(approvals) || approvals.length < 2) return false;
    
    // Check that we have at least 2 distinct reviewer fingerprints
    const fingerprints = new Set(approvals.map(a => a.reviewerFingerprint));
    if (fingerprints.size < 2) return false;

    const expectedDigest = await sha256B64Url(canonical(rest));
    
    for (const approval of approvals) {
      const spkiBytes = b64UrlToBytes(approval.publicKeyB64url);
      const publicKey = await webcrypto.subtle.importKey(
        "spki",
        spkiBytes,
        ALG,
        true,
        ["verify"]
      );
      const sigBytes = b64UrlToBytes(approval.signatureB64url);
      const ok = await webcrypto.subtle.verify(
        ALG,
        publicKey,
        sigBytes,
        new TextEncoder().encode(expectedDigest)
      );
      if (!ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the current trusted-reviewers list. Returns `null` (distinct from
 * empty array) iff the file does not yet exist — the caller treats this
 * as "trust-on-first-use" and seeds the list with the inbound approvals.
 * Any other read / parse failure throws.
 */
async function readTrustedReviewers(): Promise<
  Array<{ fingerprint: string; name: string; publicKeyB64url: string }> | null
> {
  try {
    const raw = await fs.readFile(REVIEWERS_PATH, "utf8");
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

async function addTrustedReviewers(approvals: ApprovalBlock[]): Promise<void> {
  let list: { fingerprint: string; name: string; publicKeyB64url: string }[] = [];
  try {
    const raw = await fs.readFile(REVIEWERS_PATH, "utf8");
    list = JSON.parse(raw);
    if (!Array.isArray(list)) list = [];
  } catch (e: unknown) {
    if (!(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT")) throw e;
  }
  
  let changed = false;
  for (const approval of approvals) {
    if (!list.some((r) => r.publicKeyB64url === approval.publicKeyB64url)) {
      list.push({
        fingerprint: approval.reviewerFingerprint,
        name: approval.reviewerName,
        publicKeyB64url: approval.publicKeyB64url,
      });
      changed = true;
    }
  }
  
  if (changed) {
    await fs.mkdir(path.dirname(REVIEWERS_PATH), { recursive: true });
    await fs.writeFile(REVIEWERS_PATH, JSON.stringify(list, null, 2) + "\n", "utf8");
  }
}

async function upsertIntoPack(item: IncomingItem): Promise<string> {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const packId = `${item.subject}.${item.skillFamily}`;
  // Defence-in-depth: even though `subject` and `skillFamily` are slug-
  // validated by the POST handler, refuse anything that doesn't resolve
  // back under RAW_DIR. Cheap, catches future regressions to the regex.
  const packPath = safeJoin(RAW_DIR, `${packId}.json`);
  if (packPath === null) {
    throw new Error("pack id resolved outside RAW_DIR");
  }
  let pack: {
    schemaVersion: string;
    id: string;
    title: string;
    subject: string;
    skillFamily: string;
    items: IncomingItem[];
    metadata: { version: string; builtAtIso: string; description: string };
  };
  try {
    const raw = await fs.readFile(packPath, "utf8");
    pack = JSON.parse(raw);
  } catch (e: unknown) {
    if (!(e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT")) throw e;
    pack = {
      schemaVersion: SCHEMA_VERSION,
      id: packId,
      title: `${item.subject} · ${item.skillFamily}`,
      subject: item.subject,
      skillFamily: item.skillFamily,
      items: [],
      metadata: {
        version: "1.0.0",
        builtAtIso: new Date().toISOString(),
        description: `Reviewer-approved content pack for ${item.subject} · ${item.skillFamily}.`,
      },
    };
  }
  // Replace any existing item with the same id, else append.
  const idx = pack.items.findIndex((it) => it.id === item.id);
  if (idx >= 0) pack.items[idx] = item;
  else pack.items.push(item);
  pack.metadata.builtAtIso = new Date().toISOString();
  await fs.writeFile(packPath, JSON.stringify(pack, null, 2) + "\n", "utf8");
  return packPath;
}

function runManifestBuild(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/build-content-manifest.mjs"], {
      cwd: ROOT,
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

interface ApproveBody {
  filename: string;
  item: IncomingItem;
}

export async function POST(req: Request) {
  // Defence (1): production refusal. See file header.
  if (isProductionRuntime()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.filename || !body.item) {
    return NextResponse.json({ error: "filename and item required" }, { status: 400 });
  }

  // Defence (2): input validation. Reject anything that looks like a
  // traversal attempt or an over-long / non-slug identifier.
  if (!isValidFilename(body.filename)) {
    return NextResponse.json(
      { error: "filename must be a simple <slug>.json with no path separators" },
      { status: 400 },
    );
  }
  if (!isValidSlug(body.item.subject)) {
    return NextResponse.json(
      { error: "item.subject must match /^[a-z][a-z0-9-]*$/" },
      { status: 400 },
    );
  }
  if (!isValidSlug(body.item.skillFamily)) {
    return NextResponse.json(
      { error: "item.skillFamily must match /^[a-z][a-z0-9-]*$/" },
      { status: 400 },
    );
  }
  if (typeof body.item.id !== "string" || body.item.id.length === 0 || body.item.id.length > 128) {
    return NextResponse.json({ error: "item.id must be a non-empty string" }, { status: 400 });
  }

  if (!Array.isArray(body.item.approvals) || body.item.approvals.length < 2) {
    return NextResponse.json(
      { error: "item.approvals array with at least two signatures required" },
      { status: 400 },
    );
  }

  const sigOk = await verifyApprovals(body.item);
  if (!sigOk) {
    return NextResponse.json(
      { error: "approval signatures did not verify, or not enough unique reviewers" },
      { status: 400 },
    );
  }

  // Defence (3): trust-on-first-use. If trusted-reviewers.json already
  // exists, every approval must come from a key already on that list.
  // First-time reviewers can seed an empty list, but cannot piggy-back on
  // an existing trust set with newly-minted keys.
  const trusted = await readTrustedReviewers();
  if (trusted !== null && trusted.length > 0) {
    const trustedKeys = new Set(trusted.map((r) => r.publicKeyB64url));
    for (const approval of body.item.approvals) {
      if (!trustedKeys.has(approval.publicKeyB64url)) {
        return NextResponse.json(
          {
            error:
              "one or more approval keys are not on the trusted-reviewers list; " +
              "have an existing reviewer add them, or remove " +
              "content/trusted-reviewers.json to re-seed",
          },
          { status: 403 },
        );
      }
    }
  }

  await addTrustedReviewers(body.item.approvals);
  const packPath = await upsertIntoPack(body.item);

  // Best-effort: delete the draft. Defence-in-depth — `safeJoin` rejects
  // any path that escapes DRAFTS_DIR even if the regex above were ever
  // relaxed.
  const draftPath = safeJoin(DRAFTS_DIR, body.filename);
  if (draftPath !== null) {
    try {
      await fs.unlink(draftPath);
    } catch {
      /* draft may already be gone; not fatal */
    }
  }

  const built = await runManifestBuild();
  return NextResponse.json({
    ok: true,
    packPath: path.relative(ROOT, packPath),
    build: built,
  });
}
