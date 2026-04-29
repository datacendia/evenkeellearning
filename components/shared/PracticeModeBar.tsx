"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/PracticeModeBar.tsx
//
// The toggle and active-state banner for v1.4.3 private practice mode.
// Mounted above EkeChat on /student.
//
// What this component is for
// ──────────────────────────
//   • A learner can opt in to a low-stakes practice run during which
//     per-event activity does not surface in the Teacher Integrity
//     Ledger. The teacher sees only the bracketing
//     `student.practice.session` events — start and end — and never the
//     per-event detail.
//   • The active-state banner spells the contract out in plain English so
//     the learner can read what is and isn't shared before they start.
//   • Toggling on emits `student.practice.session { active: true, ... }`;
//     toggling off emits `{ active: false, durationMs, ... }`. These are
//     the only practice-related events the teacher's view shows.
//
// What this component is NOT
// ──────────────────────────
//   • A safeguarding bypass. Crisis-detection (decision-gate.ts) runs the
//     same way regardless of practice mode. If a learner trips the crisis
//     lexicon during practice, the safeguarding path still fires.
//   • A privacy boundary against a determined teacher in the same
//     browser. localStorage is shared across same-origin tabs; a teacher
//     using DevTools on the same device could in principle inspect the
//     bus log. The practice contract is enforced at the consumer (the
//     Teacher Ledger filters), which is a credible Phase-1 contract for
//     the demo prototype but not a security boundary. Phase 2 fix: per-
//     role transports. See HONESTY.md.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { ShieldOff, Lock } from "lucide-react";
import { publish } from "@/lib/data-bus";
import {
  endPracticeSession,
  getPracticeState,
  startPracticeSession,
  subscribePracticeMode,
  type PracticeState,
} from "@/lib/eke/practice-mode";

export default function PracticeModeBar() {
  const [state, setState] = useState<PracticeState>({ active: false });

  useEffect(() => {
    setState(getPracticeState());
    return subscribePracticeMode(setState);
  }, []);

  const enable = () => {
    const sessionId = startPracticeSession();
    publish(
      "student.practice.session",
      { active: true, sessionId },
      "student",
    );
  };

  const disable = () => {
    const closed = endPracticeSession();
    if (!closed) return;
    publish(
      "student.practice.session",
      {
        active: false,
        sessionId: closed.sessionId,
        durationMs: closed.durationMs,
      },
      "student",
    );
  };

  if (!state.active) {
    return (
      <div
        className="rounded-lg p-3 mb-3 flex items-center justify-between gap-3"
        style={{
          background: "var(--bg-alt)",
          border: "1px dashed var(--border)",
        }}
        aria-label="Private practice mode"
      >
        <div className="flex items-start gap-2 min-w-0">
          <ShieldOff
            size={16}
            style={{ color: "var(--fg-faint)", marginTop: 2, flexShrink: 0 }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p
              className="text-sm font-semibold"
              style={{ color: "var(--fg)" }}
            >
              Private practice
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
            >
              Practise without your teacher seeing each step. They&apos;ll only
              see that you practised — not what you tried.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={enable}
          className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 shrink-0"
          style={{
            background: "var(--accent)",
            color: "var(--paper)",
            minHeight: 44,
          }}
          aria-label="Start a private practice session"
        >
          Start practice
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg p-3 mb-3 flex items-center justify-between gap-3"
      style={{
        background: "var(--accent-soft)",
        border: "1px solid var(--accent)",
      }}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Lock
          size={16}
          style={{
            color: "var(--accent-ink, var(--accent))",
            marginTop: 2,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--accent-ink, var(--accent))" }}
          >
            Practice mode is on
          </p>
          <p
            className="text-xs"
            style={{ color: "var(--fg)", lineHeight: 1.5 }}
          >
            Hints, attempts, and pastes from this session are kept off the
            teacher&apos;s ledger. Your teacher will only see that practice
            happened, and for how long. Safeguarding still applies as
            normal.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={disable}
        className="kl-tap-target rounded-md px-3 py-2 text-xs shrink-0"
        style={{
          background: "var(--bg)",
          color: "var(--fg)",
          border: "1px solid var(--border)",
          minHeight: 44,
        }}
        aria-label="End the current practice session"
      >
        End practice
      </button>
    </div>
  );
}
