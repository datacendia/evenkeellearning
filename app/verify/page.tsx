"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/verify/page.tsx
//
// v1.7.2 — Standalone Verifiable Credential verifier (vc3-verifier).
//
// Purpose
// ───────
// A PUBLIC surface — no auth, no role guard — where anyone holding a
// printed / emailed / linked Even Keel credential (university
// admissions, employer, parent, moderator) can paste the JSON and
// confirm it was signed by the claimed issuer and has not been revoked.
//
// Why public
// ──────────
// A verifier gated behind a login is not a verifier; it's a claim. The
// credibility of the whole platform rests on a third party being able
// to open a browser, paste JSON, and get a straight answer with no
// Even Keel account involved. Everything on this page runs client-side.
// No data is persisted. No network calls are made other than the
// optional user-supplied status-list fetch.
//
// What verification proves (and doesn't)
// ──────────────────────────────────────
// PROVES: the attached `proof` was produced by the private key whose
// SPKI public key is embedded in the proof block, over the canonical
// form of the credential. If the credential's `credentialStatus` block
// is present AND a status-list credential is supplied or fetched, we
// also check the revocation bit.
//
// DOES NOT PROVE: that the embedded public key actually belongs to the
// claimed issuer. That link requires a DID document (vc4-did) that
// publishes the key under the issuer's identifier. Until then the page
// surfaces the public key prefix and invites a verifier to
// side-channel-check it out-of-band (e.g. via the school's website).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Upload,
  Link as LinkIcon,
  Info,
} from "lucide-react";
import { verifyCredential } from "@/lib/vc/verifier";
import type { SpecPointRegistryReport } from "@/lib/vc/verifier";
import type {
  StatusListCredential,
} from "@/lib/vc/status-list";
import type { VerifiableCredential } from "@/lib/vc/issuer";

type VerifyStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "pass";
      credential: VerifiableCredential;
      revocationChecked: boolean;
      registryReport: SpecPointRegistryReport[];
    }
  | { kind: "fail"; reason: string; detail?: string };

export default function VerifyPage() {
  const [vcText, setVcText] = useState("");
  const [statusListText, setStatusListText] = useState("");
  const [status, setStatus] = useState<VerifyStatus>({ kind: "idle" });
  const [parseError, setParseError] = useState<string | null>(null);

  async function handleVerify() {
    setParseError(null);
    setStatus({ kind: "running" });

    let credential: unknown;
    try {
      credential = JSON.parse(vcText);
    } catch (e) {
      setStatus({ kind: "idle" });
      setParseError(
        "Could not parse the credential as JSON. Check you copied the whole file.",
      );
      return;
    }

    let statusList: StatusListCredential | null = null;
    if (statusListText.trim().length > 0) {
      try {
        statusList = JSON.parse(statusListText);
      } catch {
        setStatus({ kind: "idle" });
        setParseError(
          "The status-list credential is not valid JSON. Leave it blank to skip the revocation check.",
        );
        return;
      }
    }

    const resolver = statusList
      ? async () => statusList
      : undefined;

    try {
      const result = await verifyCredential(credential, {
        resolveStatusList: resolver,
      });
      if (result.ok) {
        setStatus({
          kind: "pass",
          credential: result.credential,
          revocationChecked: !!statusList,
          registryReport: result.registryReport,
        });
      } else {
        setStatus({
          kind: "fail",
          reason: result.reason,
          detail: result.detail,
        });
      }
    } catch (e) {
      setStatus({
        kind: "fail",
        reason: "verify_threw",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setVcText(text);
    setStatus({ kind: "idle" });
    setParseError(null);
  }

  async function handleStatusListFilePick(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setStatusListText(text);
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--bg-deep, #0b0d10)",
        color: "var(--fg, #e8e6e3)",
      }}
    >
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="pb-4" style={{ borderBottom: "1px solid #222" }}>
          <p
            className="font-mono uppercase tracking-widest"
            style={{ fontSize: 11, opacity: 0.55 }}
          >
            Even Keel · Standalone Verifier · public
          </p>
          <h1 className="font-serif text-3xl mt-1">Verify a credential</h1>
          <p className="text-sm mt-2" style={{ opacity: 0.7 }}>
            Paste the JSON of an Even Keel-issued credential. Everything
            runs in your browser. No data is sent anywhere.
          </p>
        </header>

        <section className="space-y-2">
          <label
            htmlFor="vc-input"
            className="block text-xs font-mono uppercase tracking-widest"
            style={{ opacity: 0.6 }}
          >
            Credential JSON
          </label>
          <textarea
            id="vc-input"
            value={vcText}
            onChange={(e) => {
              setVcText(e.target.value);
              setStatus({ kind: "idle" });
            }}
            placeholder='Paste the full credential (including the "proof" block) here…'
            rows={12}
            className="w-full p-3 rounded font-mono"
            style={{
              background: "#0f1317",
              border: "1px solid #222",
              color: "inherit",
              fontSize: 12,
            }}
            spellCheck={false}
          />
          <label
            className="inline-flex items-center gap-2 text-xs cursor-pointer"
            style={{ opacity: 0.7 }}
          >
            <Upload size={12} />
            <span>Load from file…</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFilePick}
              style={{ display: "none" }}
            />
          </label>
        </section>

        <section className="space-y-2">
          <label
            htmlFor="sl-input"
            className="block text-xs font-mono uppercase tracking-widest"
            style={{ opacity: 0.6 }}
          >
            Status-list credential (optional — for revocation check)
          </label>
          <textarea
            id="sl-input"
            value={statusListText}
            onChange={(e) => setStatusListText(e.target.value)}
            placeholder="Paste the issuer's status-list credential to check for revocation. Leave blank to skip."
            rows={4}
            className="w-full p-3 rounded font-mono"
            style={{
              background: "#0f1317",
              border: "1px solid #222",
              color: "inherit",
              fontSize: 12,
            }}
            spellCheck={false}
          />
          <label
            className="inline-flex items-center gap-2 text-xs cursor-pointer"
            style={{ opacity: 0.7 }}
          >
            <Upload size={12} />
            <span>Load from file…</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleStatusListFilePick}
              style={{ display: "none" }}
            />
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleVerify}
            disabled={status.kind === "running" || vcText.trim().length === 0}
            className="px-4 py-2 rounded font-mono uppercase tracking-widest"
            style={{
              background: vcText.trim() ? "#2a6" : "#333",
              color: "#0b0d10",
              fontSize: 11,
              cursor: vcText.trim() ? "pointer" : "not-allowed",
              opacity: status.kind === "running" ? 0.6 : 1,
            }}
          >
            {status.kind === "running" ? "Verifying…" : "Verify"}
          </button>
          {parseError && (
            <span style={{ color: "#f87", fontSize: 13 }}>{parseError}</span>
          )}
        </div>

        {status.kind === "pass" && (
          <ResultPass
            credential={status.credential}
            revocationChecked={status.revocationChecked}
            registryReport={status.registryReport}
          />
        )}
        {status.kind === "fail" && (
          <ResultFail reason={status.reason} detail={status.detail} />
        )}

        <footer
          className="mt-10 pt-6 text-xs"
          style={{ borderTop: "1px solid #222", opacity: 0.6 }}
        >
          <div className="flex items-start gap-2">
            <Info size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <div className="space-y-2">
              <p>
                <strong>What a pass proves:</strong> the attached signature
                was produced by the private key whose public key is in
                the proof block, over the exact bytes of the credential
                shown. It also proves the bit at the revocation index is
                <code> 0</code> if you provided a status-list credential.
              </p>
              <p>
                <strong>What a pass does not prove:</strong> that the
                public key belongs to the issuer named in the{" "}
                <code>issuer</code> field. Until Even Keel publishes a{" "}
                <code>did:web</code> document, confirm the public-key
                prefix out-of-band (e.g. on the school's website).
              </p>
              <p>
                <strong>Source code:</strong>{" "}
                <a
                  href="https://github.com/datacendia/evenkeellearning"
                  style={{ color: "#7cf", textDecoration: "underline" }}
                >
                  github.com/datacendia/evenkeellearning
                </a>{" "}
                — verifier runs entirely client-side from{" "}
                <code>lib/vc/verifier.ts</code>.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Result panes ──────────────────────────────────────────────────────────

function ResultPass({
  credential,
  revocationChecked,
  registryReport,
}: {
  credential: VerifiableCredential;
  revocationChecked: boolean;
  registryReport: SpecPointRegistryReport[];
}) {
  const subj = credential.credentialSubject;
  // Build (framework, code) -> registry entry lookup so the rendered
  // spec-point list can pull canonical labels and unknown-marker hints
  // without re-running the registry from this UI module.
  const reportByKey = new Map(
    registryReport.map((r) => [`${r.framework}::${r.code}`, r]),
  );
  return (
    <div
      className="p-5 rounded space-y-3"
      style={{
        background: "#0f1a13",
        border: "1px solid #2a6",
      }}
    >
      <div className="flex items-center gap-3">
        <ShieldCheck size={22} style={{ color: "#4c8" }} />
        <p className="font-serif text-xl">Signature valid</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <Field label="Learner">{subj.id.replace(/^urn:evenkeel:learner:/, "")}</Field>
        <Field label="Claim">{subj.claim}</Field>
        <Field label="Problem">{subj.problemId}</Field>
        <Field label="Issued">{credential.validFrom}</Field>
        <Field label="Issuer">{credential.issuer}</Field>
        <Field label="Credential id">
          <span className="font-mono" style={{ fontSize: 10 }}>
            {credential.id}
          </span>
        </Field>
      </div>

      <div>
        <p className="text-xs font-mono uppercase tracking-widest mt-2" style={{ opacity: 0.55 }}>
          Spec points demonstrated
        </p>
        <ul className="mt-1 space-y-1.5">
          {subj.demonstratedSpecPoints.map((sp) => {
            const r = reportByKey.get(`${sp.framework}::${sp.code}`);
            // Prefer the registry's canonical label over the embedded
            // one — issuers sometimes ship abbreviated labels and the
            // registry holds the official phrasing.
            const displayLabel = r?.canonicalLabel ?? sp.label;
            return (
              <li
                key={`${sp.framework}::${sp.code}`}
                className="text-sm font-mono flex items-start gap-2"
                style={{ fontSize: 12 }}
              >
                <RegistryBadge status={r?.status ?? "unknown_framework"} />
                <span>
                  {sp.framework} · {sp.code}
                  {displayLabel ? ` — ${displayLabel}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {registryReport.some((r) => r.status !== "ok") && (
          <p
            className="text-xs mt-2"
            style={{ opacity: 0.65 }}
          >
            <Info size={11} style={{ display: "inline", marginRight: 4 }} />
            One or more spec points are not in this verifier's curriculum
            registry. The signature is still valid; the codes may belong
            to a framework version added after this verifier was last
            updated.
          </p>
        )}
      </div>

      {subj.reviewerNote && (
        <div>
          <p
            className="text-xs font-mono uppercase tracking-widest"
            style={{ opacity: 0.55 }}
          >
            Reviewer note
          </p>
          <p className="text-sm mt-1 italic">“{subj.reviewerNote}”</p>
        </div>
      )}

      <div
        className="pt-3 text-xs font-mono"
        style={{ borderTop: "1px dashed #333", opacity: 0.7 }}
      >
        <div className="flex items-start gap-2">
          <LinkIcon size={12} style={{ marginTop: 2 }} />
          <span style={{ fontSize: 10, wordBreak: "break-all" }}>
            issuer public key: {credential.proof.publicKeyB64url.slice(0, 32)}…
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-2 text-xs"
        style={{ opacity: 0.8 }}
      >
        {revocationChecked ? (
          <>
            <ShieldCheck size={12} style={{ color: "#4c8" }} />
            <span>Revocation checked against the supplied status list — not revoked.</span>
          </>
        ) : credential.credentialStatus ? (
          <>
            <ShieldAlert size={12} style={{ color: "#ca4" }} />
            <span>
              This credential declares a revocation list but you did not
              supply one. Fetch and paste{" "}
              <code>{credential.credentialStatus.statusListCredential}</code>{" "}
              to verify the current status.
            </span>
          </>
        ) : (
          <>
            <Info size={12} />
            <span>Credential does not declare a revocation list (not revocable).</span>
          </>
        )}
      </div>
    </div>
  );
}

function ResultFail({ reason, detail }: { reason: string; detail?: string }) {
  const explanation = REASON_EXPLANATIONS[reason] ?? "Unknown rejection reason.";
  return (
    <div
      className="p-5 rounded space-y-2"
      style={{ background: "#1a1010", border: "1px solid #b55" }}
    >
      <div className="flex items-center gap-3">
        <ShieldOff size={22} style={{ color: "#f87" }} />
        <p className="font-serif text-xl">Verification failed</p>
      </div>
      <p className="text-sm">
        <strong>Reason code:</strong>{" "}
        <code className="font-mono">{reason}</code>
      </p>
      <p className="text-sm" style={{ opacity: 0.85 }}>
        {explanation}
      </p>
      {detail && (
        <p className="text-xs font-mono" style={{ opacity: 0.6 }}>
          detail: {detail}
        </p>
      )}
    </div>
  );
}

/**
 * Tiny badge surfacing the curriculum-registry status of a single
 * spec-point claim. Green tick = registry recognised the (framework,
 * code) pair. Amber dot = unknown to this verifier's registry, which
 * is NOT a verification failure — see the explanatory note rendered
 * below the spec-point list.
 */
function RegistryBadge({
  status,
}: {
  status: "ok" | "unknown_framework" | "unknown_code";
}) {
  if (status === "ok") {
    return (
      <span
        title="In curriculum registry"
        aria-label="In curriculum registry"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 4,
          background: "#4c8",
          marginTop: 5,
          flexShrink: 0,
        }}
      />
    );
  }
  const label =
    status === "unknown_framework"
      ? "Framework not in registry"
      : "Code not in registry";
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 4,
        background: "#fb6",
        marginTop: 5,
        flexShrink: 0,
      }}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="text-xs font-mono uppercase tracking-widest"
        style={{ opacity: 0.55 }}
      >
        {label}
      </p>
      <p className="text-sm mt-0.5">{children}</p>
    </div>
  );
}

const REASON_EXPLANATIONS: Record<string, string> = {
  not_an_object: "The credential is not a JSON object.",
  missing_context: "The credential has no @context array.",
  wrong_context:
    "The first @context entry is not the W3C VC 2.0 URL. This credential was not issued under the VC 2.0 data model.",
  missing_type: "The credential declares no type array.",
  wrong_type:
    "The credential is missing the required VerifiableCredential or EvenKeelAttestationCredential type tag.",
  missing_issuer: "The issuer field is empty.",
  missing_validFrom: "The validFrom timestamp is missing.",
  missing_credentialSubject:
    "The credentialSubject is missing or malformed.",
  missing_proof: "No proof block attached — this credential is unsigned.",
  wrong_proof_type:
    "The proof block is not a DataIntegrityProof (our supported type).",
  wrong_cryptosuite:
    "The proof uses an unsupported cryptosuite. This verifier only accepts ecdsa-jcs-2019.",
  wrong_proof_purpose:
    "The proof purpose is not assertionMethod.",
  missing_proof_value: "The proof has no proofValue.",
  missing_public_key: "The proof has no issuer public key.",
  invalid_spec_point:
    "One or more claimed spec points failed the vocabulary validator (see detail).",
  bad_public_key:
    "The embedded public key could not be imported as an ECDSA P-256 key.",
  bad_signature:
    "The signature does not match the canonical form of the credential. Either the credential was tampered with, or the embedded public key is not the one that signed it.",
  verify_threw:
    "The browser's Web Crypto API threw while verifying the signature.",
  revoked:
    "The issuer has revoked this credential. The bit for this credential's index in the supplied status list is set.",
  status_list_mismatch:
    "The supplied status-list credential does not correspond to the URL named in the credential's status block, or its index is out of range.",
};
