"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/compliance/page.tsx
//
// Compliance Officer surface ("Sovereign OS"). Hosts the Compliance Pulse,
// the Resolution Tray (where conflicts are signed), the Audit Vault (signed
// resolutions, verifiable on-page), and the Integrity Ledger (live tail of
// audit-bus events).
//
// Signatures here are REAL ECDSA P-256 (WebCrypto), not mocks. Each signed
// resolution emits a `compliance.conflict.resolved` event onto the data bus
// so the Integrity Ledger updates in real time.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import JsonViewer from "@/components/shared/JsonViewer";
import RoleGuard from "@/components/shared/RoleGuard";
import SafeguardingEscalationsCard from "@/components/shared/SafeguardingEscalationsCard";
import TransparencyBundleCard from "@/components/shared/TransparencyBundleCard";
import {
  ShieldCheck,
  AlertTriangle,
  FileSignature,
  Archive,
  CheckCheck,
  KeyRound,
} from "lucide-react";
import {
  listConflicts,
  resolveConflict,
  compliancePulseScore,
} from "@/lib/regulatory-absorb/adapter-mock";
import { prioritize } from "@/lib/regulatory-absorb/prioritizer";
import { RegulatoryConflict } from "@/lib/regulatory-absorb/types";
import { verifyEnvelope } from "@/lib/crypto/signing";
import { publish, subscribe, BusEvent, recentEvents } from "@/lib/data-bus";

const NAV = [
  { id: "pulse",        label: "Compliance Pulse" },
  { id: "tray",         label: "Resolution Tray" },
  { id: "vault",        label: "Audit Vault" },
  { id: "ledger",       label: "Integrity Ledger" },
  { id: "safeguarding", label: "Safeguarding" },
  { id: "transparency", label: "Transparency" },
];

function CompliancePageInner() {
  const [view, setView] = useState("pulse");
  const [conflicts, setConflicts] = useState<RegulatoryConflict[]>([]);
  const [pulse, setPulse] = useState(100);
  const [studentJurisdiction] = useState("IE");

  useEffect(() => {
    listConflicts().then((c) => {
      setConflicts(c);
      setPulse(compliancePulseScore(c));
    });
  }, []);

  const handleResolve = async (c: RegulatoryConflict) => {
    const recommendation = prioritize(c, studentJurisdiction);
    const resolved = await resolveConflict(
      c.id,
      "compliance-officer-demo",
      `Auto-applied: ${recommendation.justification}`
    );
    const next = await listConflicts();
    setConflicts(next);
    setPulse(compliancePulseScore(next));
    // Announce the signed resolution onto the audit bus so the Integrity
    // Ledger and any subscribed surface (parent/teacher) can react.
    if (resolved && resolved.signatureFull) {
      publish(
        "compliance.conflict.resolved",
        {
          conflictId: resolved.id,
          resolvedBy: resolved.resolvedBy ?? "unknown",
          shortSignature: resolved.signature ?? "",
          algorithm: resolved.signatureAlgorithm ?? "ECDSA-P256-SHA256",
          signedAtIso: resolved.signedAtIso ?? new Date().toISOString(),
        },
        "compliance"
      );
    }
  };

  return (
    <SurfaceShell
      theme="sovereign"
      surfaceLabel="Compliance Officer · Sovereign OS"
      surfaceUser="PRINCIPAL · ST. ANNE'S · IE"
      navItems={NAV}
      activeId={view}
      onNavChange={setView}
      rightSlot={
        <span
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}
        >
          PULSE <span style={{ color: pulse >= 80 ? "var(--accent)" : "var(--hub-warning)" }}>{pulse}</span>
        </span>
      }
    >
      {view === "pulse"        && <Pulse pulse={pulse} conflicts={conflicts} />}
      {view === "tray"         && <Tray conflicts={conflicts} onResolve={handleResolve} jurisdiction={studentJurisdiction} />}
      {view === "vault"        && <Vault conflicts={conflicts} />}
      {view === "ledger"       && <Ledger />}
      {view === "safeguarding" && <SafeguardingEscalationsCard />}
      {view === "transparency" && <TransparencyBundleCard />}
    </SurfaceShell>
  );
}

function Pulse({ pulse, conflicts }: { pulse: number; conflicts: RegulatoryConflict[] }) {
  const unresolved = conflicts.filter((c) => c.resolutionStatus === "UNRESOLVED").length;
  const direct = conflicts.filter((c) => c.conflictType === "DIRECT").length;
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <Stat icon={ShieldCheck}    label="Compliance Pulse"  value={`${pulse}/100`} caption="0-100, unresolved-criticals weighted" />
        <Stat icon={AlertTriangle}  label="Unresolved"        value={String(unresolved)} caption={`${direct} DIRECT · awaiting signature`} />
        <Stat icon={CheckCheck}     label="Jurisdictions"     value="7" caption="EU · IE · GB · US · PE · BR · IN" />
      </div>
      <div className="kl-card">
        <p
          className="font-mono mb-3"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          Verto Warrant · current attestation
        </p>
        <h3 className="font-serif text-2xl mb-3">All HIGH-severity requirements signed for IE jurisdiction.</h3>
        <p style={{ color: "var(--fg-dim)" }}>
          Last signed: yesterday by <span style={{ color: "var(--fg)" }}>Principal · St. Anne's</span>.
          Next mandatory review: <span className="font-mono">+30 days</span>.
        </p>
        <button
          className="mt-4 px-4 py-2 rounded-md text-xs font-medium"
          style={{ background: "var(--accent)", color: "#0A0E12" }}
        >
          Export Verto Warrant (PDF)
        </button>
      </div>
    </div>
  );
}

function Tray({
  conflicts, onResolve, jurisdiction,
}: { conflicts: RegulatoryConflict[]; onResolve: (c: RegulatoryConflict) => void; jurisdiction: string }) {
  const open = conflicts.filter((c) => c.resolutionStatus === "UNRESOLVED");
  if (open.length === 0) {
    return (
      <div className="kl-card text-center py-16">
        <CheckCheck size={32} style={{ color: "var(--accent)", margin: "0 auto 12px" }} />
        <p className="font-serif text-2xl">All clear.</p>
        <p style={{ color: "var(--fg-dim)" }}>No unresolved regulatory conflicts in your jurisdiction.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {open.map((c) => {
        const rec = prioritize(c, jurisdiction);
        return (
          <div key={c.id} className="kl-card" style={{ borderColor: c.conflictType === "DIRECT" ? "rgba(229, 82, 74, 0.5)" : "var(--border)" }}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <span className="kl-badge" style={{
                  background: c.conflictType === "DIRECT" ? "rgba(229, 82, 74, 0.12)" : "var(--accent-soft)",
                  color: c.conflictType === "DIRECT" ? "var(--hub-danger)" : "var(--accent)",
                }}>
                  {c.conflictType}
                </span>
                <h3 className="font-serif text-xl mt-2">
                  Conflict · {c.requirementA.documentRef} ↔ {c.requirementB.documentRef}
                </h3>
              </div>
              <button
                onClick={() => onResolve(c)}
                className="px-4 py-2 rounded-md text-xs font-medium flex items-center gap-2"
                style={{ background: "var(--accent)", color: "#0A0E12" }}
              >
                <FileSignature size={14} /> Sign &amp; Authorize
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <RequirementCard req={c.requirementA} score={rec.scoreA} winner={rec.winner?.id === c.requirementA.id} />
              <RequirementCard req={c.requirementB} score={rec.scoreB} winner={rec.winner?.id === c.requirementB.id} />
            </div>
            <div
              className="rounded-md p-3"
              style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}
            >
              <p className="font-mono mb-1" style={{ fontSize: 10, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Even Keel Learning recommendation
              </p>
              <p className="text-sm" style={{ color: "var(--fg)" }}>{rec.justification}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequirementCard({ req, score, winner }: { req: any; score: number; winner: boolean }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: "var(--bg-deep)",
        border: "1px solid",
        borderColor: winner ? "var(--accent)" : "var(--border)",
      }}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="font-mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {req.jurisdiction} · {req.severity}
        </span>
        <span className="font-mono text-xs" style={{ color: winner ? "var(--accent)" : "var(--fg-faint)" }}>
          score {score}{winner && " ✓"}
        </span>
      </div>
      <p className="text-xs font-semibold mb-1">{req.documentRef}</p>
      <p className="text-xs" style={{ color: "var(--fg-dim)" }}>{req.constraint}</p>
    </div>
  );
}

function Vault({ conflicts }: { conflicts: RegulatoryConflict[] }) {
  const resolved = conflicts.filter((c) => c.resolutionStatus !== "UNRESOLVED");
  return (
    <div className="space-y-4">
      <div className="kl-card flex items-center gap-3">
        <Archive size={18} style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--fg-dim)" }}>
          Immutable, signed archive of every resolution. Each row carries a real
          ECDSA P-256 signature you can verify in-page; export as the Verto
          Warrant for auditors.
        </p>
      </div>
      {resolved.map((c) => (
        <VaultRow key={c.id} c={c} />
      ))}
    </div>
  );
}

/**
 * Single audit-vault row. Provides a real "Verify signature" action that
 * re-derives the digest, imports the stored public key, and runs ECDSA
 * verify locally. No server is contacted.
 */
function VaultRow({ c }: { c: RegulatoryConflict }) {
  const [verifyState, setVerifyState] = useState<"idle" | "ok" | "fail" | "missing">(
    c.signatureFull ? "idle" : "missing"
  );

  const onVerify = async () => {
    if (!c.signatureFull || !c.signaturePublicKey || !c.signatureDigest || !c.signedAtIso) {
      setVerifyState("missing");
      return;
    }
    const payload = {
      conflictId: c.id,
      requirementAId: c.requirementA.id,
      requirementBId: c.requirementB.id,
      resolution: c.resolutionStatus,
      resolvedBy: c.resolvedBy,
      resolvedAt: c.resolvedAt,
      justification: c.generatedJustification,
    };
    const ok = await verifyEnvelope({
      payload,
      contentDigestB64url: c.signatureDigest,
      signatureB64url: c.signatureFull,
      publicKeyB64url: c.signaturePublicKey,
      signedAtIso: c.signedAtIso,
      algorithm: "ECDSA-P256-SHA256",
    });
    setVerifyState(ok ? "ok" : "fail");
  };

  const verifyColor =
    verifyState === "ok"
      ? "var(--accent)"
      : verifyState === "fail"
      ? "var(--hub-danger)"
      : verifyState === "missing"
      ? "var(--hub-warning)"
      : "var(--fg-faint)";

  const verifyLabel =
    verifyState === "ok"
      ? "Signature valid ✓"
      : verifyState === "fail"
      ? "Signature INVALID"
      : verifyState === "missing"
      ? "Unsigned"
      : "Verify signature";

  return (
    <div className="kl-card">
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="kl-badge">{c.resolutionStatus}</span>
          <h3 className="font-serif text-lg mt-2">
            {c.requirementA.documentRef} vs. {c.requirementB.documentRef}
          </h3>
        </div>
        <div className="text-right">
          <span className="font-mono text-xs" style={{ color: "var(--fg-faint)" }}>
            {c.signature || "—"}
          </span>
          <button
            onClick={onVerify}
            disabled={verifyState === "missing"}
            className="ml-2 px-2 py-1 rounded-md text-[10px] font-mono"
            style={{
              background: "var(--bg-deep)",
              border: "1px solid var(--border)",
              color: verifyColor,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: verifyState === "missing" ? "not-allowed" : "pointer",
            }}
          >
            <KeyRound size={10} style={{ display: "inline-block", marginRight: 4 }} />
            {verifyLabel}
          </button>
        </div>
      </div>
      <p className="text-sm mb-2" style={{ color: "var(--fg-dim)" }}>
        {c.generatedJustification || c.recommendedResolution}
      </p>
      <p className="font-mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}>
        Resolved by {c.resolvedBy} ·{" "}
        {c.resolvedAt ? new Date(c.resolvedAt).toLocaleString() : "—"}
        {c.signatureAlgorithm && (
          <>
            {" · "}
            <span style={{ color: "var(--fg-dim)" }}>{c.signatureAlgorithm}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Real Integrity Ledger. Subscribes to the cross-surface data bus and
 * formats every event into a tail line. On mount, it backfills with the
 * recent ring buffer so an officer who joins late still sees today's
 * activity. No event is ever fabricated — if no events have been published
 * yet, the tail is empty (which is honest).
 */
function Ledger() {
  const [events, setEvents] = useState<BusEvent[]>([]);

  useEffect(() => {
    setEvents(recentEvents().slice(-30).reverse());
    return subscribe((e) => setEvents((prev) => [e, ...prev].slice(0, 30)));
  }, []);

  const color = (e: BusEvent): string => {
    if (e.type === "compliance.conflict.resolved") return "var(--accent)";
    if (e.type === "student.paste.blocked") return "var(--hub-warning)";
    if (e.type.startsWith("teacher.")) return "var(--accent)";
    return "var(--fg-faint)";
  };

  const level = (e: BusEvent): string => {
    if (e.type === "compliance.conflict.resolved") return "SIGN";
    if (e.type === "student.gate.cleared") return "GATE";
    if (e.type === "student.submit") return "SUBMIT";
    if (e.type === "student.hint.requested") return "HINT";
    if (e.type === "student.paste.blocked") return "PASTE";
    if (e.type.startsWith("teacher.")) return "PUSH";
    return "EVENT";
  };

  return (
    <div className="kl-card p-0 overflow-hidden">
      <div
        className="px-4 py-3 flex justify-between items-center"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-alt)" }}
      >
        <p
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          Audit-bus live tail · {events.length} events
        </p>
        <span className="kl-badge">
          <span className="kl-pulse-dot" /> Tailing
        </span>
      </div>
      <div
        className="p-5 font-mono space-y-2"
        style={{ fontSize: 11, background: "var(--bg)" }}
      >
        {events.length === 0 ? (
          <p style={{ color: "var(--fg-faint)" }}>
            No events yet. Open <code>/student</code> in another tab and clear the
            comprehension gate, or sign a conflict in the Resolution Tray.
          </p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="kl-fade-up">
              <span style={{ color: "var(--fg-faint)" }}>
                [{new Date(e.ts).toISOString().slice(11, 19)}]
              </span>{" "}
              <span style={{ color: color(e), fontWeight: 600 }}>{level(e)}:</span>{" "}
              <span style={{ color: "var(--fg-dim)" }}>{e.source}</span>{" "}
              <span>{e.type}</span>{" "}
              <span style={{ color: "var(--fg-faint)", fontSize: 10 }}>
                {Object.entries(e.payload)
                  .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(" ")}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, caption,
}: { icon: any; label: string; value: string; caption: string }) {
  return (
    <div className="kl-card">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} style={{ color: "var(--accent)" }} />
        <p className="font-mono" style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {label}
        </p>
      </div>
      <div className="font-serif" style={{ fontSize: 32, fontWeight: 400, marginBottom: 8 }}>{value}</div>
      <p style={{ fontSize: 11, color: "var(--fg-dim)" }}>{caption}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export wraps the compliance surface in a RoleGuard. Signed audit
// data, even seed data, must not be reachable without an explicit unlock.
// See SAFEGUARDING.md §3.
// ─────────────────────────────────────────────────────────────────────────────
export default function CompliancePage() {
  return (
    <RoleGuard role="compliance" roleLabel="Compliance Officer" demoHint="officer-alpha-42">
      <CompliancePageInner />
    </RoleGuard>
  );
}
