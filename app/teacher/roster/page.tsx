"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/teacher/roster/page.tsx
//
// v1.6.6 — Teacher roster import surface. Drag-drop a CSV, see a live
// dry-run preview (counts + error panel + first-N rows), then commit.
// Sits behind RoleGuard ("teacher") and inherits the server-verified
// role session middleware.
//
// PRIVACY POSTURE
// ───────────────
// All parsing and validation happen client-side. The file the teacher
// drags is never uploaded — the bytes are read by FileReader and
// processed in-page. On commit, learner records are encrypted (via
// `lib/roster/store`) and a PII-free counts-only event is published
// on the bus.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import RoleGuard from "@/components/shared/RoleGuard";
import { Upload, AlertTriangle, CheckCircle2, Trash2, FileText } from "lucide-react";
import {
  prepareImport,
  commitImport,
  type RosterImportPlan,
} from "@/lib/roster/import";
import {
  persistImportedRoster,
  loadRoster,
  clearRoster,
  type RosterPayload,
} from "@/lib/roster/store";
import type { RowError } from "@/lib/roster/schema";
import { publish } from "@/lib/data-bus";

// Sample CSV embedded directly. Used by the "load sample" button so
// the teacher can see the full flow end-to-end without producing their
// own file. Six learners, mixed jurisdictions, one deliberate error
// (year_group out of range for jurisdiction) to demonstrate the error
// panel.
const SAMPLE_CSV = [
  "external_id,given_name,family_name,year_group,jurisdiction,date_of_birth,email,class_group,consent_status",
  "S001,Aoife,Murphy,8,IE,2013-09-04,,1st Year B,parental_consent_on_file",
  "S002,Liam,O'Brien,9,UK-EN,2012-06-15,,9C,parental_consent_on_file",
  "S003,Mia,Patel,10,UK-EN,2011-02-22,,10A,parental_consent_on_file",
  "S004,Daniel,Kim,7,UK-EN,2014-11-30,,7B,pending",
  "S005,Saoirse,Walsh,4,IE,2015-04-18,,3rd Class,parental_consent_on_file",
  "S006,Noah,Garcia,99,UK-EN,2010-01-01,,11A,parental_consent_on_file",
].join("\n");

function RosterPageInner() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [persisted, setPersisted] = useState<RosterPayload | null>(null);

  // Load any existing persisted roster on mount.
  useEffect(() => {
    void loadRoster().then((r) => setPersisted(r));
  }, []);

  // Re-compute the import plan whenever the CSV text changes. Pure +
  // cheap (validation runs in well under a millisecond for 1000 rows),
  // so a useMemo with `csvText` as the only dep is the right granularity.
  const importResult = useMemo(() => {
    if (!csvText.trim()) return null;
    return prepareImport(csvText);
  }, [csvText]);

  const plan: RosterImportPlan | null =
    importResult && importResult.ok ? importResult.plan : null;
  const fatal =
    importResult && !importResult.ok ? importResult.error : null;

  // ── File handlers ────────────────────────────────────────────────────────
  function readFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
    };
    reader.readAsText(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  }

  function loadSample() {
    setFileName("sample-roster.csv");
    setCsvText(SAMPLE_CSV);
  }

  function clearStaging() {
    setCsvText("");
    setFileName("");
    if (fileInput.current) fileInput.current.value = "";
  }

  // ── Commit ───────────────────────────────────────────────────────────────
  async function onCommit() {
    if (!plan || !plan.committable) return;
    setCommitting(true);
    try {
      const receipt = await commitImport(
        plan,
        async (records) => {
          await persistImportedRoster(
            records,
            new Date().toISOString(),
            // The digest computed inside commitImport ends up in the
            // receipt; we re-package it here so the store's record
            // matches. Two SHA-256 calls is cheap.
            "",
          );
        },
        (event) => {
          publish(
            event.type as Parameters<typeof publish>[0],
            event.payload,
            "teacher",
          );
        },
      );
      // Persist the FINAL digest from the receipt so the store's
      // rosterDigestB64url matches the bus-emitted one.
      await persistImportedRoster(
        plan.valid,
        receipt.committedAtIso,
        receipt.rosterDigestB64url,
      );
      setPersisted(await loadRoster());
      clearStaging();
    } finally {
      setCommitting(false);
    }
  }

  async function onClearPersisted() {
    if (!window.confirm(
      "Permanently delete the persisted roster from this device? This " +
      "cannot be undone. Re-importing the same CSV will restore it.",
    )) return;
    clearRoster();
    setPersisted(null);
  }

  return (
    <SurfaceShell
      theme="sovereign"
      surfaceLabel="Teacher · Roster Import"
      surfaceUser="MS. RYAN · 4Y · ROSTER"
      rightSlot={
        <span
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}
        >
          {persisted
            ? <>ON ROSTER <span style={{ color: "var(--fg)" }}>{persisted.learners.length}</span></>
            : <>NO ROSTER LOADED</>}
        </span>
      }
    >
      <div className="space-y-6">
        {/* Persisted roster summary */}
        {persisted && (
          <div className="kl-card">
            <div className="flex items-center justify-between">
              <div>
                <p
                  className="font-mono mb-1"
                  style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
                >
                  Current Roster
                </p>
                <p className="text-lg">
                  <strong>{persisted.learners.length}</strong> learners,
                  committed{" "}
                  <span style={{ color: "var(--fg-dim)" }}>
                    {new Date(persisted.committedAtIso).toLocaleString()}
                  </span>
                </p>
                <p
                  className="font-mono mt-2"
                  style={{ fontSize: 11, color: "var(--fg-faint)" }}
                >
                  digest: <code>{persisted.rosterDigestB64url.slice(0, 16)}…</code>
                </p>
              </div>
              <button
                onClick={onClearPersisted}
                className="px-3 py-1.5 rounded-md text-[10px] uppercase tracking-wider flex items-center gap-1.5"
                style={{
                  background: "var(--bg-alt)",
                  border: "1px solid var(--border)",
                  color: "var(--hub-danger)",
                }}
              >
                <Trash2 size={12} aria-hidden="true" />
                Delete roster
              </button>
            </div>
          </div>
        )}

        {/* Upload zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className="kl-card text-center"
          style={{
            borderStyle: "dashed",
            borderColor: dragActive ? "var(--accent)" : "var(--border)",
            background: dragActive ? "var(--bg-alt)" : "transparent",
            transition: "all 120ms ease",
            padding: "2.5rem 1rem",
          }}
        >
          <Upload
            size={32}
            aria-hidden="true"
            style={{ color: "var(--fg-faint)", margin: "0 auto" }}
          />
          <p className="mt-3 text-lg">Drop a roster CSV here</p>
          <p
            className="mt-1"
            style={{ color: "var(--fg-dim)", fontSize: 13 }}
          >
            Required columns:{" "}
            <code>external_id, given_name, family_name, year_group, jurisdiction</code>.
            File is parsed entirely in your browser — nothing is uploaded.
          </p>
          <div className="mt-4 flex gap-2 justify-center">
            <button
              onClick={() => fileInput.current?.click()}
              className="px-4 py-2 rounded-md text-xs font-medium"
              style={{ background: "var(--accent)", color: "#0A0E12" }}
            >
              Choose file…
            </button>
            <button
              onClick={loadSample}
              className="px-4 py-2 rounded-md text-xs"
              style={{
                background: "var(--bg-alt)",
                border: "1px solid var(--border)",
                color: "var(--fg)",
              }}
            >
              Load sample
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={onPick}
            style={{ display: "none" }}
          />
          {fileName && (
            <p
              className="mt-3 font-mono"
              style={{ fontSize: 11, color: "var(--fg-faint)" }}
            >
              <FileText size={11} style={{ display: "inline", marginRight: 4 }} aria-hidden="true" />
              {fileName}
              {" · "}
              <button
                onClick={clearStaging}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  padding: 0,
                  font: "inherit",
                }}
              >
                clear
              </button>
            </p>
          )}
        </div>

        {/* Fatal parse error */}
        {fatal && (
          <div
            className="kl-card flex items-start gap-3"
            style={{ borderColor: "var(--hub-danger)" }}
          >
            <AlertTriangle
              size={20}
              aria-hidden="true"
              style={{ color: "var(--hub-danger)", flexShrink: 0, marginTop: 2 }}
            />
            <div>
              <p
                className="font-mono mb-1"
                style={{ fontSize: 10, color: "var(--hub-danger)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                CSV parse error — cannot proceed
              </p>
              <p>{fatal.message}</p>
            </div>
          </div>
        )}

        {/* Plan summary + preview */}
        {plan && (
          <div className="space-y-4">
            <PlanSummary plan={plan} />
            <PreviewTable plan={plan} />
            <ErrorPanel errors={plan.errors} />
            <div className="flex items-center gap-3">
              <button
                onClick={onCommit}
                disabled={!plan.committable || committing}
                className="px-4 py-2 rounded-md text-xs font-medium flex items-center gap-2"
                style={{
                  background: plan.committable ? "var(--accent)" : "var(--bg-alt)",
                  color: plan.committable ? "#0A0E12" : "var(--fg-faint)",
                  cursor: plan.committable && !committing ? "pointer" : "not-allowed",
                  opacity: committing ? 0.5 : 1,
                }}
              >
                <CheckCircle2 size={14} aria-hidden="true" />
                {committing
                  ? "Committing…"
                  : plan.committable
                  ? `Commit ${plan.summary.valid} learner${plan.summary.valid === 1 ? "" : "s"}`
                  : "No valid rows to commit"}
              </button>
              {plan.summary.errors > 0 && plan.committable && (
                <p style={{ color: "var(--fg-dim)", fontSize: 12 }}>
                  {plan.summary.errors} row{plan.summary.errors === 1 ? "" : "s"} will be skipped.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </SurfaceShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PlanSummary({ plan }: { plan: RosterImportPlan }) {
  const cells: Array<{ label: string; value: number; tone?: "ok" | "warn" | "danger" }> = [
    { label: "Total rows", value: plan.summary.totalRows },
    { label: "Valid", value: plan.summary.valid, tone: "ok" },
    { label: "Errors", value: plan.summary.errors, tone: plan.summary.errors > 0 ? "danger" : undefined },
    { label: "Under 13", value: plan.summary.under13, tone: plan.summary.under13 > 0 ? "warn" : undefined },
    { label: "Duplicates", value: plan.summary.duplicates, tone: plan.summary.duplicates > 0 ? "warn" : undefined },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className="kl-card"
          style={{ padding: "0.875rem 1rem" }}
        >
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
                c.tone === "ok"     ? "var(--accent)"
                : c.tone === "warn"  ? "var(--hub-warning)"
                : c.tone === "danger" ? "var(--hub-danger)"
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

function PreviewTable({ plan }: { plan: RosterImportPlan }) {
  if (plan.valid.length === 0) return null;
  // Show up to first 20 learners; the rest are summarised below.
  const head = plan.valid.slice(0, 20);
  const remainder = plan.valid.length - head.length;
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
          Preview ({head.length} of {plan.valid.length})
        </p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="w-full" style={{ fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              <Th>External ID</Th>
              <Th>Name</Th>
              <Th>Year</Th>
              <Th>Jurisdiction</Th>
              <Th>DOB / age</Th>
              <Th>Consent</Th>
            </tr>
          </thead>
          <tbody>
            {head.map((l) => (
              <tr key={l.externalId} style={{ borderTop: "1px solid var(--border)" }}>
                <Td><code>{l.externalId}</code></Td>
                <Td>{l.givenName} {l.familyName}</Td>
                <Td>{l.yearGroup}</Td>
                <Td>{l.jurisdiction}</Td>
                <Td>
                  {l.dateOfBirth ? l.dateOfBirth : <span style={{ color: "var(--fg-faint)" }}>—</span>}
                  {l.isUnder13 && (
                    <span
                      style={{ marginLeft: 8, color: "var(--hub-warning)", fontSize: 11 }}
                    >
                      under&nbsp;13
                    </span>
                  )}
                </Td>
                <Td>
                  <span
                    style={{
                      fontSize: 11,
                      color:
                        l.consentStatus === "parental_consent_on_file"
                          ? "var(--accent)"
                          : l.consentStatus === "pending"
                          ? "var(--hub-warning)"
                          : "var(--fg-dim)",
                    }}
                  >
                    {l.consentStatus.replace(/_/g, " ")}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {remainder > 0 && (
          <p
            className="px-4 py-3 font-mono"
            style={{
              fontSize: 11,
              color: "var(--fg-faint)",
              borderTop: "1px solid var(--border)",
            }}
          >
            … plus {remainder} more {remainder === 1 ? "learner" : "learners"}.
          </p>
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ errors }: { errors: RowError[] }) {
  if (errors.length === 0) return null;
  return (
    <div
      className="kl-card p-0 overflow-hidden"
      style={{ borderColor: "var(--hub-danger)" }}
    >
      <div
        className="px-4 py-3 flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-alt)" }}
      >
        <AlertTriangle size={14} aria-hidden="true" style={{ color: "var(--hub-danger)" }} />
        <p
          className="font-mono"
          style={{ fontSize: 10, color: "var(--hub-danger)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          {errors.length} error{errors.length === 1 ? "" : "s"} — these rows will be skipped
        </p>
      </div>
      <ul style={{ fontSize: 12 }}>
        {errors.slice(0, 50).map((e, i) => (
          <li
            key={i}
            className="px-4 py-2 font-mono"
            style={{
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
              color: "var(--fg)",
            }}
          >
            <span style={{ color: "var(--fg-faint)" }}>
              line {e.line}
            </span>
            {e.field && (
              <span style={{ color: "var(--fg-faint)" }}>
                {" · "}<code>{e.field}</code>
              </span>
            )}
            <span style={{ color: "var(--fg-faint)" }}>
              {" · "}<code>{e.code}</code>
            </span>
            <br />
            <span style={{ marginLeft: 0 }}>{e.message}</span>
          </li>
        ))}
        {errors.length > 50 && (
          <li
            className="px-4 py-2 font-mono"
            style={{ fontSize: 11, color: "var(--fg-faint)", borderTop: "1px solid var(--border)" }}
          >
            … plus {errors.length - 50} more errors.
          </li>
        )}
      </ul>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-4 py-2 font-mono"
      style={{
        fontSize: 10,
        color: "var(--fg-faint)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2" style={{ color: "var(--fg)" }}>{children}</td>;
}

export default function Page() {
  return (
    <RoleGuard role="teacher" roleLabel="Teacher" demoHint="mentor-alpha-42">
      <RosterPageInner />
    </RoleGuard>
  );
}
