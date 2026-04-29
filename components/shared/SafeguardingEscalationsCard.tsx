"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/SafeguardingEscalationsCard.tsx
//
// The Compliance Officer-facing surface for the v1.4.8 DSL escalation
// pipeline. Lives on /compliance under the "Safeguarding" tab.
//
// Responsibilities:
//   • Display the local escalation queue (oldest first, with category,
//     timestamp, jurisdiction, age band, delivery state)
//   • Let the Compliance Officer configure the school's DSL endpoint URL
//     (HTTPS-only, with localhost exception for development)
//   • Trigger ad-hoc delivery attempts per entry
//   • Verify the ECDSA signature on any stored entry on-page
//   • Issue a synthetic test escalation so the DSL can confirm wiring
//     without waiting for a real crisis to fire
//
// PRIVACY: this component reads only category-level metadata from
// `lib/safeguarding/escalation-queue.ts`. It never displays a learner's
// free-form text — there is no field on EscalationEntry that holds it.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  Check,
  Globe,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  attemptWebhookDelivery,
  clearEscalations,
  enqueueEscalation,
  EscalationEntry,
  listEscalations,
  subscribeEscalations,
  verifyEscalation,
} from "@/lib/safeguarding/escalation-queue";
import {
  clearWebhookEndpoint,
  getWebhookEndpoint,
  setWebhookEndpoint,
  validateWebhookEndpoint,
} from "@/lib/safeguarding/webhook-config";
import type { CrisisPatternCategory } from "@/lib/regulatory-absorb/types";

const CATEGORY_LABELS: Record<CrisisPatternCategory, string> = {
  direct_self_harm: "Direct self-harm language",
  temporal_escalation: "Temporal-imminent distress",
  indirect_distress: "Indirect distress idiom",
  cyberbullying_acronym: "Cyberbullying acronym (reflexive)",
  emoji_affect: "Distress emoji + negative affect",
};

function formatTime(epoch: number): string {
  return new Date(epoch).toLocaleString();
}

function formatDeliveryState(entry: EscalationEntry): string {
  const s = entry.deliveryState;
  switch (s.kind) {
    case "queued":
      return "Queued — never attempted";
    case "no_endpoint":
      return "No DSL endpoint configured";
    case "in_flight":
      return `In flight (started ${formatTime(s.attemptStartedAt)})`;
    case "sent":
      return `Sent · HTTP ${s.lastResponseStatus} · attempt ${s.attemptCount} · ${formatTime(s.lastSucceededAt)}`;
    case "failed":
      return `Failed (attempt ${s.attemptCount}): ${s.lastError} · ${formatTime(s.lastFailedAt)}`;
  }
}

export default function SafeguardingEscalationsCard() {
  const [entries, setEntries] = useState<EscalationEntry[]>([]);
  const [endpoint, setEndpoint] = useState<string>("");
  const [endpointInput, setEndpointInput] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    setEntries(listEscalations());
    setEndpoint(getWebhookEndpoint() ?? "");
  };

  useEffect(() => {
    refresh();
    const unsub = subscribeEscalations(refresh);
    return () => {
      unsub();
    };
  }, []);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.detectedAt - a.detectedAt),
    [entries],
  );

  const onSaveEndpoint = () => {
    const v = setWebhookEndpoint(endpointInput);
    if (!v.ok) {
      setValidationError(v.reason);
      return;
    }
    setValidationError(null);
    setEndpointInput("");
    refresh();
  };

  const onClearEndpoint = () => {
    clearWebhookEndpoint();
    setEndpointInput("");
    setValidationError(null);
    refresh();
  };

  const onTestEscalation = async () => {
    await enqueueEscalation({
      triggerType: "crisis_response",
      crisisPatternCategory: "direct_self_harm",
      jurisdiction: "TEST",
      studentAgeBand: "Y9-11",
    });
    refresh();
  };

  const onClearQueue = () => {
    clearEscalations();
    setVerifyResults({});
    refresh();
  };

  const onAttemptDelivery = async (id: string) => {
    setBusyId(id);
    try {
      await attemptWebhookDelivery(id);
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const onVerify = async (entry: EscalationEntry) => {
    const ok = await verifyEscalation(entry);
    setVerifyResults((prev) => ({ ...prev, [entry.id]: ok }));
  };

  return (
    <div className="space-y-6">
      {/* DSL endpoint configuration */}
      <div className="kl-card">
        <div className="flex items-start gap-3 mb-3">
          <Globe size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />
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
              DSL endpoint configuration
            </p>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}
            >
              HTTPS endpoint at your school&rsquo;s pastoral or MIS system that
              should receive signed safeguarding escalations. The receiver
              must accept POST with <code>Content-Type: application/json</code>;
              the signed envelope is the body. The signing public key is
              forwarded in <code>X-EvenKeel-PublicKey</code>.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={endpointInput}
            onChange={(e) => setEndpointInput(e.target.value)}
            placeholder={endpoint || "https://safeguarding.school.example/ingest"}
            aria-label="DSL endpoint URL"
            className="flex-1 min-w-[280px] rounded-md px-3 py-2 text-sm"
            style={{
              background: "var(--bg-deep)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              fontFamily: "var(--mono)",
            }}
          />
          <button
            type="button"
            onClick={onSaveEndpoint}
            className="kl-tap-target rounded-md px-3 py-2 text-xs"
            style={{ background: "var(--accent)", color: "var(--paper)" }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClearEndpoint}
            className="kl-tap-target rounded-md px-3 py-2 text-xs"
            style={{ background: "var(--bg-deep)", color: "var(--fg)", border: "1px solid var(--border)" }}
          >
            Clear
          </button>
        </div>
        {validationError && (
          <p className="mt-2 text-xs" style={{ color: "var(--red)" }}>
            {validationError}
          </p>
        )}
        {endpoint && (
          <p className="mt-2 text-xs" style={{ color: "var(--fg-faint)", fontFamily: "var(--mono)" }}>
            Active endpoint: {endpoint}
          </p>
        )}
        {!endpoint && (
          <p className="mt-2 text-xs" style={{ color: "var(--fg-faint)" }}>
            No endpoint configured. Escalations stay queued locally; nothing
            leaves the device until you save an HTTPS URL.
          </p>
        )}
      </div>

      {/* Queue header + actions */}
      <div className="kl-card">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} aria-hidden="true" style={{ color: "var(--red)" }} />
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
                Safeguarding escalation queue
              </p>
              <p
                className="text-sm mt-1"
                style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}
              >
                Crisis-response detections from the Decision Gate. Each entry
                is a signed (ECDSA P-256) envelope. Payloads are
                category-only — never the learner&rsquo;s text.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={onTestEscalation}
              className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5"
              style={{ background: "var(--bg-deep)", color: "var(--fg)", border: "1px solid var(--border)" }}
              title="Enqueue a synthetic test escalation so you can confirm DSL wiring without waiting for a real event."
            >
              <AlertOctagon size={14} aria-hidden="true" />
              Test escalation
            </button>
            <button
              type="button"
              onClick={onClearQueue}
              className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5"
              style={{ background: "var(--bg-deep)", color: "var(--red)", border: "1px solid var(--border)" }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Clear queue
            </button>
          </div>
        </div>

        {sortedEntries.length === 0 && (
          <p className="text-sm" style={{ color: "var(--fg-faint)" }}>
            No safeguarding escalations recorded since session start.
          </p>
        )}

        <div className="space-y-3">
          {sortedEntries.map((entry) => {
            const verifyResult = verifyResults[entry.id];
            const payload = entry.envelope.payload;
            return (
              <div
                key={entry.id}
                className="rounded-lg p-3"
                style={{
                  background: "var(--bg-deep)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
                      {CATEGORY_LABELS[payload.crisisPatternCategory]}
                    </p>
                    <p
                      className="font-mono mt-1"
                      style={{ fontSize: 10, color: "var(--fg-faint)" }}
                    >
                      {payload.id} · {formatTime(payload.detectedAt)}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--fg-dim)" }}>
                      Jurisdiction: <strong>{payload.jurisdiction}</strong>
                      {payload.studentAgeBand ? <> · Age band: <strong>{payload.studentAgeBand}</strong></> : null}
                      <> · Engine: {payload.engineVersion}</>
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--fg-dim)" }}>
                      Delivery: {formatDeliveryState(entry)}
                    </p>
                    {verifyResult !== undefined && (
                      <p
                        className="text-xs mt-1 inline-flex items-center gap-1"
                        style={{ color: verifyResult ? "var(--accent)" : "var(--red)" }}
                      >
                        <Check size={12} aria-hidden="true" />
                        Signature {verifyResult ? "valid" : "INVALID"}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onVerify(entry)}
                      className="kl-tap-target rounded-md px-2.5 py-1.5 text-xs"
                      style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)" }}
                    >
                      Verify signature
                    </button>
                    <button
                      type="button"
                      onClick={() => onAttemptDelivery(entry.id)}
                      disabled={busyId === entry.id}
                      className="kl-tap-target rounded-md px-2.5 py-1.5 text-xs flex items-center gap-1 disabled:opacity-50"
                      style={{ background: "var(--accent)", color: "var(--paper)" }}
                    >
                      <Send size={12} aria-hidden="true" />
                      {busyId === entry.id ? "Sending…" : "Attempt delivery"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Convenience hook re-export for tests / future surfaces. The
 * validator is a pure function so a future build script can lint
 * stored endpoint URLs without spinning up React.
 */
export { validateWebhookEndpoint };
