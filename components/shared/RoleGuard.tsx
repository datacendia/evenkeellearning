"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/RoleGuard.tsx
//
// Client-side passphrase gate for the privileged surfaces. Wraps the page
// content and shows a challenge screen until the tab is unlocked.
//
// Labelled "(demo gate)" in the UI because it is exactly that — not WebAuthn,
// not OAuth, not SSO. See `lib/auth/role-guard.ts` for the contract and
// SAFEGUARDING.md §3 for why it is not a substitute for real authentication.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import { Lock, ShieldAlert, Fingerprint } from "lucide-react";
import { isUnlocked, tryUnlock, lock, type ProtectedRole } from "@/lib/auth/role-guard";
import { isPasskeySupported, signPayloadWithPasskey, PasskeyError } from "@/lib/crypto/passkey";

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
    setMounted(true);
    setUnlocked(isUnlocked(role));
    setPasskeySupported(isPasskeySupported());
  }, [role]);

  async function handlePasskeyLogin() {
    setAttempting(true);
    setError(null);
    try {
      // In a real backend, we'd fetch a challenge from the server.
      // Here we sign a local dummy payload to verify the user is present.
      await signPayloadWithPasskey({ action: "login", role });
      
      // If the passkey assertion succeeds, we unlock the session.
      // Note: We bypass the passphrase check here by forcing the session to unlock.
      window.sessionStorage.setItem("evenkeel/role-guard/" + role, "unlocked");
      setUnlocked(true);
    } catch (e) {
      if (e instanceof PasskeyError) {
        if (e.code === "no_enrolment") {
          setError("No passkey enrolled on this device. Please use the passphrase.");
        } else if (e.code !== "cancelled") {
          setError(`Passkey error: ${e.message}`);
        }
      } else {
        setError("An unexpected error occurred during passkey sign-in.");
      }
    } finally {
      setAttempting(false);
    }
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
    } else {
      setError("Incorrect passphrase.");
    }
  }

  function onLock() {
    lock(role);
    setUnlocked(false);
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
          This surface is for authorised personnel only. The demo uses a
          passphrase gate; production deployments must replace this with
          WebAuthn passkeys. See <code>SAFEGUARDING.md</code>.
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
            <strong>Demo hint:</strong> {demoHint}. Replace this with a real
            passphrase via <code>NEXT_PUBLIC_{role.toUpperCase()}_PASSPHRASE</code>{" "}
            before deploying.
          </p>
        )}
      </div>
    </div>
  );
}
