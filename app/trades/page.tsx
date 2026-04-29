"use client";

import { useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import EkeChat from "@/components/shared/EkeChat";
import { Mic, Camera, Hammer, Gauge, Wrench, Plug, Droplet, Zap } from "lucide-react";
// Hammer is used inside the Skill Forge card below.

const TRADES = [
  { id: "weld",    label: "Welding",    icon: Zap },
  { id: "elec",    label: "Electrical", icon: Plug },
  { id: "plumb",   label: "Plumbing",   icon: Droplet },
  { id: "mech",    label: "Mechanics",  icon: Wrench },
];

const SKILLS = [
  { name: "MIG Welding — flat",      level: 4, of: 5 },
  { name: "MIG Welding — vertical",  level: 2, of: 5 },
  { name: "TIG Welding — aluminum",  level: 1, of: 5 },
  { name: "Reading WPS",             level: 3, of: 5 },
  { name: "Joint prep & fit-up",     level: 4, of: 5 },
  { name: "Visual inspection",       level: 3, of: 5 },
];

export default function TradesPage() {
  const [trade, setTrade] = useState(TRADES[0]);
  return (
    <SurfaceShell
      theme="paper"
      surfaceLabel="Apprentice · Hands-on Log"
      surfaceUser="DECLAN · YEAR 2 · WELDING"
    >
      <div className="grid lg:grid-cols-[260px_1fr_300px] gap-6">
        <aside className="space-y-4">
          <div className="kl-card">
            <p
              className="font-mono mb-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Trade
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TRADES.map((t) => {
                const Icon = t.icon;
                const isActive = t.id === trade.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTrade(t)}
                    className="p-3 rounded-lg flex flex-col items-center gap-1 transition"
                    style={{
                      background: isActive ? "var(--accent-soft)" : "var(--bg-deep)",
                      border: "1px solid",
                      borderColor: isActive ? "var(--accent)" : "transparent",
                      color: isActive ? "var(--accent-ink, var(--accent))" : "var(--fg)",
                    }}
                  >
                    <Icon size={20} />
                    <span className="text-xs">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Hammer size={14} style={{ color: "var(--accent)" }} />
              <p
                className="font-mono"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                Hands-on log · today
              </p>
            </div>
            <button
              className="w-full px-4 py-3 rounded-lg flex items-center gap-3 mb-2"
              style={{ background: "var(--accent)", color: "var(--paper)" }}
            >
              <Mic size={16} />
              <span className="text-sm">Voice-log this weld</span>
            </button>
            <button
              className="w-full px-4 py-3 rounded-lg flex items-center gap-3"
              style={{ background: "var(--bg-deep)", color: "var(--fg)", border: "1px solid var(--border)" }}
            >
              <Camera size={16} />
              <span className="text-sm">Photo-log a bead</span>
            </button>
          </div>

          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Gauge size={14} style={{ color: "var(--accent)" }} />
              <p
                className="font-mono"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                Skill forge
              </p>
            </div>
            <div className="space-y-2">
              {SKILLS.map((s) => (
                <div key={s.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{s.name}</span>
                    <span className="font-mono">{s.level}/{s.of}</span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg-deep)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${(s.level / s.of) * 100}%`, height: "100%", background: "var(--accent)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section style={{ minHeight: 580 }}>
          <div className="kl-card mb-4">
            <p
              className="font-mono mb-2"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Today's job · {trade.label}
            </p>
            <h2 className="font-serif text-2xl mb-2">3F vertical-up MIG fillet on 6mm mild steel</h2>
            <p style={{ color: "var(--fg-dim)" }}>
              Work the joint. Eke stays on plumb — won't tell you the answer, will help you check yours.
            </p>
          </div>
          <EkeChat
            tone="foreman"
            jurisdiction="IE"
            problemTitle="Pre-job check"
            problemBody="Before you strike an arc: walk through your settings (V, WFS, gas) and your joint prep. What's your first check?"
          />
        </section>

        <aside className="space-y-4">
          <div className="kl-card">
            <p
              className="font-mono mb-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Employer view
            </p>
            <p className="text-sm" style={{ fontWeight: 600 }}>Murphy Engineering Ltd.</p>
            <p className="text-xs mt-1" style={{ color: "var(--fg-dim)" }}>
              Daily summary auto-shared with your supervisor. CRT-signed competency log.
            </p>
          </div>
          <div className="kl-card">
            <p
              className="font-mono mb-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Pathways
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                <span>SOLAS Phase 4</span>
                <span className="kl-badge">86%</span>
              </li>
              <li className="flex justify-between">
                <span>City &amp; Guilds 3268</span>
                <span className="kl-badge">72%</span>
              </li>
              <li className="flex justify-between">
                <span>Siemens Apprenticeship</span>
                <span className="kl-badge">79%</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </SurfaceShell>
  );
}
