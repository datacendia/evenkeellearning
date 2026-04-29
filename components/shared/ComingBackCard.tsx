"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/ComingBackCard.tsx
//
// Surfaces the v1.4.4 spacing scheduler to the learner. Three render
// states, in priority order:
//
//   1. **Hidden.** No problems have ever been attempted on this device
//      (scheduler bank empty). The card does not clutter a new learner's
//      first session.
//   2. **"Coming back today."** One or more entries are due. Lists each
//      due problem with its current Leitner box level and the result of
//      the last attempt.
//   3. **"All caught up."** Entries exist but none are due. Shows the
//      learner when their next review will land — *"next review in 3
//      days"* — so they can plan rest and the empty state still feels
//      earned.
//
// Pedagogy framing
// ────────────────
// The card is parent-explainable in one sentence: *"Problems your child
// got wrong come back tomorrow; problems they got right come back next
// week, then in a fortnight, then in a month."* That is the entire
// algorithm. Showing this on-surface is part of the structural-safety
// pitch — the learner and parent can see exactly how review frequency
// is decided.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import {
  BOX_INTERVALS_DAYS,
  getAllStates,
  subscribeScheduler,
  type SchedulerEntry,
} from "@/lib/eke/scheduler";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Props {
  /**
   * Optional map from `problemId` to a learner-facing title. The card
   * falls back to the raw id when an entry has no mapping, which is
   * fine for the demo but ugly at scale.
   */
  titles?: Record<string, string>;
}

export default function ComingBackCard({ titles = {} }: Props) {
  const [entries, setEntries] = useState<SchedulerEntry[]>([]);
  // Drive the "all caught up" countdown re-render once a minute. The
  // numeric difference between dueAt and now changes continuously; we
  // round to days for display, so a 60s tick is more than enough.
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setEntries(getAllStates());
    const unsub = subscribeScheduler(setEntries);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  const { due, nextDueAt } = useMemo(() => {
    const dueList = entries
      .filter((e) => e.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt);
    const upcoming = entries.filter((e) => e.dueAt > now);
    const earliest = upcoming.length
      ? Math.min(...upcoming.map((e) => e.dueAt))
      : null;
    return { due: dueList, nextDueAt: earliest };
  }, [entries, now]);

  if (entries.length === 0) return null;

  const titleFor = (id: string): string => titles[id] ?? id;
  const lastResultLabel = (e: SchedulerEntry): string => {
    if (e.lastResult === "correct") return "got it last time";
    if (e.lastResult === "sign_flipped") return "sign-flip last time";
    if (e.lastResult === "off_by_one") return "off-by-one last time";
    if (e.lastResult === "doubled") return "doubled a coefficient last time";
    if (e.lastResult === "halved") return "halved a term last time";
    if (e.lastResult === "wrong") return "method drifted last time";
    return "last attempt recorded";
  };

  return (
    <section className="kl-card" aria-labelledby="coming-back-title">
      <header className="flex items-center gap-2 mb-3">
        <Repeat size={16} style={{ color: "var(--accent)" }} aria-hidden="true" />
        <h3 id="coming-back-title" className="text-sm font-semibold">
          {due.length > 0 ? "Coming back today" : "All caught up"}
        </h3>
      </header>

      {due.length > 0 ? (
        <ul className="space-y-2 text-sm" role="list">
          {due.map((e) => (
            <li
              key={e.problemId}
              className="rounded-md p-2"
              style={{
                background: "var(--bg-deep)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: "var(--fg)" }}>{titleFor(e.problemId)}</span>
                <span
                  className="kl-badge"
                  aria-label={`Leitner box ${e.box} of ${BOX_INTERVALS_DAYS.length}`}
                >
                  Box {e.box}
                </span>
              </div>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--fg-dim)", lineHeight: 1.4 }}
              >
                {lastResultLabel(e)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="text-xs"
          style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
        >
          {nextDueAt !== null
            ? `Nothing to review yet. Next review in ${formatDaysFromNow(
                nextDueAt,
                now,
              )}.`
            : "Nothing to review yet."}
        </p>
      )}

      <p
        className="font-mono mt-3"
        style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.05em" }}
      >
        {entries.length} problem{entries.length === 1 ? "" : "s"} on your review
        list · spacing schedule {BOX_INTERVALS_DAYS.join(" / ")} days
      </p>
    </section>
  );
}

function formatDaysFromNow(dueAt: number, now: number): string {
  const days = Math.max(0, Math.round((dueAt - now) / MS_PER_DAY));
  if (days === 0) return "less than a day";
  if (days === 1) return "1 day";
  return `${days} days`;
}
