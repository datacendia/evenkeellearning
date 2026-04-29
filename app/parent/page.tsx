"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/parent/page.tsx
//
// Parent-facing surface ("Shadow Feed"). Mostly seeded content for now, plus
// a real live "Just now" strip at the top of the feed that subscribes to the
// cross-surface data bus. Open `/student` in another tab and clear the
// comprehension gate — a card will appear here within ~one frame.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import { Heart, Coffee, Compass, ShieldHalf, Clock, Trash2, Bell, Activity } from "lucide-react";
import { subscribe, recentEvents, BusEvent } from "@/lib/data-bus";

const NAV = [
  { id: "feed",    label: "Shadow Feed" },
  { id: "prompts", label: "Dinner Table Prompts" },
  { id: "dna",     label: "Career DNA" },
  { id: "safety",  label: "Safety Centre" },
];

export default function ParentPage() {
  const [view, setView] = useState("feed");
  return (
    <SurfaceShell
      theme="paper"
      surfaceLabel="Parent · Translator"
      surfaceUser="ALEX'S PARENT"
      navItems={NAV}
      activeId={view}
      onNavChange={setView}
    >
      {view === "feed"    && <ShadowFeed />}
      {view === "prompts" && <Prompts />}
      {view === "dna"     && <CareerDNA />}
      {view === "safety"  && <SafetyCentre />}
    </SurfaceShell>
  );
}

function ShadowFeed() {
  // Live events from the cross-surface bus. Hydrated once with `recentEvents()`
  // so a parent who opens this tab *after* the student already did something
  // sees the recent history; updated thereafter by `subscribe`.
  const [live, setLive] = useState<BusEvent[]>([]);

  useEffect(() => {
    setLive(recentEvents().filter((e) => e.source === "student").slice(-6).reverse());
    return subscribe((e) => {
      if (e.source !== "student") return;
      setLive((prev) => [e, ...prev].slice(0, 8));
    });
  }, []);

  const items = [
    { time: "Today 4:15 PM",  effort: 78, mastery: "Linear equations", note: "Cleared comprehension gate without a hint." },
    { time: "Today 3:48 PM",  effort: 62, mastery: "Polynomial factoring", note: "Tier-2 hint used. Worked through a friction wall." },
    { time: "Yesterday",      effort: 84, mastery: "Reading comprehension", note: "Excellent reasoning trace. Honors prompt suggested." },
  ];
  return (
    <div className="space-y-6">
      {/* Live feed strip. Hidden until at least one event is available. */}
      {live.length > 0 && (
        <div className="kl-card" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} style={{ color: "var(--accent)" }} />
            <p
              className="font-mono"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Just now · live from Alex's session
            </p>
            <span className="kl-badge"><span className="kl-pulse-dot" /> Live</span>
          </div>
          <ul className="space-y-2 text-sm">
            {live.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <span style={{ color: "var(--accent)", marginTop: 2 }}>•</span>
                <div className="flex-1">
                  <span style={{ fontWeight: 600 }}>{prettyEventLabel(e)}</span>
                  <span className="font-mono ml-2" style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                    {timeSince(e.ts)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="kl-card">
        <p
          className="font-mono mb-2"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          This week at a glance
        </p>
        <h2 className="font-serif text-3xl mb-4">Alex's curiosity is up. Effort steady.</h2>
        <div className="grid grid-cols-3 gap-4 mt-2">
          <Tile label="Avg effort" value="74%" delta="+6%" />
          <Tile label="Streak" value="14 days" delta="" />
          <Tile label="Hint tier 3 used" value="2×" delta="−1×" />
        </div>
      </div>

      <div className="kl-card">
        <p
          className="font-mono mb-4"
          style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
        >
          Recent sessions (no answers shown)
        </p>
        <ul className="space-y-3">
          {items.map((i) => (
            <li
              key={i.time}
              className="flex items-start gap-4 p-3 rounded-lg"
              style={{ background: "var(--bg-deep)" }}
            >
              <Heart size={16} style={{ color: "var(--accent)", marginTop: 2 }} />
              <div className="flex-1">
                <div className="flex justify-between text-sm">
                  <span style={{ fontWeight: 600 }}>{i.mastery}</span>
                  <span className="font-mono" style={{ color: "var(--fg-faint)", fontSize: 11 }}>
                    {i.time}
                  </span>
                </div>
                <p className="text-sm mt-1" style={{ color: "var(--fg-dim)" }}>{i.note}</p>
                <div className="mt-2 flex items-center gap-2">
                  <div style={{ flex: 1, height: 4, background: "var(--bg)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${i.effort}%`, height: "100%", background: "var(--accent)" }} />
                  </div>
                  <span className="font-mono text-xs">{i.effort}%</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p
        className="font-mono text-center"
        style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em" }}
      >
        Privacy: Alex's specific answers are never shown. Only effort and mastery signals.
      </p>
    </div>
  );
}

/** Human-readable label for a bus event in the parent-facing feed. */
function prettyEventLabel(e: BusEvent): string {
  switch (e.type) {
    case "student.gate.cleared":
      return `Cleared comprehension gate (${(e.payload as any).subject ?? "subject"})`;
    case "student.hint.requested":
      return `Asked Eke for a Tier-${(e.payload as any).tier ?? "?"} hint`;
    case "student.paste.blocked":
      return "Paste attempt blocked by zero-paste";
    case "student.submit":
      return `Submitted reasoning · trust ${(e.payload as any).trust ?? "?"}%`;
    case "student.problem.started":
      return "Started a new problem";
    case "student.crt.signed":
      return "CRT cryptographically signed";
    case "teacher.logic_bridge.pushed":
      return "Teacher pushed a Logic Bridge";
    case "teacher.honors.pushed":
      return "Teacher pushed an honors prompt";
    default:
      return e.type;
  }
}

/** Lightweight relative-time formatter; never formats absolutes. */
function timeSince(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function Prompts() {
  const prompts = [
    { ctx: "Polynomial breakthrough today", q: "Ask Alex: 'What was the moment today when you finally saw how the negative sign worked?'" },
    { ctx: "Reading comprehension flow",    q: "Ask Alex: 'If you had to teach me what you learned, where would you start?'" },
    { ctx: "Resilience milestone",          q: "Acknowledge: 'I noticed you stuck with something hard yesterday. What did you tell yourself to keep going?'" },
  ];
  return (
    <div className="space-y-4">
      <div className="kl-card flex items-center gap-3">
        <Coffee size={18} style={{ color: "var(--accent)" }} />
        <p style={{ fontSize: 14, color: "var(--fg-dim)" }}>
          Conversation starters generated from Alex's recent breakthroughs. No technical jargon, no answer reveals.
        </p>
      </div>
      {prompts.map((p, i) => (
        <div key={i} className="kl-card">
          <p
            className="font-mono mb-2"
            style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            Context · {p.ctx}
          </p>
          <p className="font-serif text-xl" style={{ color: "var(--fg)" }}>{p.q}</p>
        </div>
      ))}
    </div>
  );
}

function CareerDNA() {
  const traits = [
    { name: "Analytical",        score: 78, trend: "+5", evidence: "12 sessions with systematic decomposition" },
    { name: "Resilience",        score: 84, trend: "+8", evidence: "Recovery time down 2.1s avg" },
    { name: "Creative entropy",  score: 62, trend: "+3", evidence: "3 novel pivots in physics this week" },
    { name: "Collaboration",     score: 58, trend: "—",  evidence: "Strategic hint use; balanced help-seeking" },
    { name: "Adaptability",      score: 71, trend: "+4", evidence: "Successful approach changes after deletion bursts" },
  ];
  const universities = [
    { inst: "Trinity College Dublin", match: 87, programs: ["Computer Science", "Mathematics"] },
    { inst: "University of Edinburgh", match: 81, programs: ["Engineering", "Informatics"] },
  ];
  const trades = [
    { co: "Siemens",  app: "Quantum Systems Apprenticeship", match: 79 },
    { co: "Tesla",    app: "Battery Technology Apprenticeship", match: 74 },
  ];
  return (
    <div className="space-y-6">
      <div className="kl-card">
        <div className="flex items-center gap-2 mb-3">
          <Compass size={16} style={{ color: "var(--accent)" }} />
          <p
            className="font-mono"
            style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            DNA Trait Matrix
          </p>
        </div>
        <div className="space-y-3">
          {traits.map((t) => (
            <div key={t.name}>
              <div className="flex justify-between text-sm mb-1">
                <span>{t.name} <span className="font-mono text-xs" style={{ color: "var(--fg-faint)" }}>· {t.evidence}</span></span>
                <span className="font-mono">{t.score}% <span style={{ color: "var(--accent)" }}>{t.trend}</span></span>
              </div>
              <div style={{ height: 6, background: "var(--bg-deep)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${t.score}%`, height: "100%", background: "var(--accent)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="kl-card">
          <h3 className="font-serif text-xl mb-3">University pathways</h3>
          {universities.map((u) => (
            <div key={u.inst} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex justify-between items-center">
                <span style={{ fontWeight: 600 }}>{u.inst}</span>
                <span className="kl-badge">{u.match}% match</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--fg-dim)" }}>{u.programs.join(" · ")}</p>
            </div>
          ))}
        </div>
        <div className="kl-card">
          <h3 className="font-serif text-xl mb-3">Vocational pathways</h3>
          {trades.map((t) => (
            <div key={t.co} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex justify-between items-center">
                <span style={{ fontWeight: 600 }}>{t.co}</span>
                <span className="kl-badge">{t.match}% match</span>
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--fg-dim)" }}>{t.app}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SafetyCentre() {
  return (
    <div className="space-y-4">
      <div className="kl-card flex items-center gap-3">
        <ShieldHalf size={20} style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--fg-dim)" }}>
          Full parental controls. Even Keel Learning collects no biometrics, shows no advertising, and never sells data.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Toggle icon={Clock} label="Daily screen-time cap" value="60 min" />
        <Toggle icon={Clock} label="Bedtime mode" value="21:00 → 07:00" />
        <Toggle icon={Bell} label="Crisis notifications" value="Push + SMS" />
        <Toggle icon={Heart} label="Eke tone" value="Mentor (age 11–14)" />
      </div>
      <div
        className="kl-card flex items-center justify-between"
        style={{ borderColor: "rgba(197, 48, 48, 0.4)" }}
      >
        <div className="flex items-center gap-3">
          <Trash2 size={18} style={{ color: "var(--red)" }} />
          <div>
            <p style={{ fontWeight: 600 }}>Right to erasure (GDPR Art. 17)</p>
            <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
              Permanently delete all of Alex's CRTs, traces, and Career DNA. Cannot be undone.
            </p>
          </div>
        </div>
        <button
          className="px-4 py-2 rounded-md text-sm"
          style={{ background: "rgba(197, 48, 48, 0.1)", color: "var(--red)", border: "1px solid var(--red)" }}
        >
          Request deletion
        </button>
      </div>
    </div>
  );
}

function Tile({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div style={{ padding: "12px 14px", background: "var(--bg-deep)", borderRadius: 10 }}>
      <p
        className="font-mono"
        style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        {label}
      </p>
      <p className="font-serif" style={{ fontSize: 24, marginTop: 2 }}>
        {value} {delta && <span className="text-xs font-mono" style={{ color: "var(--accent)" }}>{delta}</span>}
      </p>
    </div>
  );
}

function Toggle({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="kl-card flex items-center gap-3">
      <Icon size={18} style={{ color: "var(--accent)" }} />
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs font-mono" style={{ color: "var(--fg-faint)" }}>{value}</p>
      </div>
      <button className="text-xs px-3 py-1.5 rounded" style={{ background: "var(--bg-deep)", border: "1px solid var(--border)" }}>
        Edit
      </button>
    </div>
  );
}
