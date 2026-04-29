"use client";

import { useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import EkeChat from "@/components/shared/EkeChat";
import { Award, Briefcase, Clock, Target } from "lucide-react";

const TRACKS = [
  { id: "data",    label: "Data Analytics",       hours: 84,  total: 120 },
  { id: "pmp",     label: "Project Management",   hours: 32,  total: 80  },
  { id: "celta",   label: "TEFL / CELTA",         hours: 12,  total: 60  },
];

export default function AdultPage() {
  const [active, setActive] = useState(TRACKS[0]);
  return (
    <SurfaceShell theme="paper" surfaceLabel="Adult Learner · Self-paced" surfaceUser="JORDAN · ADULT · IE">
      <div className="grid lg:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-4">
          <div className="kl-card">
            <p
              className="font-mono mb-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              Active certification tracks
            </p>
            <div className="space-y-2">
              {TRACKS.map((t) => {
                const pct = Math.round((t.hours / t.total) * 100);
                const isActive = t.id === active.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActive(t)}
                    className="w-full text-left p-3 rounded-lg transition"
                    style={{
                      background: isActive ? "var(--accent-soft)" : "var(--bg-deep)",
                      border: "1px solid",
                      borderColor: isActive ? "var(--accent)" : "transparent",
                    }}
                  >
                    <div className="flex justify-between text-sm">
                      <span style={{ fontWeight: 600 }}>{t.label}</span>
                      <span className="font-mono text-xs">{pct}%</span>
                    </div>
                    <div className="mt-2" style={{ height: 4, background: "var(--bg)", borderRadius: 999, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
                    </div>
                    <p className="font-mono mt-2" style={{ fontSize: 10, color: "var(--fg-faint)" }}>
                      {t.hours} / {t.total} hrs · CRT-verified
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Target size={14} style={{ color: "var(--accent)" }} />
              <p
                className="font-mono"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                This week
              </p>
            </div>
            <p className="font-serif text-2xl mb-1">8.5 hrs</p>
            <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
              Goal: 10 hrs · 4 sessions logged
            </p>
          </div>

          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Award size={14} style={{ color: "var(--accent)" }} />
              <p
                className="font-mono"
                style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                Next milestone
              </p>
            </div>
            <p className="text-sm">SQL Window Functions · 6 hrs away</p>
          </div>
        </aside>

        <section style={{ minHeight: 580 }}>
          <div className="kl-card mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-2xl">{active.label}</h2>
              <p className="text-sm mt-1" style={{ color: "var(--fg-dim)" }}>
                Peer-tone Eke · self-paced · industry-aligned exam prep
              </p>
            </div>
            <span className="kl-badge">
              <Briefcase size={10} /> Adult mode
            </span>
          </div>
          <EkeChat
            tone="peer"
            jurisdiction="IE"
            problemTitle={`${active.label} · current module`}
            problemBody="Build a query that returns the top 3 customers by revenue per region using a window function. Show your reasoning before the query."
          />
        </section>
      </div>
    </SurfaceShell>
  );
}
