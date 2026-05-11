"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/teacher/page.tsx
//
// "Sovereign OS" surface for teachers. Hosts a morning briefing tile, a
// Box-in-Box cognitive node viewer with sample CRT JSON, and an integrity
// ledger. Mostly seeded data; the push-action buttons fire real bus events
// so a parent or student tab can react to the teacher's interventions.
// See HONESTY.md §2.2 for the reality status.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import BoxInBoxNode from "@/components/shared/BoxInBoxNode";
import JsonViewer from "@/components/shared/JsonViewer";
import RoleGuard from "@/components/shared/RoleGuard";
import { TrendingUp, AlertTriangle, ShieldCheck, Activity } from "lucide-react";
import { publish, subscribe, recentEvents, BusEvent } from "@/lib/data-bus";

const NAV = [
  { id: "briefing", label: "Morning Briefing" },
  { id: "nodes",    label: "Cognitive Nodes" },
  { id: "ledger",   label: "Integrity Ledger" },
];

const NODES = [
  {
    initials: "LS",
    title: "Leo Silva",
    meta: "ID: 884-XQ · Physics",
    status: "verified" as const,
    crt: {
      crt_version: "1.2",
      session_id: "phys_vec_09",
      student_id_hash: "0xa1b2c3…",
      jurisdiction: "IE",
      behavioral_signals: { latency_ms: 4120, paste_events: false, revision_count: 3 },
      pedagogical_event: { type: "comprehension_gate_cleared", hint_level_used: 0 },
      state: "verified_mastery",
      cryptography: { algorithm: "Ed25519", signature: "e3b0c44298fc1c149afbf4c8996fb924…" },
    },
  },
  {
    initials: "MK",
    title: "Maria K.",
    meta: "ID: 412-PR · Algebra",
    status: "friction" as const,
    crt: {
      crt_version: "1.2",
      session_id: "alg_poly_14",
      student_id_hash: "0xd4e5f6…",
      jurisdiction: "IE",
      behavioral_signals: { struggle_duration_s: 142, deletion_count: 24, idle_time_s: 45 },
      pedagogical_event: { type: "productive_friction_detected", action_taken: "deployed_hint_level_2" },
      state: "unresolved_pending_input",
    },
  },
  {
    initials: "JD",
    title: "Jamie D.",
    meta: "ID: 207-MN · English",
    status: "anomaly" as const,
    crt: {
      crt_version: "1.2",
      session_id: "eng_essay_03",
      student_id_hash: "0xff0011…",
      jurisdiction: "IE",
      behavioral_signals: { latency_ms: 38, paste_events: true, revision_count: 0 },
      pedagogical_event: { type: "mimicry_suspected", action_taken: "trace_rejected" },
      state: "anomaly_flagged",
    },
  },
];

function TeacherPageInner() {
  const [view, setView] = useState("nodes");

  return (
    <SurfaceShell
      theme="sovereign"
      surfaceLabel="Teacher · Sovereign OS"
      surfaceUser="MS. RYAN · 4Y · MATHS+ENG"
      navItems={NAV}
      activeId={view}
      onNavChange={setView}
      rightSlot={
        <span
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}
        >
          NODES <span style={{ color: "var(--fg)" }}>24</span> · ANOMALIES{" "}
          <span style={{ color: "var(--hub-danger)" }}>1</span>
        </span>
      }
    >
      {view === "briefing" && <Briefing />}
      {view === "nodes" && <Nodes />}
      {view === "ledger" && <Ledger />}
    </SurfaceShell>
  );
}

function Briefing() {
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        <Stat icon={TrendingUp} label="Resilience Delta" value="+12.4%" caption="Avg recovery time improved 2.1s" />
        <Stat icon={ShieldCheck} label="Integrity Pulse" value="99.8%"  caption="1 mimicry attempt blocked" />
        <Stat icon={Activity}    label="Cognitive Friction" value="Low"  caption="Curriculum Neutrality Shield active" />
      </div>
      <div className="kl-card">
        <p
          className="font-mono mb-4"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          Suggested warm-up · 7:00 AM Briefing
        </p>
        <h3 className="font-serif text-2xl mb-2">Polynomial factoring (–4 distribution)</h3>
        <p style={{ color: "var(--fg-dim)" }}>
          5 students hit a friction wall on negative distribution yesterday. Eke recommends starting today's
          class with a 3-minute Logic Bridge video before the worksheet.
        </p>
        <button
          onClick={() =>
            publish(
              "teacher.logic_bridge.pushed",
              { topic: "Polynomial factoring (−4 distribution)" },
              "teacher"
            )
          }
          className="mt-4 px-4 py-2 rounded-md text-xs font-medium"
          style={{ background: "var(--accent)", color: "#0A0E12" }}
        >
          Push Logic Bridge to class
        </button>
      </div>
    </div>
  );
}

function Nodes() {
  return (
    <div className="space-y-4">
      <p
        className="font-mono"
        style={{ fontSize: 11, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        Click a node to inspect its cryptographic reasoning trace.
      </p>
      {NODES.map((n) => (
        <BoxInBoxNode
          key={n.title}
          initials={n.initials}
          title={n.title}
          meta={n.meta}
          status={n.status}
        >
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <p
                className="font-mono mb-3"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                Socratic intercept
              </p>
              <div
                className="rounded-md p-4 space-y-3"
                style={{ background: "var(--bg-deep)", border: "1px solid var(--border)" }}
              >
                {n.status === "verified" && (
                  <Bubble who="Ke" tone="accent">
                    Before calculating, what happens to the velocity vector when mass doubles?
                  </Bubble>
                )}
                {n.status === "verified" && (
                  <Bubble who="L" tone="learner">
                    It decreases proportionally, based on momentum conservation.
                  </Bubble>
                )}
                {n.status === "friction" && (
                  <>
                    <Bubble who="M" tone="learner">I don&apos;t understand how to factor out the negative sign here.</Bubble>
                    <Bubble who="Ke" tone="amber">
                      Look at the −4 outside the parenthesis. If we distribute it, what happens to the +2x inside?
                    </Bubble>
                  </>
                )}
                {n.status === "anomaly" && (
                  <Bubble who="Ke" tone="rose">
                    Latency &lt; 0.1s with paste events &gt; 0. Eke halted the response and requested paraphrase.
                  </Bubble>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    if (n.status === "verified") {
                      publish("teacher.honors.pushed", { studentInitials: n.initials }, "teacher");
                    } else if (n.status === "friction") {
                      publish("teacher.logic_bridge.pushed", { studentInitials: n.initials }, "teacher");
                    }
                    // For "anomaly" we currently no-op; opening an audit
                    // playback view is a future feature (see HONESTY.md §4.2).
                  }}
                  className="px-3 py-1.5 rounded-md text-[10px] uppercase tracking-wider"
                  style={{
                    background: "var(--bg-alt)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                  }}
                >
                  {n.status === "verified" ? "Push honors prompt"
                    : n.status === "friction" ? "Push Logic Bridge"
                    : "Open audit playback"}
                </button>
              </div>
            </div>
            <div className="flex flex-col">
              <p
                className="font-mono mb-3 flex justify-between"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                <span>Cryptographic Trace (JSON)</span>
                <span style={{ color: n.status === "anomaly" ? "var(--hub-danger)" : "var(--accent)" }}>
                  {n.status === "anomaly" ? "Trace Rejected" : "Signature Validated ✓"}
                </span>
              </p>
              <JsonViewer value={n.crt} maxHeight={260} />
            </div>
          </div>
        </BoxInBoxNode>
      ))}
    </div>
  );
}

/**
 * Returns true iff a bus event is part of a private-practice session and
 * should NOT be shown step-by-step in the Teacher Integrity Ledger. The
 * `student.practice.session` brackets themselves are NOT filtered — they
 * are the only practice signal the teacher gets, and they tell the teacher
 * *whether* practice happened (never *what* went wrong in it). v1.4.3.
 */
function isFilteredPracticeDetail(e: BusEvent): boolean {
  if (e.type === "student.practice.session") return false;
  const payload = e.payload as { practiceMode?: unknown };
  return payload.practiceMode === true;
}

function Ledger() {
  const [events, setEvents] = useState<BusEvent[]>([]);

  useEffect(() => {
    setEvents(
      recentEvents()
        .filter((e) => !isFilteredPracticeDetail(e))
        .slice(-30)
        .reverse(),
    );
    return subscribe((e) => {
      if (isFilteredPracticeDetail(e)) return;
      setEvents((prev) => [e, ...prev].slice(0, 30));
    });
  }, []);

  const level = (e: BusEvent): "info" | "ok" | "warn" | "danger" => {
    if (e.type === "compliance.conflict.resolved") return "ok";
    if (e.type === "student.gate.cleared") return "ok";
    if (e.type === "student.paste.blocked") return "warn";
    if (e.type === "student.practice.session") return "info";
    if (e.type === "student.submit") {
      const trust = (e.payload as { trust?: number }).trust ?? 100;
      if (trust < 40) return "danger";
      if (trust < 70) return "warn";
      return "info";
    }
    return "info";
  };

  const color = (lvl: ReturnType<typeof level>) =>
    lvl === "ok"     ? "var(--accent)"
    : lvl === "warn"   ? "var(--hub-warning)"
    : lvl === "danger" ? "var(--hub-danger)"
    : "var(--fg-faint)";

  const message = (e: BusEvent): string => {
    switch (e.type) {
      case "student.gate.cleared":
        return `GATE_CLEARED — ${(e.payload as any).subject ?? "?"} (${(e.payload as any).jurisdiction ?? "?"})`;
      case "student.submit":
        return `SUBMIT — chars=${(e.payload as any).chars ?? "?"} trust=${(e.payload as any).trust ?? "?"}`;
      case "student.hint.requested":
        return `HINT — tier=${(e.payload as any).tier ?? "?"}`;
      case "student.answer.validated":
        return `ANSWER — ${(e.payload as any).correct ? "correct" : (e.payload as any).category ?? "?"}`;
      case "student.paste.blocked":
        return `PASTE — blocked by zero-paste policy`;
      case "student.practice.session": {
        const p = e.payload as { active?: boolean; durationMs?: number };
        if (p.active) return `PRACTICE — private session started`;
        const mins = Math.max(1, Math.round((p.durationMs ?? 0) / 60000));
        return `PRACTICE — private session ended (${mins} min)`;
      }
      case "compliance.conflict.resolved":
        return `SIGN — ${(e.payload as any).conflictId} by ${(e.payload as any).resolvedBy}`;
      case "teacher.logic_bridge.pushed":
        return `PUSH — Logic Bridge to ${(e.payload as any).studentInitials ?? "class"}`;
      case "teacher.honors.pushed":
        return `PUSH — Honors prompt to ${(e.payload as any).studentInitials ?? "class"}`;
      case "roster.import.committed": {
        const p = e.payload as { imported?: number; skipped?: number; under13Count?: number };
        return `ROSTER — imported ${p.imported ?? "?"}, skipped ${p.skipped ?? 0}, under-13 ${p.under13Count ?? 0}`;
      }
      default:
        return e.type;
    }
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
          Immutable Event Log · {events.length} events
        </p>
        <span className="kl-badge"><span className="kl-pulse-dot" /> Tailing</span>
      </div>
      <div
        className="p-5 font-mono space-y-2"
        style={{ fontSize: 11, background: "var(--bg)", color: "var(--fg)" }}
      >
        {events.length === 0 ? (
          <p style={{ color: "var(--fg-faint)" }}>
            No events yet. Activity from <code>/student</code> and{" "}
            <code>/compliance</code> tabs will tail here in real time.
          </p>
        ) : (
          events.map((e) => {
            const lvl = level(e);
            return (
              <div key={e.id} className="kl-fade-up">
                <span style={{ color: "var(--fg-faint)" }}>
                  [{new Date(e.ts).toISOString().slice(11, 19)}]
                </span>{" "}
                <span style={{ color: color(lvl), fontWeight: 600 }}>
                  {lvl.toUpperCase()}:
                </span>{" "}
                <span>{message(e)}</span>
              </div>
            );
          })
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
        <p
          className="font-mono"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          {label}
        </p>
      </div>
      <div className="font-serif" style={{ fontSize: 32, fontWeight: 400, marginBottom: 8 }}>{value}</div>
      <p style={{ fontSize: 11, color: "var(--fg-dim)" }}>{caption}</p>
    </div>
  );
}

function Bubble({
  who, tone, children,
}: { who: string; tone: "accent" | "amber" | "rose" | "learner"; children: React.ReactNode }) {
  const isLearner = tone === "learner";
  const bg =
    tone === "accent" ? "var(--accent-soft)"
    : tone === "amber" ? "rgba(245, 166, 35, 0.12)"
    : tone === "rose"  ? "rgba(229, 82, 74, 0.12)"
    : "var(--bg-alt)";
  const fg =
    tone === "accent" ? "var(--accent)"
    : tone === "amber" ? "var(--hub-warning)"
    : tone === "rose"  ? "var(--hub-danger)"
    : "var(--fg)";
  return (
    <div className={`flex gap-2 ${isLearner ? "flex-row-reverse" : ""}`}>
      <div
        className="w-6 h-6 rounded shrink-0 flex items-center justify-center text-[11px] font-bold"
        style={{ background: bg, color: fg }}
      >
        {who}
      </div>
      <p
        className="text-xs rounded px-2 py-1.5 max-w-[85%]"
        style={{
          background: bg,
          border: "1px solid",
          borderColor: bg,
          color: tone === "learner" ? "var(--fg)" : fg,
        }}
      >
        {children}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export wraps the inner page in a RoleGuard. The teacher surface
// must not be reachable just by clicking "Teacher" on the landing page; in
// the demo this is enforced by a passphrase, in production by WebAuthn.
// See SAFEGUARDING.md §3 and lib/auth/role-guard.ts.
// ─────────────────────────────────────────────────────────────────────────────
export default function TeacherPage() {
  return (
    <RoleGuard role="teacher" roleLabel="Teacher" demoHint="mentor-alpha-42">
      <TeacherPageInner />
    </RoleGuard>
  );
}
