// ─────────────────────────────────────────────────────────────────────────────
// app/api/author/drafts/route.ts
//
// v1.5.0 — GET /api/author/drafts
// Lists every draft item under content/drafts/. Server-side only; the
// /author UI is the sole consumer.
//
// HONESTY
// ───────
// • This is a *demo*-grade endpoint. There is no auth at the network
//   layer; the role-guard in `/author` is a UI-side passphrase gate. In
//   production this endpoint must sit behind a real session (the
//   transparency bundle and SAFEGUARDING.md document the gap).
// • The endpoint reads draft JSON from disk verbatim. If a draft is
//   structurally invalid the UI surfaces it with a "rejected" badge so
//   the reviewer sees the problem rather than seeing nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DRAFTS_DIR = path.join(process.cwd(), "content", "drafts");

export async function GET() {
  let entries: string[];
  try {
    entries = await fs.readdir(DRAFTS_DIR);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT") {
      return NextResponse.json({ drafts: [] });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  const drafts = [];
  for (const filename of entries) {
    if (!filename.endsWith(".json")) continue;
    try {
      const full = path.join(DRAFTS_DIR, filename);
      const text = await fs.readFile(full, "utf8");
      const item = JSON.parse(text);
      drafts.push({ filename, item });
    } catch (e) {
      drafts.push({ filename, item: null, error: String(e) });
    }
  }

  return NextResponse.json({ drafts });
}
