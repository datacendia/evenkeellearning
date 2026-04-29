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
  const packPath = path.join(RAW_DIR, `${packId}.json`);
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
  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.filename || !body.item) {
    return NextResponse.json({ error: "filename and item required" }, { status: 400 });
  }
  if (!Array.isArray(body.item.approvals) || body.item.approvals.length < 2) {
    return NextResponse.json({ error: "item.approvals array with at least two signatures required" }, { status: 400 });
  }

  const sigOk = await verifyApprovals(body.item);
  if (!sigOk) {
    return NextResponse.json({ error: "approval signatures did not verify, or not enough unique reviewers" }, { status: 400 });
  }

  await addTrustedReviewers(body.item.approvals);
  const packPath = await upsertIntoPack(body.item);

  // Best-effort: delete the draft.
  try {
    await fs.unlink(path.join(DRAFTS_DIR, body.filename));
  } catch {
    /* draft may already be gone; not fatal */
  }

  const built = await runManifestBuild();
  return NextResponse.json({
    ok: true,
    packPath: path.relative(ROOT, packPath),
    build: built,
  });
}
