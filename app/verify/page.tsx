"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/verify/page.tsx
//
// v1.7.2 — STANDALONE verifier web app (vc3-verifier).
//
// Purpose
// ───────
// A public, role-free page where ANYONE — a college admissions officer, a
// parent, a regulator, a future employer — can paste a credential a learner
// has handed them and check whether it is genuine.
//
// PUBLIC by design
// ────────────────
// This surface is intentionally NOT behind RoleGuard. A verifier that
// requires a session against the issuer's own server is not a verifier;
// the issuer could simply lie. All verification runs in the browser
// against the credential's embedded public key, exactly as a third-party
// verifier elsewhere would do it.
//
// Inputs
// ──────
//   1. Credential JSON (required) — paste the VC document the learner
//      shows you.
//   2. Status list (optional) — paste either:
//        - the raw `encodedList` string from the issuer's
//          StatusList2021Credential, or
//        - the full StatusList2021Credential JSON.
//      If empty AND the credential carries a credentialStatus pointer,
//      we report "revocation: not checked" rather than silently passing.
//
// Demo button
// ───────────
// "Load demo fixture" uses the in-process issuer + status registry to mint
// a fresh, self-consistent VC + status list pair. Lets a first-time user
// see a green verdict without bringing their own credential. It is NOT a
// production credential — every reload mints a new one.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import JsonViewer from "@/components/shared/JsonViewer";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ScrollText,
  Sparkles,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { verifyCredential, type VcVerificationResult } from "@/lib/vc/verifier";
import {
  parseCredentialFromPaste,
  extractEncodedListFromPaste,
  summarizeCredentialForDisplay,
  describeReason,
  describePasteReason,
  type CredentialDisplaySummary,
  type PasteParseReason,
} from "@/lib/vc/standalone-verifier-helpers";
import { issueVerifiableCredential } from "@/lib/vc/issuer";
import { signPayload } from "@/lib/crypto/signing";
import { createStatusRegistry } from "@/lib/vc/status-registry";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";

type RunStatus =
  | { stage: "idle" }
  | { stage: "running" }
  | {
      stage: "done";
      verdict: "valid" | "valid-but-revocation-skipped" | "invalid";
      summary: CredentialDisplaySummary | null;
      result: VcVerificationResult;
      revocationSkippedReason: string | null;
      pasteError: { reason: PasteParseReason; detail?: string } | null;
      statusPasteError: { reason: PasteParseReason; detail?: string } | null;
    };

const DEMO_DEFAULT_LIST_URL = "https://demo.evenkeel.org/sl/2026A";
const DEMO_DEFAULT_ISSUER = "did:web:demo.evenkeel.org";

export default function VerifyPage() {
  const [credentialPaste, setCredentialPaste] = useState("");
  const [statusListPaste, setStatusListPaste] = useState("");
  const [allowedListUrlsInput, setAllowedListUrlsInput] = useState("");
  const [run, setRun] = useState<RunStatus>({ stage: "idle" });
  const [demoFlippedRevoked, setDemoFlippedRevoked] = useState(false);

  const allowedListUrls = useMemo<string[]>(() => {
    return allowedListUrlsInput
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [allowedListUrlsInput]);

  const handleVerify = useCallback(async () => {
    setRun({ stage: "running" });

    const credParse = parseCredentialFromPaste(credentialPaste);
    if (!credParse.ok) {
      setRun({
        stage: "done",
        verdict: "invalid",
        summary: null,
        result: { ok: false, reason: "not_an_object" },
        revocationSkippedReason: null,
        pasteError: { reason: credParse.reason, detail: credParse.detail },
        statusPasteError: null,
      });
      return;
    }
    const credential = credParse.value;
    const summary = summarizeCredentialForDisplay(credential);

    let revocationSkippedReason: string | null = null;
    let statusPasteError: { reason: PasteParseReason; detail?: string } | null =
      null;
    let resolver: ((url: string) => Promise<string>) | undefined;

    if (summary.hasRevocationPointer) {
      const slParse = extractEncodedListFromPaste(statusListPaste);
      if (!slParse.ok) {
        if (slParse.reason === "empty") {
          revocationSkippedReason =
            "No status list pasted. Revocation cannot be checked.";
        } else {
          statusPasteError = { reason: slParse.reason, detail: slParse.detail };
          revocationSkippedReason =
            "Status list paste was malformed. Revocation cannot be checked.";
        }
      } else {
        const enc = slParse.value;
        resolver = async () => enc;
      }
    }

    const result = await verifyCredential(credential, {
      ...(resolver ? { statusListResolver: resolver } : {}),
      ...(allowedListUrls.length > 0
        ? { allowedStatusListUrls: allowedListUrls }
        : {}),
    });

    let verdict: "valid" | "valid-but-revocation-skipped" | "invalid";
    if (result.ok) {
      verdict =
        summary.hasRevocationPointer && revocationSkippedReason
          ? "valid-but-revocation-skipped"
          : "valid";
    } else {
      verdict = "invalid";
    }

    setRun({
      stage: "done",
      verdict,
      summary,
      result,
      revocationSkippedReason,
      pasteError: null,
      statusPasteError,
    });
  }, [credentialPaste, statusListPaste, allowedListUrls]);

  const handleClear = useCallback(() => {
    setCredentialPaste("");
    setStatusListPaste("");
    setAllowedListUrlsInput("");
    setRun({ stage: "idle" });
    setDemoFlippedRevoked(false);
  }, []);

  const handleLoadDemo = useCallback(
    async (flavor: "valid" | "revoked") => {
      const fixture = await mintDemoFixture(flavor);
      setCredentialPaste(JSON.stringify(fixture.credential, null, 2));
      setStatusListPaste(fixture.encodedList);
      setAllowedListUrlsInput(DEMO_DEFAULT_LIST_URL);
      setRun({ stage: "idle" });
      setDemoFlippedRevoked(flavor === "revoked");
    },
    [],
  );

  return (
    <SurfaceShell theme="paper" surfaceLabel="Verify a Credential">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-7 w-7 text-emerald-700" />
            <h1 className="text-2xl font-semibold">Standalone Credential Verifier</h1>
          </div>
          <p className="text-sm text-slate-600">
            Paste a credential a learner has shown you. Verification runs
            entirely in your browser using the credential&apos;s embedded
            public key. No call is made to any Even Keel server.
          </p>
          <p className="text-xs text-slate-500">
            v1.7.2 (vc3-verifier) · supports W3C VC 2.0 with{" "}
            <code>EvenKeelAttestationCredential</code> and StatusList2021
            revocation.
          </p>
        </header>

        <DemoButtons onLoad={handleLoadDemo} flipped={demoFlippedRevoked} />

        <section className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
          <label
            htmlFor="cred-paste"
            className="mb-1 block text-sm font-semibold text-slate-700"
          >
            1. Credential JSON
          </label>
          <p className="mb-2 text-xs text-slate-500">
            The full VerifiableCredential document the learner shows you.
            Required.
          </p>
          <textarea
            id="cred-paste"
            value={credentialPaste}
            onChange={(e) => setCredentialPaste(e.target.value)}
            spellCheck={false}
            placeholder={`{\n  "@context": ["https://www.w3.org/ns/credentials/v2"],\n  "type": ["VerifiableCredential", "EvenKeelAttestationCredential"],\n  ...\n}`}
            className="h-44 w-full resize-y rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs"
          />
        </section>

        <section className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
          <label
            htmlFor="sl-paste"
            className="mb-1 block text-sm font-semibold text-slate-700"
          >
            2. Status list (optional)
          </label>
          <p className="mb-2 text-xs text-slate-500">
            If the credential carries a <code>credentialStatus</code> pointer,
            paste either the raw <code>encodedList</code> string or the full
            StatusList2021Credential JSON. Leave empty to skip revocation
            checks (the credential&apos;s signature will still be verified).
          </p>
          <textarea
            id="sl-paste"
            value={statusListPaste}
            onChange={(e) => setStatusListPaste(e.target.value)}
            spellCheck={false}
            placeholder={`H4sIAAAAAAAAA... (gzip + base64url of the bitstring)\nor\n{ "@context": [...], "type": [..., "StatusList2021Credential"], ... }`}
            className="h-32 w-full resize-y rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs"
          />
        </section>

        <section className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
          <label
            htmlFor="allow-paste"
            className="mb-1 block text-sm font-semibold text-slate-700"
          >
            3. Allowlist of status list URLs (optional)
          </label>
          <p className="mb-2 text-xs text-slate-500">
            Defends against an attacker substituting a friendly status list of
            their own. Comma- or newline-separated. Has no effect if the
            credential carries no revocation pointer.
          </p>
          <textarea
            id="allow-paste"
            value={allowedListUrlsInput}
            onChange={(e) => setAllowedListUrlsInput(e.target.value)}
            spellCheck={false}
            placeholder="https://issuer.example.org/sl/2026A"
            className="h-16 w-full resize-y rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs"
          />
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleVerify}
            disabled={run.stage === "running" || credentialPaste.trim().length === 0}
            className="inline-flex items-center gap-2 rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {run.stage === "running" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Verify
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>

        {run.stage === "done" && <ResultPanel run={run} />}

        <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500">
          <p>
            Source:{" "}
            <code>lib/vc/verifier.ts</code> &middot;{" "}
            <code>lib/vc/status-list.ts</code>. Verification logic is
            open-source. The credential&apos;s embedded public key is the
            only authority consulted; this page never calls back to any
            issuer-controlled server.
          </p>
        </footer>
      </div>
    </SurfaceShell>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DemoButtons({
  onLoad,
  flipped,
}: {
  onLoad: (flavor: "valid" | "revoked") => Promise<void>;
  flipped: boolean;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold text-amber-900">
        <Sparkles className="h-4 w-4" />
        Try the verifier with a fresh demo fixture
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onLoad("valid")}
          className="rounded border border-amber-700 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          Load valid VC + clean status list
        </button>
        <button
          type="button"
          onClick={() => onLoad("revoked")}
          className="rounded border border-amber-700 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          Load valid VC + REVOKED status list
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-800">
        Mints a brand-new, self-signed VC + matching StatusList2021Credential
        in your browser using the in-process session key. Not a production
        credential.
        {flipped && (
          <>
            {" "}
            <strong>The status list is the &quot;revoked&quot; flavor — you
            should see verification fail with credential_revoked.</strong>
          </>
        )}
      </p>
    </div>
  );
}

function ResultPanel({ run }: { run: Extract<RunStatus, { stage: "done" }> }) {
  const verdictClass =
    run.verdict === "valid"
      ? "border-emerald-600 bg-emerald-50 text-emerald-900"
      : run.verdict === "valid-but-revocation-skipped"
      ? "border-amber-600 bg-amber-50 text-amber-900"
      : "border-rose-600 bg-rose-50 text-rose-900";

  const VerdictIcon =
    run.verdict === "valid"
      ? CheckCircle2
      : run.verdict === "valid-but-revocation-skipped"
      ? AlertTriangle
      : XCircle;

  const verdictLabel =
    run.verdict === "valid"
      ? "VALID — signature checks out and is not revoked."
      : run.verdict === "valid-but-revocation-skipped"
      ? "Signature is valid, but revocation was NOT checked."
      : "INVALID — do not trust this credential.";

  return (
    <section
      className={`space-y-4 rounded-md border-2 p-4 ${verdictClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <VerdictIcon className="mt-0.5 h-7 w-7 flex-shrink-0" />
        <div>
          <h2 className="text-lg font-semibold">{verdictLabel}</h2>
          {run.pasteError && (
            <p className="mt-1 text-sm">
              {describePasteReason(run.pasteError.reason)}
              {run.pasteError.detail && (
                <span className="ml-1 font-mono text-xs">
                  ({run.pasteError.detail})
                </span>
              )}
            </p>
          )}
          {!run.result.ok && !run.pasteError && (
            <p className="mt-1 text-sm">
              <span className="font-mono text-xs">
                reason: {run.result.reason}
              </span>{" "}
              — {describeReason(run.result.reason)}
            </p>
          )}
          {run.revocationSkippedReason && (
            <p className="mt-1 text-sm">{run.revocationSkippedReason}</p>
          )}
          {run.statusPasteError && (
            <p className="mt-1 text-sm">
              Status list parse error:{" "}
              {describePasteReason(run.statusPasteError.reason)}
              {run.statusPasteError.detail && (
                <span className="ml-1 font-mono text-xs">
                  ({run.statusPasteError.detail})
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {run.summary && <SummaryCard summary={run.summary} />}

      {run.result.ok && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            <ScrollText className="mr-1 inline h-4 w-4" />
            Raw credential JSON
          </summary>
          <div className="mt-2">
            <JsonViewer value={run.result.credential as unknown as Record<string, unknown>} />
          </div>
        </details>
      )}
    </section>
  );
}

function SummaryCard({ summary }: { summary: CredentialDisplaySummary }) {
  return (
    <div className="rounded border border-slate-300 bg-white p-3 text-sm text-slate-900">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Credential summary
      </h3>
      <dl className="grid grid-cols-1 gap-y-1 sm:grid-cols-3">
        <Row k="Issuer" v={summary.issuer} />
        <Row k="Valid from" v={summary.validFrom} />
        <Row k="Subject (learner)" v={summary.subjectId} />
        <Row k="Claim" v={summary.claim} />
        <Row k="Problem" v={summary.problemId} />
        <Row k="Evidence digest (prefix)" v={summary.evidenceContentDigestPrefix + "…"} />
        {summary.reviewerNote && (
          <Row k="Teacher note" v={summary.reviewerNote} wide />
        )}
        {summary.hasRevocationPointer && (
          <>
            <Row
              k="Revocation list URL"
              v={summary.revocationListUrl ?? ""}
              wide
            />
            <Row
              k="Revocation list index"
              v={String(summary.revocationListIndex ?? "")}
            />
          </>
        )}
      </dl>
      {summary.specPoints.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Demonstrated spec-points ({summary.specPoints.length})
          </h4>
          <ul className="space-y-1">
            {summary.specPoints.map((sp) => (
              <li
                key={`${sp.framework}|${sp.code}`}
                className="flex items-start gap-1 text-xs"
              >
                <ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                <span>
                  <span className="font-mono">{sp.framework}</span>{" "}
                  <span className="font-mono font-semibold">{sp.code}</span>
                  {sp.label && <span className="text-slate-600"> — {sp.label}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, wide = false }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={`${wide ? "sm:col-span-3" : ""} flex items-baseline gap-2`}>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{k}:</dt>
      <dd className="break-all font-mono text-xs text-slate-800">{v}</dd>
    </div>
  );
}

// ─── Demo fixture (browser-side mint) ──────────────────────────────────────

async function mintDemoFixture(
  flavor: "valid" | "revoked",
): Promise<{ credential: unknown; encodedList: string }> {
  const reg = createStatusRegistry({
    statusListCredentialUrl: DEMO_DEFAULT_LIST_URL,
    issuerDid: DEMO_DEFAULT_ISSUER,
    totalBits: 1024,
  });
  const credentialId = `urn:evenkeel:vc:demo-${Date.now()}`;
  const status = reg.allocate(credentialId);
  const attestation: TeacherAttestationEnvelope = {
    payload: {
      version: 1,
      crtContentDigestB64url: "demo-crt-digest",
      studentExternalId: "demo-learner",
      problemId: "demo-quad-01",
      attestedAtIso: new Date().toISOString(),
      verdict: "verified-mastery",
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A18",
          label: "Solve quadratic equations",
          claimVocabularyVersion: 1,
        },
      ],
    },
    contentDigestB64url: "demo-att-digest",
    signatureB64url: "demo-att-sig",
    publicKeyB64url: "demo-teacher-pk",
    signedAtIso: new Date().toISOString(),
    algorithm: "ECDSA-P256-SHA256",
    keyType: "passkey-derived",
  };
  const credential = await issueVerifiableCredential({
    attestation,
    issuerDid: DEMO_DEFAULT_ISSUER,
    id: credentialId,
    signer: (p) => signPayload(p, { keySource: "session" }),
    credentialStatus: status,
  });
  if (flavor === "revoked") {
    reg.revoke(credentialId, { reasonCode: "demo_button" });
  }
  const encodedList = await reg.encodedList();
  return { credential, encodedList };
}
