"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/teacher/attest/page.tsx
//
// v1.6.7 — Teacher attestation review surface. Lists CRTs from the
// local CRT bank, marks which have already been attested, and lets
// the teacher review one CRT at a time and counter-sign it with a
// passkey-required ceremony.
//
// Sits behind RoleGuard role="teacher" and inherits the server-
// verified role-session middleware.
//
// PASSKEY REQUIREMENT
// ───────────────────
// Attestations REQUIRE a passkey by design (see lib/teacher/attestation
// and the v1.6.7 commit message). When the teacher has not yet enrolled
// a passkey, this surface shows a clear CTA pointing to the parent
// surface's PasskeyEnrolCard rather than silently falling back to a
// session-demo signature.
//
// PILOT DEMOABILITY
// ─────────────────
// When the CRT bank is empty (a fresh device, no learner activity yet),
// a "Seed sample CRT" button appears. It builds a plausible
// CognitiveReasoningTrace, signs it (session-key OK — the *student*
// trace doesn't need a passkey, only the teacher's counter-signature
// does), and appends it to the bank. This makes the full attest flow
// testable end-to-end without waiting for real classroom traffic.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import RoleGuard from "@/components/shared/RoleGuard";
import JsonViewer from "@/components/shared/JsonViewer";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  KeyRound,
  Plus,
  X,
  ShieldCheck,
} from "lucide-react";
import {
  appendAttestation,
  listAttestations,
  listAttestationsForCrt,
} from "@/lib/teacher/attestation-bank";
import {
  REVIEWER_NOTE_MAX_CHARS,
  type AttestationVerdict,
  type TeacherAttestationEnvelope,
  type TeacherAttestationSpecPoint,
} from "@/lib/teacher/attestation";
import {
  appendCRT,
  listCRTs,
  type CRTEnvelope,
} from "@/lib/crt/bank";
import { getEnrolment, isPasskeySupported } from "@/lib/crypto/passkey";
import type { CognitiveReasoningTrace } from "@/lib/types";

// Supported verdicts and their display tone.
const VERDICTS: Array<{
  id: AttestationVerdict;
  label: string;
  tone: "ok" | "info" | "warn" | "danger";
  hint: string;
}> = [
  {
    id: "verified-mastery",
    label: "Verified mastery",
    tone: "ok",
    hint: "The trace shows independent reasoning to a correct conclusion.",
  },
  {
    id: "verified-with-support",
    label: "Verified with support",
    tone: "info",
    hint: "Correct conclusion reached after Socratic hints; understanding is sound.",
  },
  {
    id: "needs-revisit",
    label: "Needs revisit",
    tone: "warn",
    hint: "Genuine effort but a misconception remains. Re-teach and re-attempt.",
  },
  {
    id: "anomaly-rejected",
    label: "Anomaly — rejected",
    tone: "danger",
    hint: "Trace shows mimicry / paste / impossibly fast latency. Cannot be attested.",
  },
];

// ─── Top-level page ────────────────────────────────────────────────────────

function AttestPageInner() {
  const [crts, setCrts] = useState<CRTEnvelope[]>([]);
  const [attestations, setAttestations] = useState<TeacherAttestationEnvelope[]>([]);
  const [selectedDigest, setSelectedDigest] = useState<string | null>(null);
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);
  const [passkeySupportedFlag, setPasskeySupportedFlag] = useState(true);

  function refresh() {
    setCrts(listCRTs());
    setAttestations(listAttestations());
    setPasskeyEnrolled(!!getEnrolment());
  }

  useEffect(() => {
    setPasskeySupportedFlag(isPasskeySupported());
    refresh();
  }, []);

  // Index attestations by the CRT digest they pin to, for fast lookup.
  const attestationsByCrt = useMemo(() => {
    const map = new Map<string, TeacherAttestationEnvelope[]>();
    for (const a of attestations) {
      const k = a.payload.crtContentDigestB64url;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [attestations]);

  const pending = crts.filter(
    (c) => !attestationsByCrt.has(c.contentDigestB64url),
  );
  const selectedCrt = selectedDigest
    ? crts.find((c) => c.contentDigestB64url === selectedDigest) ?? null
    : null;

  return (
    <SurfaceShell
      theme="sovereign"
      surfaceLabel="Teacher · Attestation Review"
      surfaceUser="MS. RYAN · 4Y · ATTEST"
      rightSlot={
        <span
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}
        >
          PENDING <span style={{ color: "var(--fg)" }}>{pending.length}</span> ·
          {" "}ATTESTED <span style={{ color: "var(--fg)" }}>{attestations.length}</span>
        </span>
      }
    >
      <div className="space-y-6">
        <PasskeyBanner enrolled={passkeyEnrolled} supported={passkeySupportedFlag} />

        <SummaryTiles
          totalCrts={crts.length}
          pending={pending.length}
          attested={attestations.length}
        />

        {crts.length === 0 ? (
          <EmptyState onSeed={async () => {
            await seedSampleCrt();
            refresh();
          }} />
        ) : (
          <div className="grid lg:grid-cols-[1fr_2fr] gap-6">
            <CrtList
              crts={crts}
              attestationsByCrt={attestationsByCrt}
              selectedDigest={selectedDigest}
              onSelect={setSelectedDigest}
            />
            <div>
              {selectedCrt ? (
                <ReviewPanel
                  crt={selectedCrt}
                  passkeyEnrolled={passkeyEnrolled}
                  attestationsForThisCrt={
                    attestationsByCrt.get(selectedCrt.contentDigestB64url) ?? []
                  }
                  onSigned={() => {
                    refresh();
                    // Move the selection on to the next pending CRT, if any.
                    const next = listCRTs().find(
                      (c) =>
                        c.contentDigestB64url !== selectedCrt.contentDigestB64url &&
                        listAttestationsForCrt(c.contentDigestB64url).length === 0,
                    );
                    setSelectedDigest(next?.contentDigestB64url ?? null);
                  }}
                />
              ) : (
                <div className="kl-card text-center" style={{ padding: "2.5rem 1rem" }}>
                  <p style={{ color: "var(--fg-dim)" }}>
                    Select a trace from the list to review and attest.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SurfaceShell>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PasskeyBanner({
  enrolled,
  supported,
}: {
  enrolled: boolean;
  supported: boolean;
}) {
  if (enrolled) {
    return (
      <div className="kl-card flex items-center gap-3" style={{ padding: "0.75rem 1rem" }}>
        <ShieldCheck size={16} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
        <p style={{ color: "var(--fg-dim)", fontSize: 13 }}>
          A passkey is enrolled on this device. Attestations you sign will be
          passkey-derived and verifiable by anyone holding your public key.
        </p>
      </div>
    );
  }
  if (!supported) {
    return (
      <div
        className="kl-card flex items-start gap-3"
        style={{ borderColor: "var(--hub-warning)", padding: "0.75rem 1rem" }}
      >
        <AlertTriangle size={16} aria-hidden="true" style={{ color: "var(--hub-warning)", flexShrink: 0 }} />
        <p style={{ color: "var(--fg)", fontSize: 13 }}>
          This browser does not support WebAuthn passkeys. Attestations cannot
          be signed here. Please use a recent Chrome / Edge / Safari / Firefox.
        </p>
      </div>
    );
  }
  return (
    <div
      className="kl-card flex items-start gap-3"
      style={{ borderColor: "var(--hub-warning)", padding: "0.75rem 1rem" }}
    >
      <KeyRound size={16} aria-hidden="true" style={{ color: "var(--hub-warning)", flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 13 }}>
        <p style={{ color: "var(--fg)" }}>
          <strong>No passkey enrolled.</strong> Attestations are passkey-required by design —
          a session-key signature would be misleading evidence in a downstream
          credential.
        </p>
        <p className="mt-1" style={{ color: "var(--fg-dim)" }}>
          Enrol a passkey on the{" "}
          <a
            href="/parent"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            Parent surface
          </a>{" "}
          (Passkey Enrolment card), then return here.
        </p>
      </div>
    </div>
  );
}

function SummaryTiles({
  totalCrts,
  pending,
  attested,
}: {
  totalCrts: number;
  pending: number;
  attested: number;
}) {
  const cells: Array<{ label: string; value: number; tone?: "ok" | "warn" }> = [
    { label: "Traces in bank", value: totalCrts },
    { label: "Pending review", value: pending, tone: pending > 0 ? "warn" : undefined },
    { label: "Attested", value: attested, tone: "ok" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {cells.map((c) => (
        <div key={c.label} className="kl-card" style={{ padding: "0.875rem 1rem" }}>
          <p
            className="font-mono"
            style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            {c.label}
          </p>
          <p
            className="text-2xl mt-1 font-mono"
            style={{
              color:
                c.tone === "ok" ? "var(--accent)"
                : c.tone === "warn" ? "var(--hub-warning)"
                : "var(--fg)",
            }}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onSeed }: { onSeed: () => void }) {
  return (
    <div className="kl-card text-center" style={{ padding: "2.5rem 1rem" }}>
      <Sparkles size={28} aria-hidden="true" style={{ color: "var(--fg-faint)", margin: "0 auto" }} />
      <p className="mt-3 text-lg">No traces in the local CRT bank yet.</p>
      <p className="mt-1" style={{ color: "var(--fg-dim)", fontSize: 13 }}>
        Once your students complete problems on the <code>/student</code> surface,
        their signed reasoning traces will appear here for review.
      </p>
      <p className="mt-1" style={{ color: "var(--fg-dim)", fontSize: 13 }}>
        For pilot testing, you can seed a sample trace below.
      </p>
      <button
        onClick={onSeed}
        className="mt-4 px-4 py-2 rounded-md text-xs font-medium"
        style={{ background: "var(--accent)", color: "#0A0E12" }}
      >
        Seed sample CRT
      </button>
    </div>
  );
}

function CrtList({
  crts,
  attestationsByCrt,
  selectedDigest,
  onSelect,
}: {
  crts: CRTEnvelope[];
  attestationsByCrt: Map<string, TeacherAttestationEnvelope[]>;
  selectedDigest: string | null;
  onSelect: (digest: string) => void;
}) {
  // Sort: pending first (most recent first), then attested.
  const sorted = [...crts].sort((a, b) => {
    const aAttested = attestationsByCrt.has(a.contentDigestB64url) ? 1 : 0;
    const bAttested = attestationsByCrt.has(b.contentDigestB64url) ? 1 : 0;
    if (aAttested !== bAttested) return aAttested - bAttested;
    return (b.payload.startTime ?? 0) - (a.payload.startTime ?? 0);
  });

  return (
    <div className="kl-card p-0 overflow-hidden">
      <div
        className="px-4 py-3"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-alt)" }}
      >
        <p
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          Traces ({sorted.length})
        </p>
      </div>
      <ul style={{ maxHeight: 480, overflowY: "auto" }}>
        {sorted.map((c) => {
          const isSelected = c.contentDigestB64url === selectedDigest;
          const attestedHere = attestationsByCrt.get(c.contentDigestB64url) ?? [];
          const isAttested = attestedHere.length > 0;
          return (
            <li
              key={c.contentDigestB64url}
              onClick={() => onSelect(c.contentDigestB64url)}
              style={{
                padding: "0.75rem 1rem",
                borderTop: "1px solid var(--border)",
                cursor: "pointer",
                background: isSelected ? "var(--bg-alt)" : "transparent",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p
                    className="font-mono"
                    style={{
                      fontSize: 11,
                      color: "var(--fg)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.payload.problemId}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                    student {c.payload.studentId.slice(0, 8)}…
                    {" · "}
                    {c.payload.events.length} events
                    {c.payload.endTime != null && c.payload.startTime != null && (
                      <>
                        {" · "}
                        {Math.round((c.payload.endTime - c.payload.startTime) / 1000)}s
                      </>
                    )}
                  </p>
                </div>
                {isAttested ? (
                  <span
                    title={`Attested: ${attestedHere[0].payload.verdict}`}
                    className="flex items-center gap-1"
                    style={{ fontSize: 10, color: "var(--accent)" }}
                  >
                    <CheckCircle2 size={12} aria-hidden="true" />
                    attested
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1"
                    style={{ fontSize: 10, color: "var(--hub-warning)" }}
                  >
                    <Clock size={12} aria-hidden="true" />
                    pending
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewPanel({
  crt,
  passkeyEnrolled,
  attestationsForThisCrt,
  onSigned,
}: {
  crt: CRTEnvelope;
  passkeyEnrolled: boolean;
  attestationsForThisCrt: TeacherAttestationEnvelope[];
  onSigned: () => void;
}) {
  const [verdict, setVerdict] = useState<AttestationVerdict | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [specPoints, setSpecPoints] = useState<TeacherAttestationSpecPoint[]>([]);
  const [newFramework, setNewFramework] = useState("");
  const [newCode, setNewCode] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSigned, setJustSigned] = useState<TeacherAttestationEnvelope | null>(null);

  // Reset form when the selected CRT changes.
  useEffect(() => {
    setVerdict(null);
    setReviewerNote("");
    setSpecPoints([]);
    setNewFramework("");
    setNewCode("");
    setError(null);
    setJustSigned(null);
  }, [crt.contentDigestB64url]);

  const noteOver = reviewerNote.length > REVIEWER_NOTE_MAX_CHARS;
  const canSign =
    !signing &&
    passkeyEnrolled &&
    verdict !== null &&
    !noteOver &&
    attestationsForThisCrt.length === 0; // refuse to double-attest the same CRT

  function addSpecPoint() {
    if (!newFramework.trim() || !newCode.trim()) return;
    if (specPoints.length >= 16) return;
    setSpecPoints([
      ...specPoints,
      {
        framework: newFramework.trim(),
        code: newCode.trim(),
        claimVocabularyVersion: 1,
      },
    ]);
    setNewFramework("");
    setNewCode("");
  }

  function removeSpecPoint(i: number) {
    setSpecPoints(specPoints.filter((_, idx) => idx !== i));
  }

  async function onSign() {
    if (!verdict) return;
    setSigning(true);
    setError(null);
    try {
      const env = await appendAttestation({
        crtContentDigestB64url: crt.contentDigestB64url,
        studentExternalId: crt.payload.studentId,
        problemId: crt.payload.problemId,
        verdict,
        reviewerNote: reviewerNote || undefined,
        specPoints: specPoints.map((sp) => ({
          framework: sp.framework,
          code: sp.code,
          label: sp.label,
        })),
      });
      setJustSigned(env);
      onSigned();
    } catch (e) {
      const err = e as Error & { reason?: string };
      if (err.name === "PasskeyRequiredError" || err.reason) {
        setError(
          err.reason === "ceremony_failed"
            ? "Passkey ceremony failed or was cancelled. Try again."
            : "No passkey enrolled on this device. Enrol one on the Parent surface and return here.",
        );
      } else {
        setError(err.message || "Signing failed. See console for details.");
      }
    } finally {
      setSigning(false);
    }
  }

  // ── Render ──
  return (
    <div className="space-y-4">
      <div className="kl-card">
        <p
          className="font-mono mb-2"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          Trace inspector
        </p>
        <p className="mb-2" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          <code>{crt.payload.problemId}</code>
          {" · "}student <code>{crt.payload.studentId}</code>
          {" · "}digest <code>{crt.contentDigestB64url.slice(0, 16)}…</code>
        </p>
        <JsonViewer value={crt.payload} maxHeight={260} />
      </div>

      {attestationsForThisCrt.length > 0 ? (
        <div className="kl-card flex items-start gap-2" style={{ borderColor: "var(--accent)" }}>
          <CheckCircle2 size={16} aria-hidden="true" style={{ color: "var(--accent)", marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>
            <p style={{ color: "var(--fg)" }}>
              <strong>This trace has already been attested</strong> (verdict:{" "}
              <code>{attestationsForThisCrt[0].payload.verdict}</code>) at{" "}
              {new Date(attestationsForThisCrt[0].payload.attestedAtIso).toLocaleString()}.
            </p>
            <p className="mt-1" style={{ color: "var(--fg-dim)" }}>
              Re-attesting the same trace is not supported in v1.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Verdict picker */}
          <div className="kl-card">
            <p
              className="font-mono mb-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Verdict
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {VERDICTS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVerdict(v.id)}
                  className="rounded-md p-3 text-left"
                  style={{
                    border: `1px solid ${verdict === v.id ? toneColor(v.tone) : "var(--border)"}`,
                    background: verdict === v.id ? "var(--bg-alt)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <p style={{ fontSize: 13, color: toneColor(v.tone), fontWeight: 600 }}>
                    {v.label}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--fg-dim)" }}>{v.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Spec-points */}
          <div className="kl-card">
            <p
              className="font-mono mb-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Spec-point claims (optional, up to 16)
            </p>
            <p className="mb-2" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
              The framework + code identifiers on which the learner demonstrated
              competence (e.g. <code>AQA-GCSE-9-1-Maths</code> + <code>A18</code>).
              These propagate verbatim to the W3C Verifiable Credential when one
              is later issued from this attestation.
            </p>
            <div className="flex gap-2 flex-wrap mb-3">
              {specPoints.map((sp, i) => (
                <span
                  key={i}
                  className="rounded-md px-2 py-1 flex items-center gap-1.5"
                  style={{
                    background: "var(--bg-alt)",
                    border: "1px solid var(--border)",
                    fontSize: 11,
                  }}
                >
                  <code>{sp.framework}</code>
                  <span style={{ color: "var(--fg-faint)" }}>·</span>
                  <code>{sp.code}</code>
                  <button
                    onClick={() => removeSpecPoint(i)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--fg-faint)",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                    }}
                    aria-label={`Remove ${sp.framework} ${sp.code}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              {specPoints.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--fg-faint)", fontStyle: "italic" }}>
                  No spec-points yet.
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={newFramework}
                onChange={(e) => setNewFramework(e.target.value)}
                placeholder="framework (e.g. AQA-GCSE-9-1-Maths)"
                className="rounded-md px-2 py-1.5 flex-1 min-w-[200px]"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--fg)",
                  fontSize: 12,
                }}
              />
              <input
                type="text"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="code (e.g. A18)"
                className="rounded-md px-2 py-1.5"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--fg)",
                  fontSize: 12,
                  width: 140,
                }}
              />
              <button
                onClick={addSpecPoint}
                disabled={!newFramework.trim() || !newCode.trim() || specPoints.length >= 16}
                className="rounded-md px-3 py-1.5 flex items-center gap-1"
                style={{
                  background: "var(--bg-alt)",
                  border: "1px solid var(--border)",
                  color: "var(--fg)",
                  fontSize: 12,
                  cursor:
                    !newFramework.trim() || !newCode.trim() || specPoints.length >= 16
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    !newFramework.trim() || !newCode.trim() || specPoints.length >= 16
                      ? 0.5
                      : 1,
                }}
              >
                <Plus size={12} aria-hidden="true" />
                Add
              </button>
            </div>
          </div>

          {/* Reviewer note */}
          <div className="kl-card">
            <p
              className="font-mono mb-2 flex items-center justify-between"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              <span>Reviewer note (optional)</span>
              <span
                style={{
                  color: noteOver ? "var(--hub-danger)" : "var(--fg-faint)",
                }}
              >
                {reviewerNote.length} / {REVIEWER_NOTE_MAX_CHARS}
              </span>
            </p>
            <textarea
              value={reviewerNote}
              onChange={(e) => setReviewerNote(e.target.value)}
              placeholder="A short professional judgement in your own words. Bound to a single sentence."
              rows={3}
              className="rounded-md w-full p-2"
              style={{
                background: "var(--bg)",
                border: `1px solid ${noteOver ? "var(--hub-danger)" : "var(--border)"}`,
                color: "var(--fg)",
                fontSize: 13,
                resize: "vertical",
              }}
            />
          </div>

          {/* Sign action */}
          <div className="flex items-center gap-3">
            <button
              onClick={onSign}
              disabled={!canSign}
              className="px-4 py-2 rounded-md text-xs font-medium flex items-center gap-2"
              style={{
                background: canSign ? "var(--accent)" : "var(--bg-alt)",
                color: canSign ? "#0A0E12" : "var(--fg-faint)",
                cursor: canSign ? "pointer" : "not-allowed",
                opacity: signing ? 0.5 : 1,
              }}
            >
              <KeyRound size={14} aria-hidden="true" />
              {signing
                ? "Awaiting passkey…"
                : verdict
                ? `Sign attestation with passkey`
                : "Pick a verdict to continue"}
            </button>
            {!passkeyEnrolled && (
              <p style={{ fontSize: 12, color: "var(--hub-warning)" }}>
                Enrol a passkey first.
              </p>
            )}
          </div>

          {error && (
            <div className="kl-card flex items-start gap-2" style={{ borderColor: "var(--hub-danger)" }}>
              <AlertTriangle size={16} aria-hidden="true" style={{ color: "var(--hub-danger)", marginTop: 2 }} />
              <p style={{ fontSize: 13, color: "var(--fg)" }}>{error}</p>
            </div>
          )}

          {justSigned && (
            <div className="kl-card flex items-start gap-2" style={{ borderColor: "var(--accent)" }}>
              <CheckCircle2 size={16} aria-hidden="true" style={{ color: "var(--accent)", marginTop: 2 }} />
              <div style={{ fontSize: 13 }}>
                <p style={{ color: "var(--fg)" }}>
                  <strong>Attestation signed.</strong> Verdict:{" "}
                  <code>{justSigned.payload.verdict}</code>. Signature prefix:{" "}
                  <code>{justSigned.signatureB64url.slice(0, 16)}…</code>
                </p>
                <p style={{ color: "var(--fg-dim)" }} className="mt-1">
                  This counter-credential is now in the local attestation bank
                  and will be wrapped as a W3C Verifiable Credential when the
                  VC issuer ships.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function toneColor(tone: "ok" | "info" | "warn" | "danger"): string {
  switch (tone) {
    case "ok":     return "var(--accent)";
    case "info":   return "var(--fg)";
    case "warn":   return "var(--hub-warning)";
    case "danger": return "var(--hub-danger)";
  }
}

/**
 * Build and persist a plausible CognitiveReasoningTrace so the teacher
 * can exercise the full attest flow without waiting for real classroom
 * traffic. The trace itself is signed with the student's session key
 * (no passkey required for student-side traces in v1).
 */
async function seedSampleCrt(): Promise<void> {
  const startTime = Date.now() - 4 * 60 * 1000; // ~4 min ago
  const trace: CognitiveReasoningTrace = {
    studentId: `S00${1 + Math.floor(Math.random() * 4)}`,
    sessionId: `seed-${Math.random().toString(36).slice(2, 10)}`,
    problemId: "uk-gcse-maths-quadratics-001",
    events: [
      { id: "e1", timestamp: startTime + 0,       eventType: "start",      hash: "h1" },
      { id: "e2", timestamp: startTime + 5000,    eventType: "hint_request", hash: "h2" },
      { id: "e3", timestamp: startTime + 30000,   eventType: "deletion",   hash: "h3" },
      { id: "e4", timestamp: startTime + 90000,   eventType: "pivot",      hash: "h4" },
      { id: "e5", timestamp: startTime + 210000,  eventType: "submission", hash: "h5" },
    ],
    startTime,
    endTime: startTime + 240000,
    totalThinkTime: 240000,
    deletionCount: 1,
    pivotCount: 1,
    proofOfWorkHash: "demo-pow-hash-" + Math.random().toString(36).slice(2),
  };
  await appendCRT(trace);
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <RoleGuard role="teacher" roleLabel="Teacher" demoHint="mentor-alpha-42">
      <AttestPageInner />
    </RoleGuard>
  );
}
