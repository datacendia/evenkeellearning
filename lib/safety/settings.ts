// ─────────────────────────────────────────────────────────────────────────────
// lib/safety/settings.ts
//
// Typed Parent Safety Centre settings, persisted to localStorage.
//
// Status vs the Bible (§21 Safety Centre, §22 child-safety principles)
// ────────────────────────────────────────────────────────────────────
// v1.5.4 converts the previously-decorative Safety Centre toggles into real
// state + enforcement. The enforcement path is the `SafetyGate` component
// around `<EkeChat>` on `/student` — bedtime windows and daily screen-time
// caps pause the session surface; tone feeds Eke's `tone` prop.
//
// What is NOT wired yet (honest scope for v1.5.4)
// ───────────────────────────────────────────────
// • Crisis notifications are in-app only. Out-of-band SMS/email/push
//   channels are deferred — see HONESTY.md and SAFEGUARDING.md §1.
// • GDPR Art. 17 erasure landed as a follow-up to the initial v1.5.4
//   commit; the wiring lives in `lib/safety/erasure.ts`.
//
// Privacy
// ───────
// Like every other learner/parent-side preference in Even Keel, these
// settings live in `localStorage` only. No server, no analytics. A user
// can clear them at any time by clearing site data.
// ─────────────────────────────────────────────────────────────────────────────

import type { EkeTone } from "@/lib/eke/personality";

/**
 * Crisis-notification delivery channel.
 *
 * Implemented in v1.5.4:
 *   • `"in-app"`         — the parent feed strip is the only surface.
 *   • `"in-app+browser"` — also fires a `Notification` via the browser's
 *                          built-in Notification API (no server, no push
 *                          service). Permission is requested explicitly
 *                          via the Parent Safety Centre. Real, working.
 *
 * Reserved for a future server (still NOT implemented):
 *   • `"in-app+push"`    — Web Push via a service worker + VAPID server.
 *   • `"in-app+sms"`     — SMS via Twilio / equivalent.
 *
 * The UI permits selecting only the implemented values. Reserved values
 * round-trip through storage so a future migration doesn't need a schema
 * bump.
 */
export type CrisisChannel =
  | "in-app"
  | "in-app+browser"
  | "in-app+push"
  | "in-app+sms";

export interface ScreenTimeSettings {
  /** When false, no cap is enforced. */
  enabled: boolean;
  /** Daily allowance in minutes. Ignored when `enabled` is false. */
  dailyCapMinutes: number;
}

export interface BedtimeSettings {
  /** When false, the session is never paused by the bedtime window. */
  enabled: boolean;
  /** Bedtime window start — "HH:MM" 24h. Local time. */
  startHHMM: string;
  /** Bedtime window end — "HH:MM" 24h. May cross midnight (start > end). */
  endHHMM: string;
}

export interface CrisisSettings {
  /** Master on/off for the Safeguarding detector surfacing alerts. */
  enabled: boolean;
  /**
   * Delivery channel. Only "in-app" is implemented in v1.5.4. The
   * UI prevents selecting the other values and displays a Phase 2 note.
   * Stored so forward compatibility is possible without a migration.
   */
  channel: CrisisChannel;
}

export interface SafetySettings {
  screenTime: ScreenTimeSettings;
  bedtime: BedtimeSettings;
  /** Base Eke tone for the learner. `a11y.literalTone` overrides at render. */
  tone: EkeTone;
  crisis: CrisisSettings;
}

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  screenTime: { enabled: false, dailyCapMinutes: 60 },
  bedtime: { enabled: false, startHHMM: "21:00", endHHMM: "07:00" },
  tone: "mentor",
  crisis: { enabled: true, channel: "in-app" },
};

const STORAGE_KEY = "evenkeel/safety/v1";
const USAGE_STORAGE_KEY = "evenkeel/safety/usage/v1";

// ─── persistence ─────────────────────────────────────────────────────────────

/**
 * Read settings from localStorage. Returns defaults for any missing or
 * malformed key, never throws. SSR-safe (returns defaults).
 */
export function getSafetySettings(): SafetySettings {
  if (typeof window === "undefined") return cloneDefaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return cloneDefaults();
    return coerce(parsed as Record<string, unknown>);
  } catch {
    return cloneDefaults();
  }
}

export function setSafetySettings(next: SafetySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* no-op */
  }
}

export function updateSafetySetting<K extends keyof SafetySettings>(
  key: K,
  value: SafetySettings[K],
): SafetySettings {
  const current = getSafetySettings();
  const next = { ...current, [key]: value };
  setSafetySettings(next);
  return next;
}

export function resetSafetySettings(): SafetySettings {
  const defaults = cloneDefaults();
  setSafetySettings(defaults);
  return defaults;
}

function cloneDefaults(): SafetySettings {
  // Structured clone would be fine; the shape is small and well-known.
  return {
    screenTime: { ...DEFAULT_SAFETY_SETTINGS.screenTime },
    bedtime: { ...DEFAULT_SAFETY_SETTINGS.bedtime },
    tone: DEFAULT_SAFETY_SETTINGS.tone,
    crisis: { ...DEFAULT_SAFETY_SETTINGS.crisis },
  };
}

/**
 * Defensive parser. Anything weird falls back to the matching default.
 * The shape is intentionally small; no migration branches needed yet.
 */
function coerce(raw: Record<string, unknown>): SafetySettings {
  const out = cloneDefaults();
  const st = raw.screenTime as Record<string, unknown> | undefined;
  if (st && typeof st === "object") {
    if (typeof st.enabled === "boolean") out.screenTime.enabled = st.enabled;
    if (typeof st.dailyCapMinutes === "number" && Number.isFinite(st.dailyCapMinutes)) {
      out.screenTime.dailyCapMinutes = Math.max(5, Math.min(600, Math.round(st.dailyCapMinutes)));
    }
  }
  const bt = raw.bedtime as Record<string, unknown> | undefined;
  if (bt && typeof bt === "object") {
    if (typeof bt.enabled === "boolean") out.bedtime.enabled = bt.enabled;
    // v1.5.4 — validate not only the "HH:MM" shape but the actual numeric
    // ranges. Garbage like "25:99" otherwise round-trips through storage and
    // silently breaks the bedtime window. Caught by safety-settings.test.ts.
    if (typeof bt.startHHMM === "string" && hhmmToMinutes(bt.startHHMM) !== null) {
      out.bedtime.startHHMM = bt.startHHMM;
    }
    if (typeof bt.endHHMM === "string" && hhmmToMinutes(bt.endHHMM) !== null) {
      out.bedtime.endHHMM = bt.endHHMM;
    }
  }
  const tone = raw.tone;
  if (tone === "mentor" || tone === "peer" || tone === "foreman" || tone === "literal") {
    out.tone = tone;
  }
  const crisis = raw.crisis as Record<string, unknown> | undefined;
  if (crisis && typeof crisis === "object") {
    if (typeof crisis.enabled === "boolean") out.crisis.enabled = crisis.enabled;
    const ch = crisis.channel;
    if (
      ch === "in-app" ||
      ch === "in-app+browser" ||
      ch === "in-app+push" ||
      ch === "in-app+sms"
    ) {
      out.crisis.channel = ch;
    }
  }
  return out;
}

// ─── enforcement helpers (pure, fully unit-testable) ─────────────────────────

/**
 * True if `now` falls inside the configured bedtime window. Handles windows
 * that cross midnight (start > end). Returns `false` whenever `enabled`
 * is false so the call site can short-circuit.
 */
export function isBedtimeActive(bt: BedtimeSettings, now: Date): boolean {
  if (!bt.enabled) return false;
  const start = hhmmToMinutes(bt.startHHMM);
  const end = hhmmToMinutes(bt.endHHMM);
  if (start === null || end === null) return false;
  const n = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false; // zero-length window = off
  if (start < end) {
    // simple window, same day, e.g. 13:00 → 14:00
    return n >= start && n < end;
  }
  // crosses midnight, e.g. 21:00 → 07:00
  return n >= start || n < end;
}

function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// ─── daily usage tracking ────────────────────────────────────────────────────
//
// Usage is written by `components/shared/SafetyGate.tsx` once per minute
// while the /student tab is visible. Keyed by local-date so a midnight tick
// naturally resets the counter. SSR-safe: all reads/writes guarded.

export interface DailyUsage {
  /** Local-date "YYYY-MM-DD". */
  date: string;
  /** Minutes accumulated today while /student was visible. */
  minutesUsed: number;
}

export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDailyUsage(now: Date = new Date()): DailyUsage {
  const fresh: DailyUsage = { date: todayKey(now), minutesUsed: 0 };
  if (typeof window === "undefined") return fresh;
  try {
    const raw = window.localStorage.getItem(USAGE_STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<DailyUsage>;
    if (!parsed || typeof parsed !== "object") return fresh;
    if (parsed.date !== fresh.date) return fresh; // new day → reset
    const mins = typeof parsed.minutesUsed === "number" ? parsed.minutesUsed : 0;
    return { date: fresh.date, minutesUsed: Math.max(0, Math.round(mins)) };
  } catch {
    return fresh;
  }
}

export function bumpDailyUsage(deltaMinutes: number = 1, now: Date = new Date()): DailyUsage {
  const current = getDailyUsage(now);
  const next: DailyUsage = {
    date: current.date,
    minutesUsed: Math.max(0, current.minutesUsed + deltaMinutes),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* no-op */
    }
  }
  return next;
}

export function resetDailyUsage(now: Date = new Date()): DailyUsage {
  const next: DailyUsage = { date: todayKey(now), minutesUsed: 0 };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* no-op */
    }
  }
  return next;
}

export interface ScreenTimeCapState {
  enabled: boolean;
  exceeded: boolean;
  minutesUsed: number;
  minutesRemaining: number;
  capMinutes: number;
}

/**
 * Snapshot of the cap state for the current day. Pure relative to
 * `now` + the passed settings + `usage`. Separated from the storage
 * reads so tests can drive it with synthetic inputs.
 */
export function screenTimeCapState(
  st: ScreenTimeSettings,
  usage: DailyUsage,
): ScreenTimeCapState {
  if (!st.enabled) {
    return {
      enabled: false,
      exceeded: false,
      minutesUsed: usage.minutesUsed,
      minutesRemaining: Infinity,
      capMinutes: st.dailyCapMinutes,
    };
  }
  const remaining = Math.max(0, st.dailyCapMinutes - usage.minutesUsed);
  return {
    enabled: true,
    exceeded: usage.minutesUsed >= st.dailyCapMinutes,
    minutesUsed: usage.minutesUsed,
    minutesRemaining: remaining,
    capMinutes: st.dailyCapMinutes,
  };
}

/**
 * True iff the caller should render the children. Convenience for
 * `SafetyGate`. Tests also use it to pin the combined-enforcement truth
 * table (bedtime OR cap).
 */
export function shouldPauseSession(
  settings: SafetySettings,
  usage: DailyUsage,
  now: Date,
): { paused: boolean; reason: "bedtime" | "cap" | null } {
  if (isBedtimeActive(settings.bedtime, now)) return { paused: true, reason: "bedtime" };
  const cap = screenTimeCapState(settings.screenTime, usage);
  if (cap.exceeded) return { paused: true, reason: "cap" };
  return { paused: false, reason: null };
}

// ─── presets exposed for the parent Safety Centre UI ─────────────────────────

export const SCREEN_TIME_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 30, label: "30 min" },
  { minutes: 45, label: "45 min" },
  { minutes: 60, label: "60 min" },
  { minutes: 90, label: "90 min" },
  { minutes: 120, label: "2h" },
  { minutes: 180, label: "3h" },
];

export const BEDTIME_START_PRESETS: ReadonlyArray<string> = [
  "18:00", "18:30", "19:00", "19:30", "20:00", "20:30",
  "21:00", "21:30", "22:00", "22:30", "23:00", "23:30",
];

export const BEDTIME_END_PRESETS: ReadonlyArray<string> = [
  "05:00", "05:30", "06:00", "06:30", "07:00", "07:30",
  "08:00", "08:30", "09:00", "09:30", "10:00",
];

export const TONE_PRESETS: ReadonlyArray<{ id: EkeTone; label: string; blurb: string }> = [
  { id: "mentor",  label: "Mentor",  blurb: "Warm, encouraging — default for ages 11–14" },
  { id: "peer",    label: "Peer",    blurb: "Companion voice — ages 14+" },
  { id: "foreman", label: "Foreman", blurb: "Direct, trade-oriented — adult / vocational" },
];
