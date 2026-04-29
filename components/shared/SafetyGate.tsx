"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/SafetyGate.tsx
//
// Enforcement surface for the Parent Safety Centre. Wraps `<EkeChat>` on
// /student. When bedtime is active or the daily cap is exceeded, the gate
// replaces the children with a calm "paused" card. Otherwise the gate is
// a transparent pass-through that also tracks minutes-used-today.
//
// Design notes
// ────────────
// • The 60s foreground-minutes ticker lives in `SafetyProvider`, NOT here,
//   so multiple SafetyGate instances (e.g. a parent preview iframe alongside
//   the real /student tree) can never double-count. The gate reads `usage`
//   from context and is otherwise side-effect-free w.r.t. the cap counter.
// • The gate re-evaluates the bedtime/cap predicates on a 30s interval so
//   the "paused" screen can appear mid-session without the user clicking.
// • Publishes `student.session.paused` on the cross-surface data-bus so
//   the parent `/parent` feed strip reflects the cause within one frame.
// • Publishes `student.session.resumed` on transitions back to open.
// • The component is SSR-safe. Before hydration it renders children so
//   the server- and first-client-render markup match.
//
// What it does NOT do
// ───────────────────
// • It does not affect Eke's cryptographic path (CRT signing, receipts)
//   and does not introduce any model calls. Pure client-side UX gate.
// • It does not hide the children behind an unmount — children are
//   unmounted while paused so the timers inside EkeChat do not accumulate
//   work during a pause. This is intentional: a sleeping child's practice
//   streak should not advance.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, Moon, ShieldHalf } from "lucide-react";
import { useSafety } from "@/components/shared/SafetyProvider";
import { shouldPauseSession } from "@/lib/safety/settings";
import { publish } from "@/lib/data-bus";

interface Props {
  children: ReactNode;
}

export default function SafetyGate({ children }: Props) {
  const { settings, hydrated, usage } = useSafety();
  // Ticks force a re-evaluation of the predicates on a wall-clock cadence.
  const [, setTick] = useState(0);
  const lastPausedRef = useRef<"bedtime" | "cap" | null>(null);

  // Re-evaluate bedtime window + cap predicates every 30s. (The usage
  // counter itself is bumped by SafetyProvider on a separate 60s timer —
  // see the design-notes block at the top of this file.)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const now = new Date();
  const { paused, reason } = hydrated
    ? shouldPauseSession(settings, usage, now)
    : { paused: false, reason: null as "bedtime" | "cap" | null };

  // Emit a single bus event on each transition.
  useEffect(() => {
    if (!hydrated) return;
    const prev = lastPausedRef.current;
    if (paused && reason !== prev) {
      publish(
        "student.session.paused",
        {
          reason: reason as string,
          minutesUsed: usage.minutesUsed,
          capMinutes: settings.screenTime.dailyCapMinutes,
        },
        "student",
      );
      lastPausedRef.current = reason;
    } else if (!paused && prev !== null) {
      publish(
        "student.session.resumed",
        { previousReason: prev as string },
        "student",
      );
      lastPausedRef.current = null;
    }
  }, [paused, reason, hydrated, usage.minutesUsed, settings.screenTime.dailyCapMinutes]);

  if (!hydrated) return <>{children}</>;
  if (!paused) return <>{children}</>;
  if (reason === "bedtime") return <BedtimePause endHHMM={settings.bedtime.endHHMM} />;
  return (
    <CapPause
      capMinutes={settings.screenTime.dailyCapMinutes}
      minutesUsed={usage.minutesUsed}
    />
  );
}

function BedtimePause({ endHHMM }: { endHHMM: string }) {
  return (
    <PauseCard
      icon={<Moon size={28} style={{ color: "var(--accent)" }} />}
      title="Session paused — bedtime"
      body={
        <>
          A parent has set a bedtime window on this device. Practice will
          resume automatically after <span className="font-mono">{endHHMM}</span>.
        </>
      }
    />
  );
}

function CapPause({
  capMinutes,
  minutesUsed,
}: {
  capMinutes: number;
  minutesUsed: number;
}) {
  return (
    <PauseCard
      icon={<Clock size={28} style={{ color: "var(--accent)" }} />}
      title="Session paused — daily cap reached"
      body={
        <>
          Today's practice allowance of{" "}
          <span className="font-mono">{capMinutes} min</span> has been
          reached ({minutesUsed} min tracked). The counter resets at local
          midnight.
        </>
      }
    />
  );
}

function PauseCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
}) {
  return (
    <div
      className="kl-card"
      role="status"
      aria-live="polite"
      style={{
        minHeight: 420,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>{icon}</div>
        <h2 className="font-serif" style={{ fontSize: 28, marginBottom: 10 }}>
          {title}
        </h2>
        <p style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}>{body}</p>
        <div
          className="flex items-center justify-center gap-2 mt-6 font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fg-faint)",
          }}
        >
          <ShieldHalf size={12} />
          <span>Set by Parent Safety Centre</span>
        </div>
      </div>
    </div>
  );
}
