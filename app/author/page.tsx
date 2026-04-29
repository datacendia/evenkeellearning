// ─────────────────────────────────────────────────────────────────────────────
// app/author/page.tsx
//
// v1.5.0 — The reviewer surface. Lists every draft under content/drafts/,
// lets a passphrase-gated reviewer edit the draft fields in-line, and on
// "Approve & Sign" canonicalises the item, signs it with the browser
// session key (ECDSA-P256), and POSTs to /api/author/approve. The server
// verifies the signature, promotes the item into a JSON pack, regenerates
// the signed manifest, and the new content is live without a code change.
//
// HONESTY
// ───────
// • Edits made here override the LLM draft. The reviewer is the source of
//   truth. Their fingerprint is what ends up in the manifest and the
//   signed receipts. The LLM provenance is preserved separately in the
//   `draft` block for transparency.
// • Signing uses the per-tab session key from `lib/crypto/signing.ts`. In
//   production this is replaced with a passkey ceremony so the signature
//   binds to a real device. The current `keyType` is "session-demo".
// • This UI is never in the learner-facing bundle path; it lives behind
//   /author and the role-guard passphrase.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import RoleGuard from "@/components/shared/RoleGuard";
import {
  CheckCircle2,
  XCircle,
  Edit3,
  Send,
  AlertTriangle,
  FileText,
  Sparkles,
} from "lucide-react";
import {
  contentDigest,
  exportPublicKey,
  getSessionKeyPair,
} from "@/lib/crypto/signing";

interface DraftEntry {
  filename: string;
  item: ContentItemDraft | null;
  error?: string;
}

interface ContentItemDraft {
  schemaVersion: string;
  id: string;
  skillFamily: string;
  subject: string;
  jurisdictions: string[];
  difficulty: string;
  prerequisites: string[];
  specPoints: { framework: string; code: string; label: string }[];
  problem: string;
  expectedAnswer: number | string;
  hints: { tier: 1 | 2 | 3 | 4; text: string }[];
  explanation: string;
  misconceptions: { id: string; trigger: string; explanation: string; nudge?: string }[];
  workedExamples: { id: string; problem: string; workedSolution: string; expectedAnswer: number | string }[];
  draft: { model: string; provider: string; promptHashB64url: string; draftedAtIso: string; drafterVersion: string };
  approval: null | unknown;
}

// ── Canonical JSON (mirror of schema.ts:canonicaliseForHash) ─────────────────
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return v;
}
function canonical(v: unknown): string { return JSON.stringify(sortKeys(v)); }

async function fingerprintFromSpki(spkiB64url: string): Promise<string> {
  const pad = spkiB64url.length % 4 === 0 ? "" : "=".repeat(4 - (spkiB64url.length % 4));
  const b64 = (spkiB64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  let bin = "";
  const u8 = new Uint8Array(digest);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────

function AuthorPageInner() {
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewerName, setReviewerName] = useState("Reviewer (session-demo)");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<ContentItemDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/author/drafts", { cache: "no-cache" });
      const json = await res.json();
      setDrafts(json.drafts || []);
    } catch (e) {
      setFlash({ kind: "err", msg: `Failed to load drafts: ${String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function selectDraft(i: number) {
    setActiveIdx(i);
    const d = drafts[i];
    setEditing(d?.item ? structuredClone(d.item) : null);
  }

  async function approveAndSign() {
    if (!editing) return;
    setSubmitting(true);
    setFlash(null);
    try {
      // 1. Get session key pair, export public key, derive fingerprint.
      const kp = await getSessionKeyPair();
      const publicKeyB64url = await exportPublicKey(kp.publicKey);
      const reviewerFingerprint = await fingerprintFromSpki(publicKeyB64url);

      // 2. Build the item *without* the approval block, canonicalise, hash.
      const itemForSigning = { ...editing, approval: undefined };
      delete (itemForSigning as { approval?: unknown }).approval;
      const digest = await contentDigest(JSON.parse(canonical(itemForSigning)));

      // 3. Sign the digest bytes with the session private key.
      const sigBuf = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        kp.privateKey,
        new TextEncoder().encode(digest)
      );
      const signatureB64url = bytesToB64Url(new Uint8Array(sigBuf));

      // 4. Construct the full signed item.
      const signedItem = {
        ...editing,
        approval: {
          reviewerFingerprint,
          reviewerName,
          approvedAtIso: new Date().toISOString(),
          signatureB64url,
          publicKeyB64url,
          note: "Approved via /author session-demo key. Replace with passkey signature for production.",
        },
      };

      // 5. POST to the approve endpoint. Server verifies, promotes, rebuilds manifest.
      const filename = drafts[activeIdx!].filename;
      const res = await fetch("/api/author/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename, item: signedItem }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setFlash({ kind: "ok", msg: `Approved → ${json.packPath}. Manifest rebuilt.` });
      setActiveIdx(null);
      setEditing(null);
      await refresh();
    } catch (e) {
      setFlash({ kind: "err", msg: `Approval failed: ${String(e)}` });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SurfaceShell
      theme="paper"
      surfaceLabel="Reviewer · Content Authoring"
      surfaceUser="REVIEWER · session-demo"
    >
      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <aside
          className="kl-card"
          aria-label="Drafts queue"
          style={{ position: "sticky", top: 110, height: "fit-content", maxHeight: "calc(100vh - 130px)", overflowY: "auto" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} style={{ color: "var(--accent)" }} />
            <h3 className="text-sm font-semibold">Drafts queue</h3>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--fg-dim)" }}>
            LLM-drafted content awaiting review. Nothing here has reached a learner.
          </p>
          <div className="mb-3">
            <label className="text-xs block mb-1" style={{ color: "var(--fg-dim)" }}>
              Reviewer display name
            </label>
            <input
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              className="w-full text-sm px-2 py-1 rounded border"
              style={{ background: "var(--bg-deep)", borderColor: "var(--border)" }}
            />
          </div>
          {loading && <p className="text-xs" style={{ color: "var(--fg-dim)" }}>Loading…</p>}
          {!loading && drafts.length === 0 && (
            <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
              No drafts. Run <code>npm run content:draft -- --spec "…" --subject … --skill-family …</code> to create one.
            </p>
          )}
          <ul className="space-y-1">
            {drafts.map((d, i) => (
              <li key={d.filename}>
                <button
                  onClick={() => selectDraft(i)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded"
                  style={{
                    background: activeIdx === i ? "var(--accent-bg)" : "transparent",
                    color: d.error ? "var(--danger)" : "var(--fg)",
                    border: `1px solid ${activeIdx === i ? "var(--accent)" : "transparent"}`,
                  }}
                >
                  {d.error ? <AlertTriangle size={10} className="inline mr-1" /> : <Sparkles size={10} className="inline mr-1" />}
                  {d.item?.id || d.filename}
                  {d.item && (
                    <div style={{ fontSize: 10, color: "var(--fg-faint)" }}>
                      {d.item.subject} · {d.item.skillFamily} · {d.item.draft.provider}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="kl-card" style={{ minHeight: 580 }}>
          {!editing && (
            <div style={{ color: "var(--fg-dim)", fontSize: 13, padding: "1.5rem" }}>
              Select a draft on the left to begin review. Every approval is
              ECDSA-signed and added to the trusted-reviewers list at
              <code> content/trusted-reviewers.json</code>; the manifest is
              rebuilt automatically.
            </div>
          )}
          {editing && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-serif text-xl">{editing.id}</h2>
                  <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
                    {editing.subject} · {editing.skillFamily} · {editing.difficulty} ·
                    drafted by <strong>{editing.draft.provider}</strong>
                    {" "}({editing.draft.model})
                  </p>
                </div>
                <button
                  onClick={() => { setEditing(null); setActiveIdx(null); }}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: "var(--fg-dim)" }}
                >
                  <XCircle size={14} className="inline mr-1" />Close
                </button>
              </div>

              {flash && (
                <div
                  className="text-sm px-3 py-2 rounded"
                  style={{
                    background: flash.kind === "ok" ? "var(--success-bg)" : "var(--danger-bg)",
                    color: flash.kind === "ok" ? "var(--success)" : "var(--danger)",
                  }}
                >
                  {flash.kind === "ok" ? <CheckCircle2 size={14} className="inline mr-1" /> : <AlertTriangle size={14} className="inline mr-1" />}
                  {flash.msg}
                </div>
              )}

              <Field label="Problem" multiline value={editing.problem} onChange={(v) => setEditing({ ...editing, problem: v })} />
              <Field label="Expected answer" value={String(editing.expectedAnswer)} onChange={(v) => {
                const n = Number(v);
                setEditing({ ...editing, expectedAnswer: Number.isFinite(n) ? n : v });
              }} />

              <div>
                <h4 className="text-sm font-semibold mb-2"><Edit3 size={12} className="inline mr-1" />Hints (3-tier ladder)</h4>
                {editing.hints.map((h, i) => (
                  <Field
                    key={i}
                    label={`Tier ${h.tier}`}
                    multiline
                    value={h.text}
                    onChange={(v) => {
                      const next = [...editing.hints];
                      next[i] = { ...h, text: v };
                      setEditing({ ...editing, hints: next });
                    }}
                  />
                ))}
              </div>

              <Field label="Explanation (post-attempt walkthrough)" multiline value={editing.explanation} onChange={(v) => setEditing({ ...editing, explanation: v })} />

              <div>
                <h4 className="text-sm font-semibold mb-2">Misconceptions</h4>
                {editing.misconceptions.map((m, i) => (
                  <div key={i} className="mb-3 pl-3" style={{ borderLeft: "2px solid var(--border)" }}>
                    <p className="text-xs mb-1" style={{ color: "var(--fg-dim)" }}>Trigger: <code>{m.trigger}</code></p>
                    <Field label="Explanation" multiline value={m.explanation} onChange={(v) => {
                      const next = [...editing.misconceptions];
                      next[i] = { ...m, explanation: v };
                      setEditing({ ...editing, misconceptions: next });
                    }} />
                    <Field label="Nudge" value={m.nudge ?? ""} onChange={(v) => {
                      const next = [...editing.misconceptions];
                      next[i] = { ...m, nudge: v };
                      setEditing({ ...editing, misconceptions: next });
                    }} />
                  </div>
                ))}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Worked examples (parallels)</h4>
                {editing.workedExamples.map((w, i) => (
                  <div key={i} className="mb-3 pl-3" style={{ borderLeft: "2px solid var(--border)" }}>
                    <Field label="Problem" value={w.problem} onChange={(v) => {
                      const next = [...editing.workedExamples];
                      next[i] = { ...w, problem: v };
                      setEditing({ ...editing, workedExamples: next });
                    }} />
                    <Field label="Worked solution" multiline value={w.workedSolution} onChange={(v) => {
                      const next = [...editing.workedExamples];
                      next[i] = { ...w, workedSolution: v };
                      setEditing({ ...editing, workedExamples: next });
                    }} />
                  </div>
                ))}
              </div>

              <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <button
                  onClick={approveAndSign}
                  disabled={submitting}
                  className="px-4 py-2 rounded font-semibold text-sm"
                  style={{
                    background: submitting ? "var(--fg-faint)" : "var(--accent)",
                    color: "var(--bg)",
                    cursor: submitting ? "wait" : "pointer",
                  }}
                >
                  <Send size={14} className="inline mr-2" />
                  {submitting ? "Signing & promoting…" : "Approve & Sign"}
                </button>
                <p className="text-xs mt-2" style={{ color: "var(--fg-dim)" }}>
                  Signs with this tab's session key, promotes the item into{" "}
                  <code>content/packs-raw/{editing.subject}.{editing.skillFamily}.json</code>,
                  rebuilds the signed manifest, and deletes the draft.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </SurfaceShell>
  );
}

function Field(props: {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs block mb-1" style={{ color: "var(--fg-dim)" }}>{props.label}</label>
      {props.multiline ? (
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          rows={Math.min(8, Math.max(2, props.value.split("\n").length + 1))}
          className="w-full text-sm px-2 py-1 rounded border font-sans"
          style={{ background: "var(--bg-deep)", borderColor: "var(--border)", color: "var(--fg)" }}
        />
      ) : (
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="w-full text-sm px-2 py-1 rounded border"
          style={{ background: "var(--bg-deep)", borderColor: "var(--border)", color: "var(--fg)" }}
        />
      )}
    </div>
  );
}

export default function AuthorPage() {
  return (
    <RoleGuard role="author" roleLabel="Reviewer" demoHint="reviewer-alpha-42">
      <AuthorPageInner />
    </RoleGuard>
  );
}
