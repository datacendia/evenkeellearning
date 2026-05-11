"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/receipt/[id]/page.tsx
//
// The verifier landing page for v1.4.6 Signed Learning Receipts. The URL
// a learner shares with their teacher (or, eventually, an FE college /
// exam board). Three render states:
//
//   1. Receipt found locally → render the payload as a structured card,
//      offer a one-click "Verify signature" action that re-derives the
//      digest and runs ECDSA verify entirely in this browser, and show
//      the full signed envelope as JSON for download / archive.
//   2. Receipt NOT found locally → show an Import block with a textarea
//      where the recipient can paste the JSON envelope they received
//      out-of-band. Verification then runs the same way.
//   3. Imported but signature invalid → keep the imported copy visible
//      with a clearly-labelled "INVALID" badge so the recipient knows
//      something is wrong, rather than silently bin it.
//
// Phase-1 honesty
// ───────────────
//   • Receipts are signed with the learner's per-session ECDSA key from
//     `lib/crypto/signing.ts`. The key is not yet bound to a persistent
//     account — Phase 2 swaps it for a passkey-derived key. The verifier
//     therefore confirms *the receipt has not been tampered with since
//     signing*, not *the named learner cryptographically owns it*. See
//     HONESTY.md.
//   • No server is contacted. Verification is local SubtleCrypto. The
//     UI says so explicitly.
// ─────────────────────────────────────────────────────────────────────────────

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldOff, Upload, Download, ArrowLeft } from "lucide-react";
import {
  getReceipt,
  importReceiptJson,
  verifyReceipt,
  type SignedLearningReceipt,
} from "@/lib/receipts/learning-receipt";

type VerifyState = "idle" | "ok" | "fail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ReceiptVerifierPage(props: PageProps) {
  // Next.js 14+ async params API. The `use()` hook unwraps the promise.
  const { id } = use(props.params);

  const [receipt, setReceipt] = useState<SignedLearningReceipt | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifying, setVerifying] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const local = getReceipt(id);
    setReceipt(local ?? null);
    setHydrated(true);
  }, [id]);

  const onVerify = async () => {
    if (!receipt) return;
    setVerifying(true);
    try {
      const ok = await verifyReceipt(receipt);
      setVerifyState(ok ? "ok" : "fail");
    } catch {
      setVerifyState("fail");
    } finally {
      setVerifying(false);
    }
  };

  const onImport = () => {
    setImportError(null);
    const trimmed = importText.trim();
    if (!trimmed) {
      setImportError("Paste the receipt JSON above first.");
      return;
    }
    const imported = importReceiptJson(trimmed);
    if (!imported) {
      setImportError(
        "That doesn't look like a valid receipt JSON envelope. Check you copied the whole block, including the curly braces.",
      );
      return;
    }
    if (imported.id !== id) {
      setImportError(
        `Imported a receipt, but its id (${imported.id}) doesn't match this URL (${id}). Either open the right URL, or import the JSON for the right receipt.`,
      );
      // Still surface it so the recipient sees what they imported.
    }
    setReceipt(imported);
    setVerifyState("idle");
  };

  const onDownload = () => {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `learning-receipt-${receipt.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Link
          href="/"
          className="text-xs inline-flex items-center gap-1 mb-4"
          style={{ color: "var(--fg-dim)" }}
        >
          <ArrowLeft size={12} aria-hidden="true" /> Back to home
        </Link>

        <h1 className="font-serif text-2xl mb-2" style={{ color: "var(--fg)" }}>
          Learning Receipt
        </h1>
        <p className="text-sm mb-1" style={{ color: "var(--fg-dim)" }}>
          Receipt id <code className="font-mono">{id}</code>
        </p>
        <p
          className="text-xs mb-6"
          style={{ color: "var(--fg-faint)", lineHeight: 1.55 }}
        >
          Verification runs entirely in this browser using the ECDSA
          P-256 signature embedded in the receipt. No server is
          contacted. No account is required.
        </p>

        {!hydrated ? (
          <SkeletonCard />
        ) : !receipt ? (
          <ImportBlock
            importText={importText}
            setImportText={setImportText}
            onImport={onImport}
            importError={importError}
          />
        ) : (
          <ReceiptCard
            receipt={receipt}
            verifyState={verifyState}
            verifying={verifying}
            onVerify={onVerify}
            onDownload={onDownload}
            mismatch={receipt.id !== id}
          />
        )}
      </div>
    </main>
  );
}

function SkeletonCard() {
  return (
    <div
      className="kl-card"
      style={{ height: 120, opacity: 0.5 }}
      aria-busy="true"
      aria-label="Loading receipt"
    />
  );
}

function ImportBlock({
  importText,
  setImportText,
  onImport,
  importError,
}: {
  importText: string;
  setImportText: (v: string) => void;
  onImport: () => void;
  importError: string | null;
}) {
  return (
    <div className="kl-card">
      <h2
        className="text-sm font-semibold mb-2"
        style={{ color: "var(--fg)" }}
      >
        No local copy found
      </h2>
      <p
        className="text-xs mb-3"
        style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}
      >
        This device doesn&apos;t have a copy of receipt{" "}
        <code className="font-mono">{}</code>. If the learner sent you the
        JSON envelope, paste it below to verify it locally.
      </p>
      <label className="sr-only" htmlFor="receipt-json">
        Receipt JSON envelope
      </label>
      <textarea
        id="receipt-json"
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder='{"id":"...","issuedAtIso":"...","envelope":{...}}'
        className="w-full rounded-md p-2 text-xs font-mono"
        style={{
          background: "var(--bg-deep)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
          minHeight: 160,
          resize: "vertical",
        }}
      />
      {importError && (
        <p
          className="text-xs mt-2"
          style={{ color: "var(--hub-danger, var(--red))", lineHeight: 1.5 }}
        >
          {importError}
        </p>
      )}
      <button
        type="button"
        onClick={onImport}
        className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 mt-3"
        style={{
          background: "var(--accent)",
          color: "var(--paper)",
          minHeight: 44,
        }}
      >
        <Upload size={14} aria-hidden="true" /> Import & verify
      </button>
    </div>
  );
}

function ReceiptCard({
  receipt,
  verifyState,
  verifying,
  onVerify,
  onDownload,
  mismatch,
}: {
  receipt: SignedLearningReceipt;
  verifyState: VerifyState;
  verifying: boolean;
  onVerify: () => void;
  onDownload: () => void;
  mismatch: boolean;
}) {
  const p = receipt.envelope.payload;
  const env = receipt.envelope;
  const sigShort = useMemo(
    () => `${env.signatureB64url.slice(0, 12)}…`,
    [env.signatureB64url],
  );
  const pkShort = useMemo(
    () => `${env.publicKeyB64url.slice(0, 12)}…`,
    [env.publicKeyB64url],
  );

  return (
    <>
      {mismatch && (
        <div
          className="kl-card mb-4"
          role="alert"
          style={{
            background: "rgba(245, 166, 35, 0.10)",
            border: "1px solid var(--hub-warning)",
          }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
            Imported receipt id does not match this URL
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
          >
            You can still verify the cryptographic signature below, but
            it&apos;s for a different receipt than the one this URL
            references.
          </p>
        </div>
      )}

      <div className="kl-card mb-4">
        <header className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
            Work summary
          </h2>
          <span
            className="kl-badge"
            style={{ background: "var(--bg-deep)", color: "var(--fg-dim)" }}
          >
            schema v{p.schemaVersion}
          </span>
        </header>

        <Field label="Learner" value={p.learnerInitials} />
        <Field label="Problem" value={p.problemTitle} />
        <Field label="Problem id" value={p.problemId} mono />
        {p.skillFamily && <Field label="Skill family" value={p.skillFamily} mono />}
        <Field label="Jurisdiction" value={p.jurisdiction} />
        <Field label="Issued at" value={p.issuedAtIso} mono />

        <Divider />

        <Field label="Attempts" value={String(p.attemptsTotal)} />
        <Field
          label="First correct on attempt"
          value={p.correctOnAttempt !== null ? String(p.correctOnAttempt) : "—"}
        />
        <Field label="Max hint tier" value={`${p.hintTierMax} of 4`} />
        <Field label="Comprehension gate" value={p.gateCleared ? "cleared" : "not cleared"} />
        <Field label="Leitner box" value={`${p.leitnerBox} of 5`} />
        {/* v1.5.5 — H-5: see IssueReceiptCard for rationale. The payload
            field name stays `trustScore` because changing it would
            invalidate every signature ever issued; the verifier UI
            relabels it to match the issuer UI. */}
        <Field label="Input consistency" value={`${p.trustScore} of 100`} />
        <Field label="Paste attempts" value={String(p.pasteAttempts)} />
        <Field label="Practice sessions" value={String(p.practiceSessionsCount)} />

        <Divider />

        <p
          className="text-xs font-semibold"
          style={{ color: "var(--fg-dim)", marginBottom: 6 }}
        >
          Validated-attempt category counts
        </p>
        <Field label="Correct" value={String(p.categoryCounts.correct)} />
        <Field label="Sign-flip" value={String(p.categoryCounts.sign_flipped)} />
        <Field label="Off-by-one" value={String(p.categoryCounts.off_by_one)} />
        <Field label="Doubled coefficient" value={String(p.categoryCounts.doubled)} />
        <Field label="Halved term" value={String(p.categoryCounts.halved)} />
        <Field label="Method drift" value={String(p.categoryCounts.wrong)} />
      </div>

      <div className="kl-card mb-4">
        <header className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
            Cryptographic signature
          </h2>
          <div className="flex items-center gap-1.5">
            <span
              className="kl-badge"
              style={{
                background:
                  env.keyType === "passkey-derived"
                    ? "var(--accent-soft)"
                    : "var(--bg-deep)",
                color:
                  env.keyType === "passkey-derived"
                    ? "var(--accent-ink, var(--accent))"
                    : "var(--fg-dim)",
                border:
                  env.keyType === "passkey-derived"
                    ? "1px solid var(--accent)"
                    : "none",
              }}
              title={
                env.keyType === "passkey-derived"
                  ? "Signed with a WebAuthn passkey bound to this device/account."
                  : "Signed with a per-browser-session ECDSA key (no identity binding)."
              }
            >
              {env.keyType === "passkey-derived" ? "passkey" : "session key"}
            </span>
            <span
              className="kl-badge"
              style={{ background: "var(--bg-deep)", color: "var(--fg-dim)" }}
            >
              {env.algorithm}
            </span>
          </div>
        </header>
        <Field label="Signed at" value={env.signedAtIso} mono />
        <Field label="Signature" value={sigShort} mono />
        <Field label="Public key" value={pkShort} mono />
        {env.webauthn?.credentialIdB64url && (
          <Field
            label="Credential id"
            value={env.webauthn.credentialIdB64url.slice(0, 12) + "…"}
            mono
          />
        )}
        <Field label="Content digest" value={env.contentDigestB64url.slice(0, 16) + "…"} mono />

        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying}
            className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5"
            style={{
              background:
                verifyState === "ok"
                  ? "var(--accent-soft)"
                  : verifyState === "fail"
                  ? "rgba(229, 82, 74, 0.12)"
                  : "var(--accent)",
              color:
                verifyState === "ok"
                  ? "var(--accent-ink, var(--accent))"
                  : verifyState === "fail"
                  ? "var(--red)"
                  : "var(--paper)",
              border:
                verifyState === "ok"
                  ? "1px solid var(--accent)"
                  : verifyState === "fail"
                  ? "1px solid var(--red)"
                  : "none",
              minHeight: 44,
              opacity: verifying ? 0.6 : 1,
            }}
            aria-label="Verify the receipt signature locally"
          >
            {verifyState === "ok" ? (
              <>
                <ShieldCheck size={14} aria-hidden="true" /> Signature valid ✓
              </>
            ) : verifyState === "fail" ? (
              <>
                <ShieldOff size={14} aria-hidden="true" /> Signature INVALID
              </>
            ) : (
              <>
                <ShieldCheck size={14} aria-hidden="true" />
                {verifying ? "Verifying…" : "Verify signature"}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5"
            style={{
              background: "var(--bg-deep)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              minHeight: 44,
            }}
          >
            <Download size={14} aria-hidden="true" /> Download JSON
          </button>
        </div>
      </div>

      {env.keyType === "passkey-derived" ? (
        <p
          className="text-xs"
          style={{ color: "var(--fg-faint)", lineHeight: 1.55 }}
        >
          Passkey-bound signature: this receipt was signed with a
          WebAuthn passkey the learner enrolled on their device. A
          valid signature proves the receipt has not been tampered
          with since signing <strong>and</strong> that it was signed
          by whoever controls that passkey. Identity binding is as
          strong as the learner&apos;s device / authenticator.
          See HONESTY.md.
        </p>
      ) : (
        <p
          className="text-xs"
          style={{ color: "var(--fg-faint)", lineHeight: 1.55 }}
        >
          Session-key signature: the signing key was generated per
          browser session and is <strong>not</strong> bound to a
          persistent learner identity. A valid signature here proves
          the receipt has not been tampered with since signing, but
          does not cryptographically prove that the named learner
          owns it. For identity-bound receipts, the learner can
          enrol a passkey on the student page and re-issue.
          See HONESTY.md.
        </p>
      )}
    </>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span style={{ color: "var(--fg-dim)" }}>{label}</span>
      <span
        className={mono ? "font-mono" : ""}
        style={{ color: "var(--fg)", textAlign: "right", wordBreak: "break-all" }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: 1,
        background: "var(--border)",
        margin: "12px 0",
      }}
    />
  );
}
