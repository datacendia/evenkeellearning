"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/PasskeyEnrolCard.tsx
//
// v1.4.11 — Lets a learner / DSL / parent enrol a device-resident
// passkey so future signed receipts can be bound to that specific
// passkey instead of a per-tab session key.
//
// Three render states:
//
//   1. WebAuthn unavailable — show an honest "Not supported on this
//      browser" badge and explain that signatures will continue to
//      use the per-tab session key.
//
//   2. No enrolment yet — show a single "Enrol passkey" button. On
//      click, runs the WebAuthn `credentials.create` ceremony. The OS
//      prompts the user (Touch ID / Windows Hello / hardware key /
//      etc). On success, the card flips to state 3.
//
//   3. Enrolment present — show the credentialId prefix, enrolment
//      date, and a "Remove passkey" button. No automatic re-enrolment
//      and no surprises.
//
// Honesty rules
// ─────────────
//   • If the user denies the OS prompt, the card surfaces a clear
//     "Cancelled — try again or skip" message rather than silently
//     downgrading to the session key. The page-level UX (in
//     IssueReceiptCard) is what handles the explicit "use session key
//     instead" choice.
//   • The card never claims that enrolment is "secure beyond all
//     doubt" — it cites HONESTY.md §3.2's caveats inline.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import {
  clearEnrolment,
  enrolPasskey,
  getEnrolment,
  isPasskeySupported,
  subscribePasskey,
  PasskeyError,
  type PasskeyEnrolment,
} from "@/lib/crypto/passkey";

type CardState =
  | { kind: "unsupported" }
  | { kind: "loading" }
  | { kind: "ready"; enrolment: PasskeyEnrolment | null }
  | { kind: "enrolling" }
  | { kind: "error"; message: string };

export default function PasskeyEnrolCard() {
  const [state, setState] = useState<CardState>({ kind: "loading" });

  useEffect(() => {
    if (!isPasskeySupported()) {
      setState({ kind: "unsupported" });
      return;
    }
    setState({ kind: "ready", enrolment: getEnrolment() });
    const unsub = subscribePasskey((e) =>
      setState({ kind: "ready", enrolment: e }),
    );
    return unsub;
  }, []);

  const onEnrol = async () => {
    setState({ kind: "enrolling" });
    try {
      await enrolPasskey();
      // notifyEnrolment fires inside enrolPasskey → subscribePasskey
      // delivers the new value; no need to setState here.
    } catch (e) {
      const message =
        e instanceof PasskeyError
          ? e.code === "cancelled"
            ? "You cancelled the prompt. You can try again any time, or skip this and keep using the session key."
            : e.message
          : "Could not enrol a passkey on this device.";
      setState({ kind: "error", message });
    }
  };

  const onRemove = () => {
    clearEnrolment();
    setState({ kind: "ready", enrolment: null });
  };

  return (
    <section className="kl-card" aria-labelledby="passkey-enrol-title">
      <header className="flex items-center gap-2 mb-3">
        <KeyRound size={16} style={{ color: "var(--accent)" }} aria-hidden="true" />
        <h3 id="passkey-enrol-title" className="text-sm font-semibold">
          Passkey signing key
        </h3>
      </header>

      <p
        className="text-xs mb-3"
        style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
      >
        Bind your future signed receipts to a passkey on this device
        (Touch ID, Windows Hello, hardware key). The private key never
        leaves your device. You can keep using the session key instead
        — this is opt-in.
      </p>

      <Body
        state={state}
        onEnrol={onEnrol}
        onRemove={onRemove}
        clearError={() =>
          setState({ kind: "ready", enrolment: getEnrolment() })
        }
      />

      <p
        className="font-mono mt-3"
        style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.05em" }}
      >
        WebAuthn · ECDSA P-256 · device-resident · v1.4.11
      </p>
    </section>
  );
}

function Body({
  state,
  onEnrol,
  onRemove,
  clearError,
}: {
  state: CardState;
  onEnrol: () => void;
  onRemove: () => void;
  clearError: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <div
        className="text-xs"
        style={{ color: "var(--fg-faint)", padding: "8px 0" }}
      >
        Checking browser support…
      </div>
    );
  }

  if (state.kind === "unsupported") {
    return (
      <div
        className="text-xs rounded-md p-2"
        role="status"
        style={{
          background: "var(--bg-deep)",
          border: "1px solid var(--border)",
          color: "var(--fg-dim)",
          lineHeight: 1.55,
        }}
      >
        <ShieldOff
          size={12}
          aria-hidden="true"
          style={{
            display: "inline",
            verticalAlign: "-2px",
            marginRight: 6,
            color: "var(--fg-faint)",
          }}
        />
        Passkey signing is not available in this browser. Receipts will
        continue to be signed with the per-tab session key.
      </div>
    );
  }

  if (state.kind === "enrolling") {
    return (
      <div className="text-xs" style={{ color: "var(--fg-dim)" }}>
        Waiting for your device to confirm…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="space-y-2">
        <div
          className="text-xs rounded-md p-2"
          role="alert"
          style={{
            background: "rgba(229, 82, 74, 0.08)",
            border: "1px solid var(--red, #b14a44)",
            color: "var(--red, #b14a44)",
            lineHeight: 1.55,
          }}
        >
          {state.message}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEnrol}
            className="kl-tap-target rounded-md px-3 py-2 text-xs"
            style={{
              background: "var(--accent)",
              color: "var(--paper)",
              minHeight: 36,
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={clearError}
            className="kl-tap-target rounded-md px-3 py-2 text-xs"
            style={{
              background: "transparent",
              color: "var(--fg-faint)",
              minHeight: 36,
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // state.kind === "ready"
  if (!state.enrolment) {
    return (
      <button
        type="button"
        onClick={onEnrol}
        className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 w-full justify-center"
        style={{
          background: "var(--accent)",
          color: "var(--paper)",
          minHeight: 44,
        }}
        aria-label="Enrol a device passkey for signing receipts"
      >
        <KeyRound size={14} aria-hidden="true" /> Enrol passkey
      </button>
    );
  }

  // Enrolled.
  const credShort = state.enrolment.credentialIdB64url.slice(0, 12) + "…";
  return (
    <div className="space-y-2">
      <div
        className="text-xs rounded-md p-2"
        style={{
          background: "var(--accent-soft, rgba(125, 175, 155, 0.10))",
          border: "1px solid var(--accent)",
          color: "var(--fg)",
          lineHeight: 1.55,
        }}
      >
        <ShieldCheck
          size={12}
          aria-hidden="true"
          style={{
            display: "inline",
            verticalAlign: "-2px",
            marginRight: 6,
            color: "var(--accent)",
          }}
        />
        Passkey enrolled. Receipts can now be bound to this device.
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <div style={{ color: "var(--fg-dim)" }}>
          credential id <code className="font-mono">{credShort}</code>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="kl-tap-target rounded-md px-2 py-1 text-xs"
          style={{
            background: "transparent",
            color: "var(--fg-faint)",
            border: "1px solid var(--border)",
            minHeight: 32,
          }}
          aria-label="Remove the passkey enrolment from this device"
        >
          Remove
        </button>
      </div>
      <div
        className="text-xs"
        style={{ color: "var(--fg-faint)", lineHeight: 1.5 }}
      >
        Enrolled {new Date(state.enrolment.enrolledAtIso).toLocaleString()}.
        The passkey itself is held by your device or password manager —
        the app cannot read or export it.
      </div>
    </div>
  );
}
