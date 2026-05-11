"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/parent/page.tsx
//
// Parent-facing surface ("Shadow Feed"). Mostly seeded content for now, plus
// a real live "Just now" strip at the top of the feed that subscribes to the
// cross-surface data bus. Open `/student` in another tab and clear the
// comprehension gate — a card will appear here within ~one frame.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import { Heart, Coffee, Compass, ShieldHalf, Clock, Trash2, Bell, Activity, Moon } from "lucide-react";
import { subscribe, recentEvents, BusEvent } from "@/lib/data-bus";
import { useSafety } from "@/components/shared/SafetyProvider";
import {
  SCREEN_TIME_PRESETS,
  BEDTIME_START_PRESETS,
  BEDTIME_END_PRESETS,
  TONE_PRESETS,
  type CrisisChannel,
} from "@/lib/safety/settings";
import {
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/lib/safety/notifications";
import type { EkeTone } from "@/lib/eke/personality";

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
  // v1.5.4 — real controls, not display-only. Persistence + enforcement live
  // in `lib/safety/settings.ts` + `components/shared/SafetyGate.tsx`. Crisis
  // notifications remain in-app only in v1.5.4; the channel-select is
  // locked to in-app with an honest Phase 2 note. See HONESTY.md and
  // SAFEGUARDING.md §1 for the deferred out-of-band channel work.
  const { settings, update, hydrated } = useSafety();

  return (
    <div className="space-y-4">
      <div className="kl-card flex items-center gap-3">
        <ShieldHalf size={20} style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--fg-dim)" }}>
          Full parental controls. Settings persist on this device and are
          enforced on the /student surface. Even Keel Learning collects no
          biometrics, shows no advertising, and never sells data.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Screen-time cap */}
        <SafetyControl
          icon={Clock}
          label="Daily screen-time cap"
          description={
            settings.screenTime.enabled
              ? `${settings.screenTime.dailyCapMinutes} min per day — session pauses when reached`
              : "No cap enforced"
          }
          enabled={settings.screenTime.enabled}
          onEnabledChange={(v) =>
            update("screenTime", { ...settings.screenTime, enabled: v })
          }
          disabled={!hydrated}
        >
          <label className="text-xs font-mono block mb-1" style={{ color: "var(--fg-faint)" }}>
            Cap
          </label>
          <select
            value={settings.screenTime.dailyCapMinutes}
            onChange={(e) =>
              update("screenTime", {
                ...settings.screenTime,
                dailyCapMinutes: Number(e.target.value),
              })
            }
            className="w-full text-sm px-2 py-1.5 rounded"
            style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--fg)" }}
            disabled={!hydrated || !settings.screenTime.enabled}
          >
            {SCREEN_TIME_PRESETS.map((p) => (
              <option key={p.minutes} value={p.minutes}>{p.label}</option>
            ))}
          </select>
        </SafetyControl>

        {/* Bedtime window */}
        <SafetyControl
          icon={Moon}
          label="Bedtime mode"
          description={
            settings.bedtime.enabled
              ? `${settings.bedtime.startHHMM} → ${settings.bedtime.endHHMM} — session paused during window`
              : "Off"
          }
          enabled={settings.bedtime.enabled}
          onEnabledChange={(v) => update("bedtime", { ...settings.bedtime, enabled: v })}
          disabled={!hydrated}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-mono block mb-1" style={{ color: "var(--fg-faint)" }}>
                Start
              </label>
              <select
                value={settings.bedtime.startHHMM}
                onChange={(e) => update("bedtime", { ...settings.bedtime, startHHMM: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--fg)" }}
                disabled={!hydrated || !settings.bedtime.enabled}
              >
                {BEDTIME_START_PRESETS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-mono block mb-1" style={{ color: "var(--fg-faint)" }}>
                End
              </label>
              <select
                value={settings.bedtime.endHHMM}
                onChange={(e) => update("bedtime", { ...settings.bedtime, endHHMM: e.target.value })}
                className="w-full text-sm px-2 py-1.5 rounded"
                style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--fg)" }}
                disabled={!hydrated || !settings.bedtime.enabled}
              >
                {BEDTIME_END_PRESETS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </SafetyControl>

        {/* Crisis notifications — in-app + optional browser channel (v1.5.4 follow-up) */}
        <CrisisControl
          enabled={settings.crisis.enabled}
          channel={settings.crisis.channel}
          hydrated={hydrated}
          onEnabledChange={(v) => update("crisis", { ...settings.crisis, enabled: v })}
          onChannelChange={(ch) =>
            update("crisis", { ...settings.crisis, channel: ch })
          }
        />

        {/* Eke tone */}
        <SafetyControl
          icon={Heart}
          label="Eke tone"
          description={TONE_PRESETS.find((t) => t.id === settings.tone)?.blurb ?? ""}
          enabled
          onEnabledChange={() => { /* no-op: tone is always set */ }}
          showToggle={false}
          disabled={!hydrated}
        >
          <label className="text-xs font-mono block mb-1" style={{ color: "var(--fg-faint)" }}>
            Voice
          </label>
          <select
            value={settings.tone}
            onChange={(e) => update("tone", e.target.value as EkeTone)}
            className="w-full text-sm px-2 py-1.5 rounded"
            style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--fg)" }}
            disabled={!hydrated}
          >
            {TONE_PRESETS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </SafetyControl>
      </div>

      <ErasurePanel />
    </div>
  );
}

/**
 * GDPR Article 17 — Right to Erasure card.
 *
 * Two-step confirmation: the first click expands an inline confirmation row
 * with an explicit "I understand, erase now" button and a "Cancel" button.
 * Only the second click actually calls `eraseLearnerData()`. After the
 * erasure runs, a transient receipt is shown stating exactly how many
 * keys were removed and how many parent-policy keys were intentionally
 * kept — no silent action.
 *
 * Honesty notes
 * ─────────────
 * • Local-only: there is no server, so this is the entire surface area.
 *   `lib/safety/erasure.ts` documents what is and isn't in scope.
 * • Parent-set policy keys (bedtime, cap, tone, webhook config) are
 *   intentionally KEPT — they are the parent's data, not the child's.
 *   The card text states this so the parent isn't surprised.
 */
function ErasurePanel() {
  const [stage, setStage] = useState<"idle" | "confirming" | "done">("idle");
  const [report, setReport] = useState<{
    removed: number;
    kept: number;
    tombstoned: number;
  } | null>(null);
  // v1.5.5 — audit M-9: learner-id rotation. Discrete from full erasure
  // (this keeps signed envelopes intact but mints a fresh on-device
  // identifier going forward).
  const [rotation, setRotation] = useState<{ rotated: boolean; prefix: string } | null>(null);

  function runErasure() {
    // Lazy import keeps the module out of the SSR bundle for any consumer
    // that prerenders this page; localStorage access is gated inside
    // `eraseLearnerData` itself, but this is one less reason to ship it.
    import("@/lib/safety/erasure").then(({ eraseLearnerData }) => {
      const r = eraseLearnerData();
      setReport({
        removed: r.removed.length,
        kept: r.kept.length,
        tombstoned: r.tombstoned.length,
      });
      setStage("done");
    });
  }

  function rotate() {
    import("@/lib/safety/erasure").then(({ rotateLearnerId }) => {
      const r = rotateLearnerId();
      setRotation({ rotated: r.previousExisted, prefix: r.newIdPrefix });
    });
  }

  return (
    <div
      className="kl-card"
      style={{ borderColor: "rgba(197, 48, 48, 0.4)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Trash2 size={18} style={{ color: "var(--red)" }} />
          <div>
            <p style={{ fontWeight: 600 }}>Right to erasure (GDPR Art. 17)</p>
            <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
              Permanently delete Alex's CRTs, traces, error bank, scheduler
              state, receipts, comprehension and session history from this
              device. Parent-set safety policy is intentionally kept.
            </p>
          </div>
        </div>
        {stage === "idle" && (
          <button
            type="button"
            onClick={() => setStage("confirming")}
            className="px-4 py-2 rounded-md text-sm"
            style={{
              background: "rgba(197, 48, 48, 0.1)",
              color: "var(--red)",
              border: "1px solid var(--red)",
            }}
          >
            Request deletion
          </button>
        )}
      </div>

      {stage === "confirming" && (
        <div
          className="mt-3 pt-3 flex items-center justify-between gap-3"
          style={{ borderTop: "1px solid var(--border)" }}
          role="alertdialog"
          aria-label="Confirm erasure"
        >
          <p className="text-xs" style={{ color: "var(--fg)" }}>
            This action cannot be undone. Continue?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStage("idle")}
              className="px-3 py-1.5 rounded text-xs"
              style={{
                background: "var(--bg-deep)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runErasure}
              className="px-3 py-1.5 rounded text-xs"
              style={{
                background: "var(--red)",
                color: "var(--paper, #FAF7F2)",
                border: "1px solid var(--red)",
              }}
            >
              I understand, erase now
            </button>
          </div>
        </div>
      )}

      {stage === "done" && report && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: "1px solid var(--border)" }}
          role="status"
        >
          <p className="text-xs" style={{ color: "var(--fg)" }}>
            Erasure complete. Removed <strong>{report.removed}</strong> learner
            data {report.removed === 1 ? "key" : "keys"} from this device;
            kept <strong>{report.kept}</strong> parent-policy{" "}
            {report.kept === 1 ? "key" : "keys"}
            {report.tombstoned > 0 && (
              <>
                {" "}
                · tombstoned <strong>{report.tombstoned}</strong> WORM-protected
                {report.tombstoned === 1 ? " record" : " records"} to hash-only
                audit rows
              </>
            )}
            .
          </p>
        </div>
      )}

      {/* v1.5.5 — audit M-9: learner-id rotation as a sibling action.
          Discrete from full erasure: doesn't touch any signed envelope,
          just mints a fresh on-device identifier so future sessions are
          unlinkable from prior ones without losing prior evidence. */}
      <div
        className="mt-3 pt-3 flex items-center justify-between gap-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div>
          <p className="text-xs" style={{ fontWeight: 600, color: "var(--fg)" }}>
            Rotate on-device learner identifier
          </p>
          <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
            Mints a fresh per-device id for future sessions. Existing signed
            CRTs and receipts are kept and remain valid evidence of past work.
          </p>
          {rotation && (
            <p
              className="text-xs mt-2"
              style={{ color: "var(--fg)" }}
              role="status"
            >
              {rotation.rotated ? "Rotated" : "Initialised"} — new id starts{" "}
              <code style={{ background: "var(--bg-deep)", padding: "0 4px" }}>
                {rotation.prefix}…
              </code>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={rotate}
          className="px-3 py-1.5 rounded text-xs"
          style={{
            background: "var(--bg-deep)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          Rotate id
        </button>
      </div>
    </div>
  );
}

/**
 * Crisis-notifications card. Two settings live here:
 *
 *   1. master enable/disable (the detector still fires either way; this only
 *      controls whether ALERTS are surfaced)
 *   2. delivery channel — `"in-app"` always works; `"in-app+browser"`
 *      additionally fires a real browser `Notification` (handled by
 *      `lib/safety/notifications.ts` subscribed in `SafetyProvider`).
 *      Reserved values `"in-app+push"` / `"in-app+sms"` are not selectable
 *      in v1.5.4 — they require server infra.
 *
 * The card also surfaces the live browser-permission state and exposes a
 * "Allow notifications" button that triggers the standard
 * `Notification.requestPermission()` prompt. Picking the browser channel
 * without granting permission is permitted (the master `enabled` flag
 * still works for the in-app strip), but the helper text makes the
 * combination's behaviour explicit.
 */
function CrisisControl({
  enabled,
  channel,
  hydrated,
  onEnabledChange,
  onChannelChange,
}: {
  enabled: boolean;
  channel: CrisisChannel;
  hydrated: boolean;
  onEnabledChange: (v: boolean) => void;
  onChannelChange: (ch: CrisisChannel) => void;
}) {
  const [perm, setPerm] = useState<NotificationPermissionState>("default");

  // Read the live permission state on mount and on visibility changes
  // (a parent who flips the Site Settings -> Notifications toggle in
  // another tab/OS dialog should see this card update on return).
  useEffect(() => {
    setPerm(getNotificationPermission());
    const onVis = () => setPerm(getNotificationPermission());
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const browserSelected = channel === "in-app+browser";
  const description = !enabled
    ? "Off — detector still fires, alerts suppressed"
    : browserSelected && perm === "granted"
      ? "In-app feed strip + system browser notification"
      : browserSelected
        ? "Browser channel selected — permission not granted yet"
        : "In-app feed strip on the parent surface";

  return (
    <SafetyControl
      icon={Bell}
      label="Crisis notifications"
      description={description}
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      disabled={!hydrated}
    >
      <label className="text-xs font-mono block mb-1" style={{ color: "var(--fg-faint)" }}>
        Channel
      </label>
      <select
        value={channel}
        onChange={(e) => onChannelChange(e.target.value as CrisisChannel)}
        className="w-full text-sm px-2 py-1.5 rounded"
        style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", color: "var(--fg)" }}
        disabled={!hydrated || !enabled}
      >
        <option value="in-app">In-app feed strip only</option>
        <option value="in-app+browser">In-app + browser notification</option>
        {/* Reserved server channels — disabled, kept in the DOM so a future
            release does not need a schema migration on stored settings. */}
        <option value="in-app+push" disabled>
          In-app + Web Push (server required)
        </option>
        <option value="in-app+sms" disabled>
          In-app + SMS (server required)
        </option>
      </select>

      {browserSelected && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs font-mono" style={{ color: "var(--fg-faint)" }}>
            Permission:{" "}
            <span style={{ color: perm === "granted" ? "var(--accent)" : perm === "denied" ? "var(--red)" : "var(--fg-dim)" }}>
              {perm}
            </span>
          </p>
          {perm !== "granted" && perm !== "unsupported" && (
            <button
              type="button"
              onClick={async () => {
                const next = await requestNotificationPermission();
                setPerm(next);
              }}
              className="text-xs px-3 py-1 rounded"
              style={{
                background: "var(--accent)",
                color: "var(--paper, #FAF7F2)",
                border: "1px solid var(--accent)",
              }}
              disabled={perm === "denied"}
              title={perm === "denied" ? "Permission denied — adjust in browser settings" : "Allow browser notifications"}
            >
              {perm === "denied" ? "Blocked in browser" : "Allow notifications"}
            </button>
          )}
        </div>
      )}

      <p className="text-xs mt-2" style={{ color: "var(--fg-faint)" }}>
        Push (Web Push) and SMS channels require server infrastructure and are
        not part of v1.5.4 — see HONESTY.md and SAFEGUARDING.md §1.
      </p>
    </SafetyControl>
  );
}

/**
 * Editable safety-control card. Replaces the v1.5.3 display-only `Toggle`.
 * The old helper is retained below for any remaining callers but is no
 * longer used by the Safety Centre.
 */
function SafetyControl({
  icon: Icon,
  label,
  description,
  enabled,
  onEnabledChange,
  disabled,
  showToggle = true,
  children,
}: {
  icon: any;
  label: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  disabled?: boolean;
  showToggle?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="kl-card">
      <div className="flex items-start gap-3 mb-3">
        <Icon size={18} style={{ color: "var(--accent)", marginTop: 2 }} />
        <div className="flex-1">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs font-mono" style={{ color: "var(--fg-faint)" }}>
            {description}
          </p>
        </div>
        {showToggle && (
          <button
            type="button"
            onClick={() => onEnabledChange(!enabled)}
            disabled={disabled}
            aria-pressed={enabled}
            className="text-xs px-3 py-1.5 rounded"
            style={{
              background: enabled ? "var(--accent)" : "var(--bg-deep)",
              color: enabled ? "var(--paper)" : "var(--fg)",
              border: "1px solid",
              borderColor: enabled ? "var(--accent)" : "var(--border)",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {enabled ? "On" : "Off"}
          </button>
        )}
      </div>
      {children}
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
