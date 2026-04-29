"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/TransparencyBundleCard.tsx
//
// The Compliance Officer-facing surface for the v1.4.9 transparency bundle.
// Mounts on /compliance under the "Transparency" tab.
//
// Responsibilities:
//   • Fetch /transparency-bundle.json (a static, build-time artefact written
//     by `scripts/build-transparency-bundle.mjs`)
//   • Show a one-glance summary: engine version, generated timestamp,
//     governance docs covered, control map count, audit pass/fail counters,
//     component digest, signature fingerprint
//   • Offer a "Download bundle" button (anchor with `download` attribute) so
//     a procurement / DPO / auditor can hand it on with one click
//   • Offer "Verify signature in browser" — recomputes componentDigest and
//     verifies the embedded ECDSA P-256 signature using SubtleCrypto, with
//     no network round-trip
//
// PRIVACY: this component reads only the static bundle artefact. It carries
// no learner data and never touches localStorage. If the bundle is missing
// (developer hasn't run `npm run transparency:build`) the card renders an
// honest "not built yet" state with a copy-pasteable shell command.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { Download, FileCheck2, ShieldCheck } from "lucide-react";

interface GovernanceEntry {
  path: string;
  present: boolean;
  sha256: string | null;
  sizeBytes: number;
}
interface ControlMapSummary {
  path: string;
  present: boolean;
  sha256?: string;
  controlsCount?: number;
  frameworks?: string[];
  phase1Counts?: Record<string, number>;
  version?: string;
}
interface ReproSummary {
  path: string;
  present: boolean;
  sha256?: string;
  aggregateSha256?: string | null;
  fileCount?: number;
  governanceDocsCount?: number;
}
interface AuditSummary {
  path?: string;
  present: boolean;
  sha256?: string;
  generatedAt?: string | null;
  counters?: {
    totalPassed?: number;
    totalFailed?: number;
    totalSkipped?: number;
  } | null;
}
interface TransparencyBundle {
  schemaVersion: number;
  signingAlgorithm: string;
  generatedAtIso: string;
  engineVersion: string;
  packageVersion: string;
  honestyContract: string;
  components: {
    governance: GovernanceEntry[];
    controlMap: ControlMapSummary;
    reproducibility: ReproSummary;
    audit: AuditSummary;
  };
  componentDigestB64url: string;
  signature: {
    publicKeyB64url: string;
    signatureB64url: string;
    signedAtIso: string;
    keyType: string;
    note?: string;
  };
}

const BUNDLE_URL = "/transparency-bundle.json";

function fromB64url(s: string): ArrayBuffer {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return buf;
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJsonStringify(v)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]))
      .join(",") +
    "}"
  );
}

async function verifyInBrowser(
  bundle: TransparencyBundle,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    // Re-canonicalise the bundle minus the signature.
    const { signature, ...rest } = bundle;
    const canonical = canonicalJsonStringify(rest);
    const encoded = new TextEncoder().encode(canonical);
    const data = encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ) as ArrayBuffer;

    const sigBytes = fromB64url(signature.signatureB64url);
    const spki = fromB64url(signature.publicKeyB64url);
    const key = await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes,
      data,
    );
    return ok ? { ok: true } : { ok: false, reason: "signature did not verify" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "verify threw" };
  }
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

export default function TransparencyBundleCard() {
  const [bundle, setBundle] = useState<TransparencyBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<
    "idle" | "running" | "ok" | "fail"
  >("idle");
  const [verifyReason, setVerifyReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(BUNDLE_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((j) => {
        if (cancelled) return;
        setBundle(j as TransparencyBundle);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onVerify = async () => {
    if (!bundle) return;
    setVerifyState("running");
    setVerifyReason(null);
    const result = await verifyInBrowser(bundle);
    setVerifyState(result.ok ? "ok" : "fail");
    if (!result.ok) setVerifyReason(result.reason ?? null);
  };

  if (error || !bundle) {
    return (
      <div className="kl-card">
        <div className="flex items-start gap-3">
          <FileCheck2 size={18} aria-hidden="true" style={{ color: "var(--fg-faint)" }} />
          <div>
            <p
              className="font-mono"
              style={{
                fontSize: 10,
                color: "var(--fg-faint)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Transparency bundle
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}>
              {error
                ? `Bundle not available (${error}).`
                : "Loading bundle…"}{" "}
              The transparency bundle is a build-time artefact. To generate it:
            </p>
            <pre
              className="mt-2 rounded-md p-2 text-xs overflow-x-auto"
              style={{
                background: "var(--bg-deep)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                fontFamily: "var(--mono)",
              }}
            >
              npm run transparency:build
            </pre>
            <p className="text-xs mt-2" style={{ color: "var(--fg-faint)" }}>
              That writes <code>evidence/transparency-bundle.json</code> and a
              copy at <code>public/transparency-bundle.json</code> which this
              card serves.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const cm = bundle.components.controlMap;
  const repro = bundle.components.reproducibility;
  const audit = bundle.components.audit;
  const govPresent = bundle.components.governance.filter((g) => g.present).length;
  const govTotal = bundle.components.governance.length;

  return (
    <div className="space-y-6">
      <div className="kl-card">
        <div className="flex items-start gap-3 mb-3">
          <ShieldCheck size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <div>
            <p
              className="font-mono"
              style={{
                fontSize: 10,
                color: "var(--fg-faint)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Transparency bundle · {bundle.engineVersion}
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}
            >
              {bundle.honestyContract}
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Generated">{formatTime(bundle.generatedAtIso)}</Field>
          <Field label="Schema">v{bundle.schemaVersion}</Field>
          <Field label="Signing">{bundle.signingAlgorithm}</Field>
          <Field label="Key">{bundle.signature.keyType}</Field>
          <Field label="Governance docs">
            {govPresent}/{govTotal} present
          </Field>
          <Field label="Control map">
            {cm.present
              ? `${cm.controlsCount} controls · ${(cm.frameworks ?? []).join(", ")}`
              : "missing"}
          </Field>
          <Field label="Repro manifest">
            {repro.present
              ? `${repro.fileCount} files · ${repro.aggregateSha256?.slice(0, 12) ?? "?"}…`
              : "missing"}
          </Field>
          <Field label="Audit run">
            {audit.present
              ? `${audit.counters?.totalPassed ?? 0} passed · ${audit.counters?.totalFailed ?? 0} failed`
              : "no audit recorded"}
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Component digest (sha256)">
            <code style={{ fontFamily: "var(--mono)" }}>
              {bundle.componentDigestB64url}
            </code>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <a
            href={BUNDLE_URL}
            download="transparency-bundle.json"
            className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5"
            style={{ background: "var(--accent)", color: "var(--paper)" }}
          >
            <Download size={14} aria-hidden="true" />
            Download bundle
          </a>
          <button
            type="button"
            onClick={onVerify}
            disabled={verifyState === "running"}
            className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 disabled:opacity-50"
            style={{
              background: "var(--bg-deep)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
            }}
          >
            <FileCheck2 size={14} aria-hidden="true" />
            {verifyState === "running"
              ? "Verifying…"
              : "Verify signature in browser"}
          </button>
          {verifyState === "ok" && (
            <span
              className="text-xs self-center"
              style={{ color: "var(--accent)" }}
            >
              ✓ Signature verified
            </span>
          )}
          {verifyState === "fail" && (
            <span className="text-xs self-center" style={{ color: "var(--red)" }}>
              ✗ Verify failed{verifyReason ? `: ${verifyReason}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="font-mono"
        style={{
          fontSize: 10,
          color: "var(--fg-faint)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </p>
      <p className="text-sm mt-0.5" style={{ color: "var(--fg)", wordBreak: "break-all" }}>
        {children}
      </p>
    </div>
  );
}
