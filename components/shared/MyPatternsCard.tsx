"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/MyPatternsCard.tsx
//
// The learner-facing surface of the personal error-bank
// (`lib/eke/error-bank.ts`). Shows the learner — and only the learner —
// their recurring error patterns as named diagnostics with concrete cues
// to catch them next time. Teacher/parent surfaces do not render this
// component; the Teacher Integrity Ledger sees validated-answer category
// events on the bus, but a learner's personal history is theirs.
//
// Design notes
// ────────────
//   • Only renders when there is at least one entry. A learner with a
//     clean bank sees nothing, so the feature does not clutter the first
//     session or shame a new user.
//   • Subscribes directly to the error-bank in-memory notifier AND to the
//     cross-surface data bus for `student.error.observed`. The first
//     handles same-tab updates; the second handles the (unusual) case of
//     the same learner writing from another tab on the same device.
//   • Includes an explicit learner-controlled "clear my journal" button.
//     The learner owns this artefact.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { BookMarked, X } from "lucide-react";
import {
  clearErrorBank,
  readErrorBank,
  subscribeErrorBank,
  summariseErrorBank,
  type PatternSummary,
} from "@/lib/eke/error-bank";
import { subscribe as subscribeBus } from "@/lib/data-bus";

export default function MyPatternsCard() {
  const [summary, setSummary] = useState<PatternSummary[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    // Initial hydrate from localStorage.
    setSummary(summariseErrorBank(readErrorBank()));

    // Same-tab updates.
    const unsubLocal = subscribeErrorBank((entries) => {
      setSummary(summariseErrorBank(entries));
    });

    // Cross-tab updates: the bus receives `student.error.observed` from
    // another tab on the same device. We re-read from storage on each
    // fire (cheap, bounded) rather than trust the event payload — the
    // bus payload is category-only and we want the full up-to-date bank.
    const unsubBus = subscribeBus((ev) => {
      if (ev.type !== "student.error.observed") return;
      setSummary(summariseErrorBank(readErrorBank()));
    });

    return () => {
      unsubLocal();
      unsubBus();
    };
  }, []);

  if (summary.length === 0) return null;

  const totalCount = summary.reduce((acc, p) => acc + p.count, 0);

  return (
    <section
      className="kl-card"
      aria-labelledby="my-patterns-title"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <BookMarked size={16} style={{ color: "var(--accent)" }} aria-hidden="true" />
          <h3 id="my-patterns-title" className="text-sm font-semibold">
            My patterns
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="my-patterns-body"
          className="kl-tap-target text-xs font-mono"
          style={{
            color: "var(--fg-faint)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            minWidth: 44,
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          {expanded ? "Hide" : "Show"}
        </button>
      </header>

      <p
        className="text-xs mb-3"
        style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
      >
        These are the error shapes you&apos;ve run into recently. Named
        patterns are easier to catch next time. Only you see this.
      </p>

      {expanded && (
        <div id="my-patterns-body">
          <ul className="space-y-3" role="list">
            {summary.map((p) => (
              <li
                key={p.category}
                className="rounded-md p-3"
                style={{
                  background: "var(--bg-deep)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "var(--fg)" }}
                  >
                    {p.detail.title}
                  </span>
                  <span
                    className="kl-badge"
                    aria-label={`${p.count} occurrence${p.count === 1 ? "" : "s"}`}
                    style={{
                      background: "var(--accent-soft)",
                      color: "var(--accent-ink, var(--accent))",
                    }}
                  >
                    ×{p.count}
                  </span>
                </div>
                <p
                  className="text-xs"
                  style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
                >
                  {p.detail.explanation}
                </p>
                <p
                  className="text-xs mt-1.5"
                  style={{ color: "var(--fg)", lineHeight: 1.5 }}
                >
                  <strong style={{ fontWeight: 600 }}>Cue:</strong>{" "}
                  {p.detail.cue}
                </p>
              </li>
            ))}
          </ul>

          <div
            className="mt-3 flex items-center justify-between gap-2"
            style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}
          >
            <p
              className="font-mono"
              style={{
                fontSize: 10,
                color: "var(--fg-faint)",
                letterSpacing: "0.05em",
              }}
            >
              {totalCount} observation{totalCount === 1 ? "" : "s"} ·
              private to this device
            </p>
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  window.confirm("Clear your patterns journal? This only affects this device.")
                ) {
                  clearErrorBank();
                }
              }}
              aria-label="Clear my patterns journal"
              className="kl-tap-target text-xs inline-flex items-center gap-1"
              style={{
                color: "var(--fg-dim)",
                minHeight: 44,
                padding: "0 8px",
              }}
            >
              <X size={12} aria-hidden="true" /> Clear
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
