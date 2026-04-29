"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/AccessibilitySettingsPanel.tsx
//
// A self-contained launcher button + slide-in panel that lets the learner
// toggle every setting in `lib/a11y/settings.ts`. Mounted in SurfaceShell
// so every privileged and learner surface exposes it consistently.
//
// Design notes
// ────────────
// • The trigger button is keyboard-focusable and has an explicit aria-label
//   ("Accessibility settings"). It uses the universal accessibility glyph
//   (Lucide `Accessibility`) and is sized to a 44×44 hit target.
// • The panel is a `<dialog>`-style modal: focus is trapped, Escape closes,
//   the backdrop closes on click. It does not use the native <dialog>
//   element because Tailwind/CSS-tokens styling is more predictable on a
//   plain div.
// • Each toggle row has a visible label, a short explainer, and a switch.
//   The Switch is a standard `role="switch"` button (better screen-reader
//   semantics than a styled checkbox).
// • The panel writes through `useA11y().update`, which re-applies the
//   `data-a11y-*` attributes to <html> immediately so changes are visible.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { Accessibility, X, RotateCcw } from "lucide-react";
import { useA11y } from "./AccessibilityProvider";
import type { A11ySettings } from "@/lib/a11y/settings";

interface ToggleDef {
  key: keyof A11ySettings;
  label: string;
  description: string;
}

const TOGGLES: ToggleDef[] = [
  {
    key: "dyslexiaFont",
    label: "Dyslexia-friendly typeface",
    description:
      "Switches body and headings to Atkinson Hyperlegible, a typeface designed by the Braille Institute for clarity at small sizes.",
  },
  {
    key: "largeSpacing",
    label: "Wider letter & line spacing",
    description:
      "Increases letter-spacing and line-height. Often helpful alongside the dyslexia-friendly typeface.",
  },
  {
    key: "largeText",
    label: "Larger text",
    description: "Boosts the base font size by 12.5% and tightens dim greys for legibility.",
  },
  {
    key: "highContrast",
    label: "Higher contrast",
    description:
      "Strengthens text-on-background contrast for low-vision users. Honours OS preferences too.",
  },
  {
    key: "focusMode",
    label: "Focus mode",
    description:
      "On the student surface, hides the right-rail meters and goal cards so a single problem fills the view. Helpful for ADHD and processing-speed differences.",
  },
  {
    key: "literalTone",
    label: "Literal, idiom-free tone",
    description:
      "Eke drops encouragement language and idioms. Helpful for autistic learners and EAL students who find warmth-heavy phrasing ambiguous.",
  },
  {
    key: "assistiveInput",
    label: "I use assistive input technology",
    description:
      "Tell Even Keel Learning that you use eye-gaze, switch, dictation, word-prediction, or another assistive input. The mimicry detector then ignores keystroke cadence so your typing style is never misread as AI cheating. (Paste-blocking and focus-loss tracking still apply.)",
  },
];

export default function AccessibilitySettingsPanel() {
  const { settings, update, reset, hydrated } = useA11y();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Restore focus to the trigger when the panel closes.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) triggerRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Accessibility settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="kl-tap-target inline-flex items-center justify-center rounded-md transition"
        style={{
          width: 44,
          height: 44,
          color: "var(--fg-dim)",
          background: "transparent",
          border: "1px solid var(--border)",
        }}
        title="Accessibility settings"
      >
        <Accessibility size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="a11y-panel-title"
          className="fixed inset-0 z-[100]"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="fixed top-0 right-0 h-full w-full max-w-md overflow-y-auto"
            style={{
              background: "var(--bg)",
              color: "var(--fg)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
            }}
          >
            <header
              className="sticky top-0 px-5 py-4 flex items-center justify-between"
              style={{
                background: "var(--bg)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>
                <h2
                  id="a11y-panel-title"
                  className="font-serif text-lg"
                  style={{ margin: 0, color: "var(--fg)" }}
                >
                  Accessibility settings
                </h2>
                <p
                  className="font-mono mt-1"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--fg-faint)",
                  }}
                >
                  Stored on this device · never sent to a server
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close accessibility settings"
                onClick={() => setOpen(false)}
                className="kl-tap-target inline-flex items-center justify-center rounded-md"
                style={{
                  width: 44,
                  height: 44,
                  color: "var(--fg-dim)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="px-5 py-4 space-y-4">
              {!hydrated && (
                <p className="text-sm" style={{ color: "var(--fg-faint)" }}>
                  Loading your preferences…
                </p>
              )}
              {hydrated &&
                TOGGLES.map((t) => (
                  <ToggleRow
                    key={t.key}
                    label={t.label}
                    description={t.description}
                    checked={settings[t.key]}
                    onChange={(v) => update(t.key, v)}
                  />
                ))}

              <div
                className="mt-2 pt-4"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <button
                  type="button"
                  onClick={() => reset()}
                  className="kl-tap-target inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  style={{
                    color: "var(--fg-dim)",
                    background: "transparent",
                    border: "1px solid var(--border)",
                  }}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Reset to defaults
                </button>
                <p
                  className="mt-3 text-xs"
                  style={{ color: "var(--fg-faint)", lineHeight: 1.55 }}
                >
                  Even Keel Learning also honours your operating-system preferences for
                  reduced motion and increased contrast. The settings here
                  layer on top.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="rounded-md p-3"
      style={{ border: "1px solid var(--border)", background: "var(--bg-alt)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="flex-1 text-sm" style={{ color: "var(--fg)" }}>
          <span className="font-semibold">{label}</span>
          <span
            className="block mt-1 text-xs"
            style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}
          >
            {description}
          </span>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
          className="shrink-0 rounded-full transition"
          style={{
            width: 44,
            height: 26,
            background: checked ? "var(--accent)" : "var(--bg-deep)",
            border: "1px solid var(--border)",
            position: "relative",
            cursor: "pointer",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 2,
              left: checked ? 20 : 2,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: checked ? "var(--paper, #FAF7F2)" : "var(--fg-dim)",
              transition: "left 0.18s ease",
            }}
          />
        </button>
      </div>
    </div>
  );
}
