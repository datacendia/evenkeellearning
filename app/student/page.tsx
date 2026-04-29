"use client";

import { useEffect, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import CurriculumPicker from "@/components/shared/CurriculumPicker";
import SubjectGrid from "@/components/shared/SubjectGrid";
import EkeChat from "@/components/shared/EkeChat";
import ComprehensionGate from "@/components/shared/ComprehensionGate";
import AgeBandGate from "@/components/shared/AgeBandGate";
import MyPatternsCard from "@/components/shared/MyPatternsCard";
import PracticeModeBar from "@/components/shared/PracticeModeBar";
import ComingBackCard from "@/components/shared/ComingBackCard";
import IssueReceiptCard from "@/components/shared/IssueReceiptCard";
import PasskeyEnrolCard from "@/components/shared/PasskeyEnrolCard";
import { CheckCircle2, Flame, Target, Trophy } from "lucide-react";
import { publish } from "@/lib/data-bus";
import { useLiveTrust } from "@/lib/hooks/useLiveTrust";

const STORAGE_KEY = "evenkeel.student.prefs";

function StudentPageInner() {
  const [curriculum, setCurriculum] = useState("ie-jc");
  const [jurisdiction, setJurisdiction] = useState("IE");
  const [subject, setSubject] = useState("maths");
  const [gateCleared, setGateCleared] = useState(false);
  // Live trust profile, fed by the cross-surface data bus from EkeChat.
  // The right-rail meters now reflect actual learner activity instead of the
  // previous fixed 72/64 values.
  const live = useLiveTrust();

  // Hydrate from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.curriculum) setCurriculum(p.curriculum);
      if (p.jurisdiction) setJurisdiction(p.jurisdiction);
      if (p.subject) setSubject(p.subject);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ curriculum, jurisdiction, subject })
    );
  }, [curriculum, jurisdiction, subject]);

  return (
    <SurfaceShell
      theme="paper"
      surfaceLabel="Student · Hinterland Workspace"
      surfaceUser="ALEX · Y10 · IE"
    >
      {/*
        The kl-student-grid class lets the focus-mode CSS rule collapse the
        three-column layout to a single column, so the chat fills the
        viewport when a learner has switched on focus mode in the
        accessibility settings panel. Side rails carry data-focus-hide so
        they disappear in focus mode without affecting their default
        rendering.
      */}
      <div className="kl-student-grid grid lg:grid-cols-[260px_1fr_320px] gap-6">
        {/* left rail */}
        <aside
          className="kl-card"
          aria-label="Curriculum and subject"
          data-focus-hide="true"
          style={{ position: "sticky", top: 110, height: "fit-content" }}
        >
          <CurriculumPicker
            value={curriculum}
            onChange={(id, j) => {
              setCurriculum(id);
              setJurisdiction(j);
            }}
          />
          <div style={{ height: 24 }} />
          <SubjectGrid value={subject} onChange={setSubject} />
        </aside>

        {/* center: Eke chat */}
        <section style={{ minHeight: 580 }}>
          <PracticeModeBar />
          <EkeChat
            tone="mentor"
            jurisdiction={jurisdiction}
            studentAgeBand="Y10"
            problemTitle={`${subject.toUpperCase()} · today's problem`}
            problemBody="Solve for x:  2x + 5 = 17.  Show your reasoning, not just the answer."
            // Pin the demo answer so the v1.4.0 deterministic checker is live
            // on this surface. Documented in PROPOSAL_TRUTH_PACK.md §D so the
            // cofounder demo path ("type x = 6 …") is reproducible.
            problemAnswer={6}
            // v1.4.4 — opt the demo problem into the spacing scheduler. The
            // id is opaque, hard-coded, and never combined with learner text
            // or with the expected value. See lib/eke/scheduler.ts privacy
            // contract.
            problemId="ie-jc-maths-linear-eq-001"
            // v1.4.5 — declare the skill family so the engine can serve a
            // tier-4 hint (a fully-worked parallel problem) after tiers 1-3
            // are exhausted. The leak guard rejects any parallel whose
            // worked solution would echo this problem's expected value.
            skillFamily="linear-eq-1var"
          />

          {/* Comprehension Gate. The learner cannot mark the problem complete
              without proving understanding through three reasoning questions.
              Clearing the gate fires both a local state update (which lights
              up the goal in the right rail) and a bus event so a parent or
              teacher tab can react in real time. */}
          <div style={{ height: 24 }} />
          <ComprehensionGate
            subject={subject}
            onCleared={() => {
              setGateCleared(true);
              publish(
                "student.gate.cleared",
                { subject, jurisdiction, curriculum },
                "student"
              );
            }}
          />
        </section>

        {/* right rail — hidden in focus mode (rail meters and goal cards
            disappear so a learner with ADHD or processing-speed differences
            can concentrate on a single problem) */}
        <aside
          className="space-y-4"
          aria-label="Cognitive effort and goals"
          data-focus-hide="true"
        >
          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Flame size={16} style={{ color: "var(--accent)" }} />
              <h3 className="text-sm font-semibold">Cognitive Effort</h3>
            </div>
            <Meter label="Focus" value={live.focus} />
            <div style={{ height: 12 }} />
            <Meter label="Resilience" value={live.resilience} />
            <p
              className="font-mono mt-3"
              style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.05em" }}
            >
              Live · {live.eventsSeen} events seen this session
            </p>
          </div>

          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Target size={16} style={{ color: "var(--accent)" }} />
              <h3 className="text-sm font-semibold">Today's Goals</h3>
            </div>
            <ul className="space-y-2 text-sm">
              <Goal text="Clear comprehension gate (linear eqs)" done={gateCleared} />
              <Goal text="3 problems with hint tier ≤ 2" />
              <Goal text="Reflect: where did you pivot?" />
            </ul>
          </div>

          <ComingBackCard
            titles={{
              "ie-jc-maths-linear-eq-001": "Linear equation (2x + 5 = 17)",
            }}
          />

          <PasskeyEnrolCard />

          <IssueReceiptCard
            problemId="ie-jc-maths-linear-eq-001"
            problemTitle={`${subject.toUpperCase()} · today's problem`}
            skillFamily="linear-eq-1var"
            jurisdiction={jurisdiction}
            learnerInitials="ALEX · Y10"
          />

          <MyPatternsCard />

          <div className="kl-card">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} style={{ color: "var(--accent)" }} />
              <h3 className="text-sm font-semibold">CRT Streak</h3>
            </div>
            <p className="font-serif text-3xl">14 days</p>
            <p className="text-sm" style={{ color: "var(--fg-dim)" }}>
              Verified mastery sessions in a row.
            </p>
          </div>
        </aside>
      </div>
    </SurfaceShell>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span style={{ color: "var(--fg-dim)" }}>{label}</span>
        <span className="font-mono" style={{ color: "var(--fg)" }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: "var(--bg-deep)", borderRadius: 999, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${value}%`,
            background: "var(--accent)",
            transition: "width .6s ease",
          }}
        />
      </div>
    </div>
  );
}

function Goal({ text, done }: { text: string; done?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2
        size={14}
        style={{ color: done ? "var(--accent)" : "var(--fg-faint)", marginTop: 2, flexShrink: 0 }}
      />
      <span style={{ color: done ? "var(--fg-dim)" : "var(--fg)", textDecoration: done ? "line-through" : "none" }}>
        {text}
      </span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export wraps the student surface in an AgeBandGate. The first
// time a learner visits, they self-declare their age band; under-13 users
// must also tick a guardian-acknowledgement box. The result is stored in
// localStorage. This is NOT verified-age authentication — see
// SAFEGUARDING.md §4 for the COPPA Phase 2 plan.
// ─────────────────────────────────────────────────────────────────────────────
export default function StudentPage() {
  return (
    <AgeBandGate>
      <StudentPageInner />
    </AgeBandGate>
  );
}
