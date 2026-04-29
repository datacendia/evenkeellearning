"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/IssueReceiptCard.tsx
//
// Right-rail card on /student that lets a learner mint a v1.4.6 Signed
// Learning Receipt for the currently-active problem and surfaces the
// shareable URL the moment it's signed.
//
// Aggregation strategy
// ────────────────────
//   • Validated-attempt counts (correct + tracked-error categories) are
//     accumulated by subscribing to the data bus and filtering events
//     by `problemId`. The counters reset when the active problemId
//     changes (rare on the demo surface but the right behaviour).
//   • At issue time, scheduler state (Leitner box) and practice-session
//     count are read directly from their on-device modules.
//   • The receipt payload is then handed to `issueReceipt()` which signs
//     via the existing ECDSA P-256 primitive. No server is contacted.
//
// Self-hide rule
// ──────────────
// The card stays hidden until the learner has at least one validated
// attempt against the active problem. Same discipline as the
// `MyPatternsCard` and `ComingBackCard`: a fresh learner's first
// session is uncluttered.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Stamp, Copy, Check, KeyRound } from "lucide-react";
import { subscribe as subscribeBus, type BusEvent } from "@/lib/data-bus";
import {
  EMPTY_CATEGORY_COUNTS,
  issueReceipt,
  type CategoryCounts,
  type SignedLearningReceipt,
} from "@/lib/receipts/learning-receipt";
import { getProblemState } from "@/lib/eke/scheduler";
import type { TrackedCategory } from "@/lib/eke/error-bank";
import {
  getEnrolment,
  subscribePasskey,
  PasskeyError,
  type PasskeyEnrolment,
} from "@/lib/crypto/passkey";

const TRACKED: readonly TrackedCategory[] = [
  "sign_flipped",
  "off_by_one",
  "doubled",
  "halved",
  "wrong",
];

interface Props {
  problemId: string;
  problemTitle: string;
  skillFamily?: string;
  jurisdiction: string;
  learnerInitials: string;
}

export default function IssueReceiptCard({
  problemId,
  problemTitle,
  skillFamily,
  jurisdiction,
  learnerInitials,
}: Props) {
  // ── Per-session aggregates, populated from the bus ─────────────────────
  const [counts, setCounts] = useState<CategoryCounts>(() => ({
    ...EMPTY_CATEGORY_COUNTS,
  }));
  const [attemptsTotal, setAttemptsTotal] = useState(0);
  const [correctOnAttempt, setCorrectOnAttempt] = useState<number | null>(null);
  const [hintTierMax, setHintTierMax] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [pasteAttempts, setPasteAttempts] = useState(0);
  const [trustScore, setTrustScore] = useState(100);
  const [gateCleared, setGateCleared] = useState(false);
  const [practiceSessionsCount, setPracticeSessionsCount] = useState(0);

  const [issueState, setIssueState] = useState<
    | { kind: "ready" }
    | { kind: "signing-session" }
    | { kind: "signing-passkey" }
    | { kind: "passkey-failed"; message: string }
    | { kind: "issued"; receipt: SignedLearningReceipt }
  >({ kind: "ready" });
  const [copied, setCopied] = useState(false);
  const [enrolment, setEnrolment] = useState<PasskeyEnrolment | null>(null);

  useEffect(() => {
    setEnrolment(getEnrolment());
    const unsub = subscribePasskey((e) => setEnrolment(e));
    return unsub;
  }, []);

  // Convenience aliases the rest of the component reads against.
  const issued = issueState.kind === "issued" ? issueState.receipt : null;
  const issuing =
    issueState.kind === "signing-session" || issueState.kind === "signing-passkey";

  // Reset when the active problem changes (changing curriculum or subject
  // on the surface mounts a new EkeChat session).
  useEffect(() => {
    setCounts({ ...EMPTY_CATEGORY_COUNTS });
    setAttemptsTotal(0);
    setCorrectOnAttempt(null);
    setHintTierMax(0);
    setPasteAttempts(0);
    setTrustScore(100);
    setGateCleared(false);
    setPracticeSessionsCount(0);
    setIssueState({ kind: "ready" });
  }, [problemId]);

  useEffect(() => {
    const unsub = subscribeBus((e: BusEvent) => {
      const p = e.payload as Record<string, unknown>;

      // We filter most events by problemTitle (which is what EkeChat
      // attaches) since events do not carry problemId. The /student
      // surface uses a 1:1 mapping between problemId and problemTitle.
      const eventProblem = p.problemTitle ?? null;

      if (e.type === "student.answer.validated" && eventProblem === problemTitle) {
        const cat = p.category as keyof CategoryCounts | undefined;
        if (!cat) return;
        setAttemptsTotal((n) => {
          const next = n + 1;
          if (cat === "correct") {
            setCorrectOnAttempt((prev) => prev ?? next);
          }
          return next;
        });
        if (cat in EMPTY_CATEGORY_COUNTS) {
          setCounts((prev) => ({ ...prev, [cat]: prev[cat] + 1 }));
        }
        return;
      }

      if (e.type === "student.hint.requested" && eventProblem === problemTitle) {
        const tier = p.tier;
        if (typeof tier === "number" && tier >= 0 && tier <= 4) {
          setHintTierMax((prev) =>
            (tier as 0 | 1 | 2 | 3 | 4) > prev
              ? (tier as 0 | 1 | 2 | 3 | 4)
              : prev,
          );
        }
        return;
      }

      if (e.type === "student.paste.blocked" && eventProblem === problemTitle) {
        setPasteAttempts((n) => n + 1);
        return;
      }

      if (e.type === "student.submit" && eventProblem === problemTitle) {
        const ts = p.trust;
        if (typeof ts === "number" && Number.isFinite(ts)) {
          setTrustScore(ts);
        }
        return;
      }

      if (e.type === "student.gate.cleared") {
        // Gate-cleared events don't carry problemTitle; on the demo
        // surface there's only one gate so the cleared signal applies
        // to the active problem.
        setGateCleared(true);
        return;
      }

      if (e.type === "student.practice.session") {
        if (p.active === false) {
          setPracticeSessionsCount((n) => n + 1);
        }
        return;
      }
    });
    return unsub;
  }, [problemTitle]);

  const buildPayload = () => {
    const schedulerEntry = getProblemState(problemId);
    const leitnerBox = schedulerEntry?.box ?? 1;
    return {
      learnerInitials,
      problemId,
      problemTitle,
      skillFamily,
      attemptsTotal,
      correctOnAttempt,
      hintTierMax,
      categoryCounts: counts,
      leitnerBox,
      gateCleared,
      pasteAttempts,
      trustScore,
      practiceSessionsCount,
      jurisdiction,
    };
  };

  const onIssueWithSession = async () => {
    if (issuing || attemptsTotal === 0) return;
    setIssueState({ kind: "signing-session" });
    try {
      const r = await issueReceipt(buildPayload());
      setIssueState({ kind: "issued", receipt: r });
    } catch {
      // SubtleCrypto unavailable — reset to ready and let the user retry.
      setIssueState({ kind: "ready" });
    }
  };

  const onIssueWithPasskey = async () => {
    if (issuing || attemptsTotal === 0) return;
    setIssueState({ kind: "signing-passkey" });
    try {
      const r = await issueReceipt(buildPayload(), { keySource: "passkey" });
      setIssueState({ kind: "issued", receipt: r });
    } catch (e) {
      // Honest no-silent-fallback: never silently downgrade to session
      // key. Surface a clear message so the learner picks again.
      const message =
        e instanceof PasskeyError
          ? e.code === "cancelled"
            ? "You cancelled the passkey prompt. Try again, or sign with your session key instead."
            : e.code === "no_enrolment"
            ? "No passkey enrolled on this device."
            : `Passkey signing failed: ${e.message}`
          : "Passkey signing failed. Try again, or sign with your session key instead.";
      setIssueState({ kind: "passkey-failed", message });
    }
  };

  const onCopy = async () => {
    if (!issued) return;
    const url = `${window.location.origin}/receipt/${issued.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — the URL is shown in the UI either way
    }
  };

  // Self-hide before the learner has done anything.
  if (attemptsTotal === 0 && !issued) return null;

  const errorTotal = TRACKED.reduce((acc, c) => acc + counts[c], 0);

  return (
    <section className="kl-card" aria-labelledby="issue-receipt-title">
      <header className="flex items-center gap-2 mb-3">
        <Stamp size={16} style={{ color: "var(--accent)" }} aria-hidden="true" />
        <h3 id="issue-receipt-title" className="text-sm font-semibold">
          Issue Learning Receipt
        </h3>
      </header>

      <p
        className="text-xs mb-3"
        style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
      >
        A signed snapshot of your work on this problem. Your teacher can
        verify it in their browser — no server, no account, no upload.
      </p>

      <SummaryRow label="Attempts" value={String(attemptsTotal)} />
      <SummaryRow
        label="First correct on attempt"
        value={correctOnAttempt !== null ? String(correctOnAttempt) : "—"}
      />
      <SummaryRow label="Max hint tier" value={`${hintTierMax}/4`} />
      <SummaryRow label="Errors caught" value={String(errorTotal)} />
      <SummaryRow label="Trust score" value={`${trustScore}/100`} />
      <SummaryRow label="Practice sessions" value={String(practiceSessionsCount)} />

      {!issued ? (
        <IssueButtons
          state={issueState}
          enrolment={enrolment}
          disabled={attemptsTotal === 0}
          onIssueWithSession={onIssueWithSession}
          onIssueWithPasskey={onIssueWithPasskey}
          onDismissError={() => setIssueState({ kind: "ready" })}
        />
      ) : (
        <IssuedReceiptBlock
          receipt={issued}
          copied={copied}
          onCopy={onCopy}
          onReset={() => setIssueState({ kind: "ready" })}
        />
      )}

      <p
        className="font-mono mt-3"
        style={{ fontSize: 10, color: "var(--fg-faint)", letterSpacing: "0.05em" }}
      >
        ECDSA P-256 ·{" "}
        {enrolment ? "passkey available" : "session-demo key"} · stored on
        this device only
      </p>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs">
      <span style={{ color: "var(--fg-dim)" }}>{label}</span>
      <span className="font-mono" style={{ color: "var(--fg)" }}>
        {value}
      </span>
    </div>
  );
}

type IssueButtonsState =
  | { kind: "ready" }
  | { kind: "signing-session" }
  | { kind: "signing-passkey" }
  | { kind: "passkey-failed"; message: string }
  | { kind: "issued"; receipt: SignedLearningReceipt };

function IssueButtons({
  state,
  enrolment,
  disabled,
  onIssueWithSession,
  onIssueWithPasskey,
  onDismissError,
}: {
  state: IssueButtonsState;
  enrolment: PasskeyEnrolment | null;
  disabled: boolean;
  onIssueWithSession: () => void;
  onIssueWithPasskey: () => void;
  onDismissError: () => void;
}) {
  const isSigning =
    state.kind === "signing-session" || state.kind === "signing-passkey";

  // The honest two-button mode: a passkey IS enrolled, so we let the
  // learner pick. The page-level UX (PasskeyEnrolCard) is responsible
  // for getting them into this state.
  if (enrolment) {
    return (
      <div className="space-y-2 mt-3">
        {state.kind === "passkey-failed" && (
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
            {state.message}{" "}
            <button
              type="button"
              onClick={onDismissError}
              className="underline"
              style={{ color: "inherit" }}
            >
              Dismiss
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onIssueWithPasskey}
          disabled={disabled || isSigning}
          className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 w-full justify-center"
          style={{
            background: "var(--accent)",
            color: "var(--paper)",
            minHeight: 44,
            opacity: isSigning ? 0.6 : 1,
          }}
          aria-label="Sign this Learning Receipt with your enrolled passkey"
        >
          <KeyRound size={14} aria-hidden="true" />
          {state.kind === "signing-passkey"
            ? "Waiting for device…"
            : "Sign with passkey"}
        </button>
        <button
          type="button"
          onClick={onIssueWithSession}
          disabled={disabled || isSigning}
          className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 w-full justify-center"
          style={{
            background: "var(--bg-deep)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            minHeight: 40,
            opacity: isSigning ? 0.6 : 1,
          }}
          aria-label="Sign this Learning Receipt with the per-tab session key"
        >
          <Stamp size={14} aria-hidden="true" />
          {state.kind === "signing-session"
            ? "Signing…"
            : "Sign with session key instead"}
        </button>
      </div>
    );
  }

  // No enrolment: keep the original single-button behaviour so
  // existing surfaces work exactly as before.
  return (
    <button
      type="button"
      onClick={onIssueWithSession}
      disabled={disabled || isSigning}
      className="kl-tap-target rounded-md px-3 py-2 text-xs flex items-center gap-1.5 mt-3 w-full justify-center"
      style={{
        background: "var(--accent)",
        color: "var(--paper)",
        minHeight: 44,
        opacity: isSigning ? 0.6 : 1,
      }}
      aria-label="Issue and sign a Learning Receipt for this problem"
    >
      <Stamp size={14} aria-hidden="true" />
      {state.kind === "signing-session" ? "Signing…" : "Issue Receipt"}
    </button>
  );
}

function IssuedReceiptBlock({
  receipt,
  copied,
  onCopy,
  onReset,
}: {
  receipt: SignedLearningReceipt;
  copied: boolean;
  onCopy: () => void;
  onReset: () => void;
}) {
  const url = useMemo(
    () =>
      typeof window !== "undefined"
        ? `${window.location.origin}/receipt/${receipt.id}`
        : `/receipt/${receipt.id}`,
    [receipt.id],
  );
  return (
    <div
      className="mt-3 rounded-md p-3"
      style={{
        background: "var(--accent-soft)",
        border: "1px solid var(--accent)",
      }}
    >
      <p
        className="text-xs font-semibold"
        style={{ color: "var(--accent-ink, var(--accent))" }}
      >
        Receipt signed ✓
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: "var(--fg-dim)", lineHeight: 1.5 }}
      >
        Share this link with your teacher. They&apos;ll see exactly the
        same summary and a one-click signature check.
      </p>
      <div
        className="font-mono mt-2 p-2 rounded"
        style={{
          fontSize: 11,
          background: "var(--bg-deep)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
          wordBreak: "break-all",
        }}
      >
        {url}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={onCopy}
          className="kl-tap-target rounded-md px-2 py-1 text-xs flex items-center gap-1.5"
          style={{
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            minHeight: 36,
          }}
          aria-label="Copy receipt URL"
        >
          {copied ? (
            <>
              <Check size={12} aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden="true" /> Copy URL
            </>
          )}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="kl-tap-target rounded-md px-2 py-1 text-xs"
          style={{
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            minHeight: 36,
            display: "inline-flex",
            alignItems: "center",
          }}
          aria-label="Open the receipt verification page"
        >
          Open
        </a>
        <button
          type="button"
          onClick={onReset}
          className="kl-tap-target rounded-md px-2 py-1 text-xs ml-auto"
          style={{
            background: "transparent",
            color: "var(--fg-faint)",
            minHeight: 36,
          }}
          aria-label="Issue another receipt for this problem"
        >
          Issue another
        </button>
      </div>
    </div>
  );
}
