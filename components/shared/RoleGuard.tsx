"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/RoleGuard.tsx
//
// v1.6.0 — audit H-1. Challenge screen for the privileged surfaces.
// Below the hood this component now talks to `/api/auth/role-*` via the
// helpers in `lib/auth/role-guard.ts`; the server sets an HttpOnly signed
// cookie and the Edge middleware in `middleware.ts` does the actual
// gating. This component is display-only UX — it does NOT itself decide
// who is authorised.
//
// The passkey button is currently disabled with an explanatory tooltip:
// passkey sign-in requires server-side public-key enrolment (a backend),
// which arrives with todo d1-backend. The previous v1.5.x implementation
// forged a local unlock by writing sessionStorage from the browser; that
// was the exact bypass path H-1 flagged and it has been removed.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import { Lock, ShieldAlert, Fingerprint } from "lucide-react";
import { isUnlocked, tryUnlock, lock, type ProtectedRole } from "@/lib/auth/role-guard";
import { isPasskeySupported } from "@/lib/crypto/passkey";

interface Props {
  role: ProtectedRole;
  roleLabel: string;
  children: ReactNode;
  /** Demo default passphrase to show under the input. Omit in production. */
  demoHint?: string;
}

export default function RoleGuard({ role, roleLabel, children, demoHint }: Props) {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempting, setAttempting] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMounted(true);
    setPasskeySupported(isPasskeySupported());
    // isUnlocked() now hits /api/auth/role-status. Safe to call on mount;
    // the endpoint is cheap and returns a single boolean per role.
    (async () => {
      const ok = await isUnlocked(role);
      if (!cancelled) setUnlocked(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  function handlePasskeyLogin() {
    // v1.6.0 — audit H-1. The previous passkey path set sessionStorage
    // directly, which let a child bypass the gate via devtools. True
    // passkey sign-in requires the server to hold the credential public
    // key and challenge/verify it, which lands with todo d1-backend.
    setError(
      "Passkey sign-in arrives with the multi-tenant backend (v1.7). For now please use the passphrase.",
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempting(true);
    setError(null);
    const ok = await tryUnlock(role, passphrase);
    setAttempting(false);
    if (ok) {
      setUnlocked(true);
      setPassphrase("");
      // Reload so the Edge middleware re-evaluates and the privileged
      // route actually renders. (`unlocked = true` alone would render
      // the children tree only on this tab, but a refresh also picks
      // up any server-rendered role-specific data.)
      window.location.reload();
    } else {
      setError("Incorrect passphrase.");
    }
  }

  async function onLock() {
    await lock(role);
    setUnlocked(false);
    window.location.reload();
  }

  // Avoid SSR/CSR mismatch for sessionStorage-dependent UI.
  if (!mounted) return null;

  if (unlocked) {
    return (
      <>
        {children}
        <div
          style={{
            position: "fixed",
            bottom: 12,
            right: 12,
            zIndex: 50,
            fontSize: 11,
          }}
        >
          <button
            onClick={onLock}
            className="font-mono rounded-md px-3 py-1.5"
            style={{
              background: "var(--bg-deep)",
              border: "1px solid var(--border)",
              color: "var(--fg-muted)",
              cursor: "pointer",
            }}
            aria-label={`Lock ${roleLabel} surface`}
          >
            <Lock size={10} style={{ display: "inline", marginRight: 4 }} />
            Lock surface
          </button>
        </div>
      </>
    );
  }

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
          maxWidth: 440,
          width: "100%",
          padding: 28,
          borderRadius: 12,
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <ShieldAlert size={20} style={{ color: "var(--accent)" }} />
          <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0, color: "var(--fg)" }}>
            {roleLabel} surface — passphrase required
          </h1>
        </div>

        <p style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 20, lineHeight: 1.55 }}>
          This surface is for authorised personnel only. Passphrase is
          verified on the server and a short-lived HttpOnly cookie is set
          on success; see <code>SAFEGUARDING.md</code> §3.
        </p>

        <form onSubmit={onSubmit}>
          <label
            htmlFor="role-passphrase"
            style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", marginBottom: 6 }}
          >
            Passphrase
          </label>
          <input
            id="role-passphrase"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={attempting}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "var(--font-mono, monospace)",
              background: "var(--bg-deep)",
              border: `1px solid ${error ? "var(--danger, #e74c3c)" : "var(--border)"}`,
              borderRadius: 6,
              color: "var(--fg)",
            }}
          />
          {error && (
            <div
              role="alert"
              style={{ color: "var(--danger, #e74c3c)", fontSize: 12, marginTop: 8 }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={attempting || passphrase.length === 0}
            style={{
              marginTop: 16,
              width: "100%",
              padding: "10px 14px",
              background: "var(--accent)",
              color: "var(--accent-fg, #fff)",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: attempting ? "wait" : "pointer",
              opacity: attempting || passphrase.length === 0 ? 0.6 : 1,
            }}
          >
            {attempting ? "Checking…" : "Unlock"}
          </button>
        </form>

        {passkeySupported && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ margin: "0 10px", fontSize: 12, color: "var(--fg-muted)" }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={attempting}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: "var(--bg-deep)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: attempting ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                opacity: attempting ? 0.6 : 1,
              }}
            >
              <Fingerprint size={16} />
              Sign in with Passkey
            </button>
          </div>
        )}

        {demoHint && (
          <p
            style={{
              marginTop: 20,
              fontSize: 11,
              color: "var(--fg-muted)",
              lineHeight: 1.55,
              padding: 10,
              background: "var(--bg-deep)",
              borderRadius: 6,
              border: "1px dashed var(--border)",
            }}
          >
            <strong>Demo hint:</strong> {demoHint}. Override in production
            via <code>ROLE_GUARD_{role.toUpperCase()}_PASSPHRASE</code> and
            set <code>ROLE_GUARD_SECRET</code> (32+ bytes) before deploying.
          </p>
        )}
      </div>
    </div>
  );
}
