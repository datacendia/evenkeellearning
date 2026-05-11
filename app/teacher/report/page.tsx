"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/teacher/report/page.tsx
//
// v1.6.10 — Printable parent report.
//
// Why this lives under /teacher (not /parent)
// ───────────────────────────────────────────
// A parent report is *issued by a teacher* and signed with the teacher's
// passkey. The parent receives a printed (or PDF-saved) copy; they do
// not generate it themselves. Putting the screen behind RoleGuard
// "teacher" makes the trust boundary explicit.
//
// PDF generation
// ──────────────
// No external pdf-lib dependency. Print quality is identical to a
// dedicated library for this report's shape (text + small tables), and
// the browser's "Print → Save as PDF" path:
//   (a) keeps the signed JSON envelope copy-pasteable from the page,
//   (b) avoids shipping ~250 KB of pdf-lib + fonts to every parent who
//       opens this surface,
//   (c) means a parent can verify the signature with a single
//       browser-only tool (the standalone VC verifier, when it lands).
// The `@media print` block hides controls and bus-debug strips.
//
// PRIVACY POSTURE
// ───────────────
// • The page reads the roster, CRT bank, and attestation bank from the
//   local device. No network calls. No payload leaves the browser until
//   the teacher chooses to print or share the file.
// • The signed envelope is shown in a `<details>` collapsible so it
//   doesn't visually overwhelm the human-facing summary.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import RoleGuard from "@/components/shared/RoleGuard";
import { Printer, PenLine, AlertTriangle, ShieldCheck } from "lucide-react";
import { loadRoster } from "@/lib/roster/store";
import { listCRTs } from "@/lib/crt/bank";
import { listAttestations } from "@/lib/teacher/attestation-bank";
import { getEnrolment, isPasskeySupported } from "@/lib/crypto/passkey";
import {
  buildParentReportPayload,
  selectLearnerArtefacts,
  signParentReport,
  buildBusSummary,
  learnerDisplayFromRecord,
  type ParentReportEnvelope,
  type ReportLearnerDisplay,
} from "@/lib/parent/report";
import type { LearnerRecord } from "@/lib/roster/schema";
import { publish } from "@/lib/data-bus";

function ReportPageInner() {
  const [learners, setLearners] = useState<LearnerRecord[]>([]);
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null);
  const [periodFromIso, setPeriodFromIso] = useState<string>(defaultPeriodFromIso());
  const [periodToIso, setPeriodToIso] = useState<string>(defaultPeriodToIso());
  const [envelope, setEnvelope] = useState<ParentReportEnvelope | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);

  useEffect(() => {
    (async () => {
      const roster = await loadRoster();
      const records = roster?.learners ?? [];
      setLearners(records);
      if (records.length > 0 && !selectedExternalId) {
        setSelectedExternalId(records[0].externalId);
      }
      setPasskeyEnrolled(!!getEnrolment() && isPasskeySupported());
    })().catch(() => {
      /* roster load is best-effort */
    });
    // We intentionally do not depend on selectedExternalId — this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLearner = useMemo<ReportLearnerDisplay | null>(() => {
    const rec = learners.find((l) => l.externalId === selectedExternalId);
    return rec ? learnerDisplayFromRecord(rec) : null;
  }, [learners, selectedExternalId]);

  // Live preview payload (un-signed). Re-builds on any state change.
  const previewPayload = useMemo(() => {
    if (!selectedLearner) return null;
    try {
      const { crts, attestations } = selectLearnerArtefacts({
        learnerExternalId: selectedLearner.externalId,
        crts: listCRTs(),
        attestations: listAttestations(),
      });
      return buildParentReportPayload({
        learner: selectedLearner,
        crts,
        attestations,
        periodFromIso: new Date(periodFromIso).toISOString(),
        periodToIso: new Date(periodToIso + "T23:59:59Z").toISOString(),
      });
    } catch (e) {
      return null;
    }
  }, [selectedLearner, periodFromIso, periodToIso]);

  async function handleSign() {
    if (!previewPayload) return;
    setSigning(true);
    setError(null);
    try {
      const env = await signParentReport(previewPayload);
      setEnvelope(env);
      try {
        publish("parent.report.signed", buildBusSummary(env), "teacher");
      } catch {
        /* bus may be unavailable */
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Signing failed. Ensure your passkey is enrolled and try again.",
      );
    } finally {
      setSigning(false);
    }
  }

  function handlePrint() {
    if (typeof window !== "undefined") window.print();
  }

  const payload = envelope?.payload ?? previewPayload;

  return (
    <SurfaceShell
      theme="paper"
      surfaceLabel="Teacher · Parent Report"
      surfaceUser="MS. RYAN · 4Y · REPORT"
    >
      <style>{printCss}</style>

      <div className="space-y-6">
        {/* Controls — hidden in print */}
        <div className="kl-card no-print">
          <p
            className="font-mono mb-3"
            style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Generate parent report
          </p>
          {learners.length === 0 ? (
            <div className="flex items-start gap-2 text-sm" style={{ color: "var(--fg-dim)" }}>
              <AlertTriangle size={14} style={{ color: "var(--accent)", marginTop: 2 }} />
              <span>No roster loaded. Import a CSV via Teacher · Roster first.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="text-xs space-y-1">
                <span style={{ color: "var(--fg-faint)" }}>Learner</span>
                <select
                  className="w-full p-2 rounded border"
                  style={{ background: "var(--bg-deep)", borderColor: "var(--fg-faint)" }}
                  value={selectedExternalId ?? ""}
                  onChange={(e) => {
                    setSelectedExternalId(e.target.value);
                    setEnvelope(null);
                  }}
                >
                  {learners.map((l) => (
                    <option key={l.externalId} value={l.externalId}>
                      {l.givenName} {l.familyName} · {l.externalId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span style={{ color: "var(--fg-faint)" }}>Period from</span>
                <input
                  type="date"
                  className="w-full p-2 rounded border"
                  style={{ background: "var(--bg-deep)", borderColor: "var(--fg-faint)" }}
                  value={periodFromIso}
                  onChange={(e) => {
                    setPeriodFromIso(e.target.value);
                    setEnvelope(null);
                  }}
                />
              </label>
              <label className="text-xs space-y-1">
                <span style={{ color: "var(--fg-faint)" }}>Period to</span>
                <input
                  type="date"
                  className="w-full p-2 rounded border"
                  style={{ background: "var(--bg-deep)", borderColor: "var(--fg-faint)" }}
                  value={periodToIso}
                  onChange={(e) => {
                    setPeriodToIso(e.target.value);
                    setEnvelope(null);
                  }}
                />
              </label>
            </div>
          )}
          {!passkeyEnrolled && learners.length > 0 && (
            <div className="mt-3 flex items-start gap-2 text-xs" style={{ color: "var(--accent)" }}>
              <AlertTriangle size={14} style={{ marginTop: 1 }} />
              <span>
                Passkey enrolment is required to sign a parent report. Enrol via
                the attestation surface first.
              </span>
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className="kl-btn"
              onClick={handleSign}
              disabled={!previewPayload || signing || !passkeyEnrolled}
              style={{ opacity: !previewPayload || !passkeyEnrolled ? 0.5 : 1 }}
            >
              <PenLine size={14} style={{ marginRight: 6 }} />
              {signing ? "Signing…" : envelope ? "Re-sign report" : "Sign report"}
            </button>
            <button
              type="button"
              className="kl-btn"
              onClick={handlePrint}
              disabled={!envelope}
              style={{ opacity: envelope ? 1 : 0.5 }}
            >
              <Printer size={14} style={{ marginRight: 6 }} />
              Print / Save as PDF
            </button>
          </div>
          {error && (
            <p className="text-xs mt-3" style={{ color: "var(--accent)" }}>
              {error}
            </p>
          )}
        </div>

        {/* Printable report body */}
        {payload && (
          <div className="kl-card print-page">
            <header className="mb-6">
              <p
                className="font-mono"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                Even Keel · Parent Report · v{payload.version}
                {envelope ? " · Signed" : " · Unsigned preview"}
              </p>
              <h1 className="font-serif text-3xl mt-1">
                {payload.learner.givenName} {payload.learner.familyName}
              </h1>
              <p className="text-sm" style={{ color: "var(--fg-dim)" }}>
                Year {payload.learner.yearGroup}
                {payload.learner.classGroup ? ` · ${payload.learner.classGroup}` : ""}
                {" · "}ID {payload.learner.externalId}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--fg-faint)" }}>
                Period: {fmtDate(payload.periodFromIso)} → {fmtDate(payload.periodToIso)}
                {" · "}Generated: {fmtDate(payload.generatedAtIso)}
              </p>
            </header>

            {/* Totals tiles */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Tile label="Sessions" value={String(payload.totals.sessions)} />
              <Tile
                label="Attested sessions"
                value={`${payload.totals.attestedSessions} / ${payload.totals.sessions}`}
              />
              <Tile label="Attestations" value={String(payload.totals.attestations)} />
              <Tile
                label="Mastery verdicts"
                value={String(
                  (payload.totals.verdictCounts["verified-mastery"] ?? 0) +
                    (payload.totals.verdictCounts["verified-with-support"] ?? 0),
                )}
              />
            </section>

            {/* Sessions */}
            <section className="mb-6">
              <h2 className="font-serif text-xl mb-2">Sessions</h2>
              {payload.sessions.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--fg-faint)" }}>
                  No sessions in this period.
                </p>
              ) : (
                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--fg-faint)" }}>
                      <th className="text-left p-1">Date</th>
                      <th className="text-left p-1">Problem</th>
                      <th className="text-right p-1">Duration</th>
                      <th className="text-right p-1">Events</th>
                      <th className="text-right p-1">Edits / pivots</th>
                      <th className="text-left p-1">Attested</th>
                      <th className="text-left p-1 font-mono">Sig prefix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.sessions.map((s) => (
                      <tr
                        key={s.crtContentDigestB64url + s.sessionId}
                        style={{ borderBottom: "1px solid var(--bg-deep)" }}
                      >
                        <td className="p-1">{fmtDate(s.startedAtIso)}</td>
                        <td className="p-1">{s.problemId}</td>
                        <td className="p-1 text-right">{fmtDuration(s.durationMs)}</td>
                        <td className="p-1 text-right">{s.eventCount}</td>
                        <td className="p-1 text-right">
                          {s.deletionCount} / {s.pivotCount}
                        </td>
                        <td className="p-1">
                          {s.attested ? (
                            <ShieldCheck size={12} style={{ color: "var(--accent)" }} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-1 font-mono" style={{ fontSize: 10 }}>
                          {s.signaturePrefix}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Attestations / receipts */}
            <section className="mb-6">
              <h2 className="font-serif text-xl mb-2">Teacher attestation receipts</h2>
              {payload.attestations.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--fg-faint)" }}>
                  No attestations in this period.
                </p>
              ) : (
                <ul className="space-y-3">
                  {payload.attestations.map((a) => (
                    <li
                      key={a.signaturePrefix + a.attestedAtIso}
                      className="p-3 rounded"
                      style={{ background: "var(--bg-deep)" }}
                    >
                      <div className="flex justify-between text-xs">
                        <span style={{ fontWeight: 600 }}>{a.problemId}</span>
                        <span className="font-mono" style={{ color: "var(--fg-faint)" }}>
                          {fmtDate(a.attestedAtIso)}
                        </span>
                      </div>
                      <p className="text-sm mt-1">
                        Verdict: <strong>{a.verdict}</strong>
                      </p>
                      {a.reviewerNote && (
                        <p className="text-sm mt-1" style={{ color: "var(--fg-dim)" }}>
                          “{a.reviewerNote}”
                        </p>
                      )}
                      {a.specPoints.length > 0 && (
                        <p className="text-xs mt-1" style={{ color: "var(--fg-faint)" }}>
                          {a.specPoints
                            .map((sp) => `${sp.framework}/${sp.code}${sp.label ? ` (${sp.label})` : ""}`)
                            .join(" · ")}
                        </p>
                      )}
                      <p className="font-mono text-xs mt-2" style={{ color: "var(--fg-faint)", fontSize: 10 }}>
                        sig {a.signaturePrefix} · key {a.publicKeyPrefix} · {a.keyType}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Verification footer — always present so a verifier can
                copy the envelope back out of a print/scan. */}
            {envelope && (
              <footer
                className="text-xs pt-4"
                style={{ borderTop: "1px dashed var(--fg-faint)", color: "var(--fg-dim)" }}
              >
                <p style={{ fontWeight: 600 }}>How to verify this report</p>
                <p className="mt-1">
                  This page was signed by the issuing teacher using a hardware-backed
                  passkey. The signed envelope below pins every session and
                  attestation by content digest. Any change to the printed
                  contents invalidates the signature.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-2 font-mono" style={{ fontSize: 10 }}>
                  <div>
                    <span style={{ color: "var(--fg-faint)" }}>Report digest:</span>
                    <br />
                    {envelope.contentDigestB64url}
                  </div>
                  <div>
                    <span style={{ color: "var(--fg-faint)" }}>Signature:</span>
                    <br />
                    {envelope.signatureB64url.slice(0, 32)}…
                  </div>
                  <div>
                    <span style={{ color: "var(--fg-faint)" }}>Issuer public key:</span>
                    <br />
                    {envelope.publicKeyB64url.slice(0, 32)}…
                  </div>
                  <div>
                    <span style={{ color: "var(--fg-faint)" }}>Algorithm / key tier:</span>
                    <br />
                    {envelope.algorithm} · {envelope.keyType ?? "unknown"}
                  </div>
                </div>
                <details className="mt-3 no-print">
                  <summary
                    className="cursor-pointer"
                    style={{ color: "var(--fg-faint)" }}
                  >
                    Show full signed envelope JSON
                  </summary>
                  <pre
                    className="mt-2 p-2 rounded overflow-x-auto"
                    style={{ background: "var(--bg-deep)", fontSize: 10 }}
                  >
                    {JSON.stringify(envelope, null, 2)}
                  </pre>
                </details>
              </footer>
            )}
          </div>
        )}
      </div>
    </SurfaceShell>
  );
}

// ─── small helpers ─────────────────────────────────────────────────────────

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded" style={{ background: "var(--bg-deep)" }}>
      <p
        className="font-mono"
        style={{ fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p className="font-serif text-2xl mt-1">{value}</p>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function defaultPeriodFromIso(): string {
  // 30 days ago (date-input format yyyy-mm-dd)
  const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function defaultPeriodToIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const printCss = `
@media print {
  .no-print { display: none !important; }
  body { background: white !important; }
  .kl-card { box-shadow: none !important; border: none !important; }
  .print-page { page-break-inside: avoid; }
}
`;

export default function Page() {
  return (
    <RoleGuard role="teacher" roleLabel="Teacher" demoHint="mentor-alpha-42">
      <ReportPageInner />
    </RoleGuard>
  );
}
