// ─────────────────────────────────────────────────────────────────────────────
// lib/a11y/settings.ts
//
// Typed accessibility settings, persisted to localStorage. The settings are
// applied as `data-a11y-*` attributes on the `<html>` element by
// `components/shared/AccessibilityProvider.tsx`, so any CSS rule can opt in
// with an attribute selector (`html[data-a11y-dyslexia-font="true"] …`).
//
// Why a single typed module
// ─────────────────────────
// • Keeps the JSON schema explicit and migration-safe (versioned).
// • Provides a single source of truth for tests and the settings UI.
// • Mirrors the shape of `lib/auth/age-band.ts` so the storage idioms are
//   consistent across the codebase.
//
// Privacy
// ───────
// Like every other learner-side preference in Even Keel Learning, settings live in
// `localStorage` only. No server, no analytics. A user can clear them at
// any time by clearing site data.
//
// IPA / Mimicry-detection caveat
// ──────────────────────────────
// `assistiveInput` is the single setting that materially changes platform
// behaviour: when true, the IPA cadence-based mimicry score is suppressed
// (paste and focus-loss signals still apply). This protects students who
// use sticky-key, eye-gaze, switch, dictation, or word-prediction tools
// from being falsely flagged as AI-mimicking. See SAFEGUARDING.md §1.5.
// ─────────────────────────────────────────────────────────────────────────────

export interface A11ySettings {
  /** Swap Fraunces serif headings + Geist body for Atkinson Hyperlegible. */
  dyslexiaFont: boolean;
  /** Wider letter-spacing (applies regardless of font choice). */
  largeSpacing: boolean;
  /** Boost base font-size to 1.125× and tighten contrast. */
  largeText: boolean;
  /** Stronger contrast palette (paper + sovereign variants). */
  highContrast: boolean;
  /** Hide non-essential chrome on /student (rail meters, badges). */
  focusMode: boolean;
  /**
   * The learner uses assistive input technology (eye-gaze, switch,
   * dictation, word-prediction, sticky-keys, alternative keyboard).
   * Suppresses cadence-based components of the IPA mimicry score.
   * The age-band gate exposes this on first visit; the settings panel
   * exposes it permanently.
   */
  assistiveInput: boolean;
  /**
   * Replace the warm "mentor" Eke tone with a literal, idiom-free voice.
   * Helps autistic and EAL learners who find encouragement-heavy phrasing
   * patronising or ambiguous. (Surface-side tone selection is Phase 2;
   * the flag is read today by a `getEffectiveTone()` helper in
   * `lib/eke/personality.ts`.)
   */
  literalTone: boolean;
}

export const DEFAULT_A11Y_SETTINGS: A11ySettings = {
  dyslexiaFont: false,
  largeSpacing: false,
  largeText: false,
  highContrast: false,
  focusMode: false,
  assistiveInput: false,
  literalTone: false,
};

const STORAGE_KEY = "evenkeel/a11y/v1";
const LEGACY_STORAGE_KEY = "keellearn/a11y/v1";

/**
 * Reads settings from localStorage. Returns defaults for any missing or
 * malformed key, never throws. SSR-safe (returns defaults).
 */
export function getA11ySettings(): A11ySettings {
  if (typeof window === "undefined") return { ...DEFAULT_A11Y_SETTINGS };
  try {
    // One-time migration from the legacy keellearn/* namespace.
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && !window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_A11Y_SETTINGS };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_A11Y_SETTINGS };
    const out: A11ySettings = { ...DEFAULT_A11Y_SETTINGS };
    for (const k of Object.keys(out) as (keyof A11ySettings)[]) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_A11Y_SETTINGS };
  }
}

/**
 * Persist settings. Silently no-ops if storage is unavailable (private
 * browsing modes, quota exceeded, etc.).
 */
export function setA11ySettings(next: A11ySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* no-op */
  }
}

/**
 * Update a single setting. Returns the new full state for callers that
 * want to reflect it in React state without re-reading storage.
 */
export function updateA11ySetting<K extends keyof A11ySettings>(
  key: K,
  value: A11ySettings[K],
): A11ySettings {
  const current = getA11ySettings();
  const next = { ...current, [key]: value };
  setA11ySettings(next);
  return next;
}

/**
 * Restore defaults. Used by the "Reset accessibility settings" button.
 */
export function resetA11ySettings(): A11ySettings {
  const defaults = { ...DEFAULT_A11Y_SETTINGS };
  setA11ySettings(defaults);
  return defaults;
}

/**
 * Apply the settings as `data-a11y-*` attributes on the document root.
 * Idempotent. Called by the AccessibilityProvider on mount and whenever
 * settings change. SSR-safe.
 */
export function applyA11ySettingsToDocument(s: A11ySettings): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  // Each entry maps a setting to its attribute name.
  const map: Record<keyof A11ySettings, string> = {
    dyslexiaFont: "data-a11y-dyslexia-font",
    largeSpacing: "data-a11y-large-spacing",
    largeText: "data-a11y-large-text",
    highContrast: "data-a11y-high-contrast",
    focusMode: "data-a11y-focus-mode",
    assistiveInput: "data-a11y-assistive-input",
    literalTone: "data-a11y-literal-tone",
  };
  (Object.keys(map) as (keyof A11ySettings)[]).forEach((k) => {
    html.setAttribute(map[k], s[k] ? "true" : "false");
  });
}

/**
 * Convenience: returns `true` if the user has expressed *any* non-default
 * preference. The settings panel uses this to surface a "Settings active"
 * indicator; tests use it to verify round-trip correctness.
 */
export function hasA11yOverrides(s: A11ySettings): boolean {
  return (Object.keys(DEFAULT_A11Y_SETTINGS) as (keyof A11ySettings)[]).some(
    (k) => s[k] !== DEFAULT_A11Y_SETTINGS[k],
  );
}
