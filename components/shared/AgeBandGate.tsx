"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/AgeBandGate.tsx
//
// Self-declared age-band chooser that gates the student surface on first
// visit. Captures the band in localStorage and — for the "under-13" band —
// displays a guardian notice. **Not** a verified-age check; COPPA §312.5
// verifiable parental consent is Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import { Users, Accessibility } from "lucide-react";
import { getAgeBand, setAgeBand, type AgeBand } from "@/lib/auth/age-band";
import { useA11y } from "./AccessibilityProvider";

interface Props {
  children: ReactNode;
}

const OPTIONS: { value: AgeBand; label: string; note: string }[] = [
  {
    value: "under-13",
    label: "Under 13",
    note:
      "Your parent or guardian should be nearby. Even Keel Learning does not collect personal data, but we want them to know you're using it.",
  },
  {
    value: "13-17",
    label: "13 – 17",
    note: "Standard mode. Eke will use a mentor tone.",
  },
  {
    value: "18-plus",
    label: "18 or older",
    note: "Standard mode. Eke will use a peer tone.",
  },
];

export default function AgeBandGate({ children }: Props) {
  const { settings: a11y, update: updateA11y } = useA11y();
  const [mounted, setMounted] = useState(false);
  const [band, setBand] = useState<AgeBand | null>(null);
  const [guardianAck, setGuardianAck] = useState(false);
  const [chosen, setChosen] = useState<AgeBand | null>(null);
  // Mirror a11y.assistiveInput into local state so the user can change
  // their mind during the gate without it taking effect until they
  // click Continue. The persisted setting is only updated in commit().
  const [assistiveInput, setAssistiveInput] = useState(false);

  useEffect(() => {
    setMounted(true);
    setBand(getAgeBand());
  }, []);

  // When the a11y context hydrates, prefill the toggle from any prior
  // declaration so the gate respects an existing preference.
  useEffect(() => {
    setAssistiveInput(a11y.assistiveInput);
  }, [a11y.assistiveInput]);

  function commit() {
    if (!chosen) return;
    if (chosen === "under-13" && !guardianAck) return;
    // Persist the assistive-input declaration first so the IPA analyser
    // picks it up the moment the student surface mounts.
    if (assistiveInput !== a11y.assistiveInput) {
      updateA11y("assistiveInput", assistiveInput);
    }
    setAgeBand(chosen);
    setBand(chosen);
  }

  if (!mounted) return null;
  if (band) return <>{children}</>;

  const selected = OPTIONS.find((o) => o.value === chosen);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          padding: 28,
          borderRadius: 12,
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <Users size={20} style={{ color: "var(--accent)" }} />
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "var(--fg)" }}>
            How old are you?
          </h1>
        </div>

        <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 18, lineHeight: 1.55 }}>
          We use your age only to choose the right Eke tone and safeguards.
          Nothing is sent to a server — this stays in your browser.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {OPTIONS.map((opt) => {
            const active = chosen === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setChosen(opt.value)}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 8,
                  background: active ? "var(--bg-deep)" : "var(--bg-raised)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  color: "var(--fg)",
                  cursor: "pointer",
                }}
                aria-pressed={active}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
                  {opt.note}
                </div>
              </button>
            );
          })}
        </div>

        {selected?.value === "under-13" && (
          <label
            style={{
              marginTop: 16,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 12,
              color: "var(--fg-muted)",
              lineHeight: 1.55,
              padding: 12,
              background: "var(--bg-deep)",
              borderRadius: 6,
              border: "1px dashed var(--border)",
            }}
          >
            <input
              type="checkbox"
              checked={guardianAck}
              onChange={(e) => setGuardianAck(e.target.checked)}
              aria-label="A parent or guardian is with me"
              style={{ marginTop: 3, minWidth: 18, minHeight: 18 }}
            />
            <span>
              <strong>A parent or guardian is with me.</strong> Even Keel Learning does
              not ask for personal information, and we remind Eke to use a
              gentler, simpler tone. A signed guardian-consent step will be
              added in a future release (COPPA §312.5).
            </span>
          </label>
        )}

        {/* Assistive-input declaration — equity-critical setting that
            ensures users of eye-gaze, switch, dictation, sticky-keys,
            or word-prediction tools are never falsely flagged as
            AI-mimicking by the IPA analyser. The same toggle is
            available later from the accessibility settings panel.
            See SAFEGUARDING.md §1.5. */}
        <label
          style={{
            marginTop: 16,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            fontSize: 12,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            padding: 12,
            background: "var(--bg-deep)",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          <Accessibility
            size={16}
            aria-hidden="true"
            style={{ marginTop: 1, color: "var(--accent)", flexShrink: 0 }}
          />
          <span style={{ flex: 1 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={assistiveInput}
                onChange={(e) => setAssistiveInput(e.target.checked)}
                aria-label="I use assistive input technology"
                style={{ minWidth: 18, minHeight: 18 }}
              />
              <strong style={{ color: "var(--fg)" }}>
                I use assistive input technology
              </strong>
            </span>
            <span style={{ display: "block", marginTop: 6 }}>
              Tick if you use eye-gaze, switch, dictation, word-prediction,
              sticky-keys, or another assistive input. Mimicry detection
              will then ignore your typing rhythm so you are never flagged
              for cheating because of how you type. You can change this any
              time in the accessibility settings.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={commit}
          disabled={!chosen || (chosen === "under-13" && !guardianAck)}
          className="kl-tap-target"
          style={{
            marginTop: 18,
            width: "100%",
            padding: "10px 14px",
            background: "var(--accent)",
            color: "var(--accent-fg, #fff)",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: !chosen ? "not-allowed" : "pointer",
            opacity: !chosen || (chosen === "under-13" && !guardianAck) ? 0.6 : 1,
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
