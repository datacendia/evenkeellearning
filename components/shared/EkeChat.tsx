"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/EkeChat.tsx
//
// The chat surface that hosts the Socratic Eke engine. Responsibilities:
//   • Render the conversation, the problem context strip and the trust badge
//   • Pump every keystroke / paste / focus-loss into the IPA analyser to keep
//     the live trust meter honest
//   • Optionally short-circuit paste events when `zeroPaste` is on (default)
//   • Publish learner activity (hint requested, paste blocked, submission)
//     onto the cross-surface data bus so the parent and teacher views can
//     react in real time
//
// This component does not own state about the problem or the curriculum;
// those are passed in as props by the parent page.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { Send, Lightbulb, Shield, Activity, Accessibility, Mic, MicOff } from "lucide-react";
import { createKeLe, EkeEngine, EkeMessage } from "@/lib/eke/eke-engine";
import { EkeTone, getEffectiveTone } from "@/lib/eke/personality";
import { createIPAAnalyzer } from "@/lib/vertolearn/ipa-analyzer";
import { getMisconception, getExplanation } from "@/lib/content/registry";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { TextWithMath } from "@/lib/render/text-with-math";
import { publish } from "@/lib/data-bus";
import { recordError } from "@/lib/eke/error-bank";
import { getPracticeState } from "@/lib/eke/practice-mode";
import { recordAttempt as recordSchedulerAttempt } from "@/lib/eke/scheduler";
import { enqueueEscalation } from "@/lib/safeguarding/escalation-queue";
import { useA11y } from "./AccessibilityProvider";
import {
  getSpeechSupport,
  startSpeechRecognition,
  type SpeechSession,
} from "@/lib/a11y/speech";

interface Props {
  tone?: EkeTone;
  jurisdiction?: string;
  studentAgeBand?: string;
  problemTitle?: string;
  problemBody?: string;
  /**
   * Optional expected numeric answer for the active problem. When set,
   * the engine runs the deterministic answer-checker and surfaces a
   * categorised Socratic response without ever revealing the value.
   *
   * **Opt-in by design.** The default is `undefined` so surfaces hosting
   * non-numeric problems (e.g. the trades welding pre-job-check or the
   * adult-learner SQL prompt) do not accidentally treat `6` (or any
   * other number) as "correct". Each surface declares this explicitly.
   *
   * As of v1.5.1 a string value is also accepted, routed to the
   * math.js-backed symbolic answer-checker (`diagnoseSymbolicAttempt`).
   * A string that parses as a finite number is normalised to the numeric
   * path (full back-compat). The sentinel `"qualitative-no-auto-check"`
   * opts a surface out of auto-checking entirely — the engine
   * deliberately abstains and routes the attempt to teacher-marking via
   * the Integrity Ledger.
   *
   * See HONESTY.md §2 "Answer validation" and §4.3 (v1.5.1 symbolic
   * path).
   */
  problemAnswer?: number | string;
  /**
   * Optional opaque id for the active problem. When provided, the
   * v1.4.4 spacing scheduler records each validated attempt against
   * this id (Leitner-box state machine in `lib/eke/scheduler.ts`).
   *
   * **Opt-in by design**, like `problemAnswer`. Surfaces that don't yet
   * have a stable per-problem id (or whose problems are non-numeric and
   * therefore don't generate validated categories) simply omit the prop;
   * no scheduler state is created and the right-rail "Coming back today"
   * card stays hidden.
   *
   * The id is stored verbatim — never combined with learner text or with
   * the expected value. See `lib/eke/scheduler.ts` privacy contract.
   */
  problemId?: string;
  /**
   * Optional skill-family key (v1.4.5). When set, after tiers 1-3 are
   * exhausted Eke will serve a tier-4 hint: a fully-worked **parallel
   * problem** in the same family but with different numbers, sourced
   * from `lib/eke/parallel-problems.ts`. Same opt-in discipline as
   * `problemAnswer` and `problemId`.
   */
  skillFamily?: string;
  zeroPaste?: boolean;
}

export default function EkeChat({
  tone = "mentor",
  jurisdiction = "IE",
  studentAgeBand = "Y9-11",
  problemTitle = "Today's problem",
  problemBody = "Solve for x: 2x + 5 = 17",
  problemAnswer,
  problemId,
  skillFamily,
  zeroPaste = true,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const { settings: a11y } = useA11y();
  // Effective tone derives from base tone + literalTone a11y toggle so the
  // engine and the UI stay in sync. Engine is constructed lazily once per
  // session — toggling literalTone after mount has no effect until the chat
  // remounts (documented in SAFEGUARDING.md §1.6).
  const effectiveTone = getEffectiveTone({ baseTone: tone, literalTone: a11y.literalTone });
  const [engine] = useState<EkeEngine>(() =>
    createKeLe({
      tone: effectiveTone,
      jurisdiction,
      studentAgeBand,
      problemAnswer,
      skillFamily,
    })
  );
  // The IPA analyser is constructed once at mount. It honours the
  // assistive-input declaration so cadence-based mimicry components are
  // suppressed for users of eye-gaze, switch, dictation, sticky-keys, or
  // word-prediction tools. Paste and focus-loss signals still apply.
  // See SAFEGUARDING.md §1.5.
  const [ipa] = useState(() =>
    createIPAAnalyzer({ assistiveInput: a11y.assistiveInput }),
  );
  const [messages, setMessages] = useState<EkeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [trust, setTrust] = useState(100);
  const [mimicryPct, setMimicryPct] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // v1.5.0 — track which content-pack teaching messages have already been
  // shown this session so we don't repeat the same misconception or
  // explanation on every wrong attempt. Keyed by `${category}:${problemId}`.
  // The shape is per-tab, in-memory only.
  const teachingShownRef = useRef<Set<string>>(new Set());
  const speechSessionRef = useRef<SpeechSession | null>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const speechCloseRef = useRef<HTMLButtonElement>(null);
  const [speechOpen, setSpeechOpen] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const speechSupport = getSpeechSupport();

  useEffect(() => {
    setMessages([engine.greet()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Speech recognition is a long-lived browser resource. If the chat
  // surface unmounts (route change, hot reload, parent re-mount) while
  // listening is active, stop the session — otherwise the
  // SpeechRecognition keeps running and the mic indicator stays on.
  useEffect(() => {
    return () => {
      speechSessionRef.current?.stop();
      speechSessionRef.current = null;
    };
  }, []);

  // Speech-to-text dialog: focus the close button on open, restore focus
  // to the mic trigger on close, and close on Escape — same dialog
  // semantics as AccessibilitySettingsPanel.
  useEffect(() => {
    if (!speechOpen) {
      micButtonRef.current?.focus();
      return;
    }
    speechCloseRef.current?.focus();
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setSpeechOpen(false);
        speechSessionRef.current?.stop();
        speechSessionRef.current = null;
        setSpeechActive(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [speechOpen]);

  // Returns the practice-mode marker bundle to spread into student.* event
  // payloads. When practice is inactive, returns an empty object so events
  // are byte-identical to pre-v1.4.3 shape. The teacher Ledger filters on
  // `practiceMode === true`; absence is equivalent to "not practice" by
  // contract (see lib/eke/practice-mode.ts header).
  const practiceMarker = (): {
    practiceMode?: true;
    practiceSessionId?: string;
  } => {
    const ps = getPracticeState();
    if (!ps.active || !ps.sessionId) return {};
    return { practiceMode: true, practiceSessionId: ps.sessionId };
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    const text = input.trim();
    const newMessages = await engine.receive(text);
    setMessages((prev) => [...prev, ...newMessages]);
    setInput("");
    setSending(false);
    // Announce the submission to other surfaces. We deliberately do NOT
    // forward the learner's text — only the metadata. Privacy first.
    publish(
      "student.submit",
      {
        chars: text.length,
        trust,
        mimicryPct,
        problemTitle,
        jurisdiction,
        ...practiceMarker(),
      },
      "student"
    );
    // v1.4.8 — DSL escalation pipeline. If the Decision Gate blocked this
    // turn with a crisis_response trigger, fan the (category-only) signal
    // out two ways: (a) publish a `safeguarding.escalation.requested`
    // bus event so the Compliance "Safeguarding Escalations" card
    // refreshes live, and (b) enqueue a signed envelope locally for
    // optional delivery to the school's configured DSL endpoint.
    //
    // CONTRACT: NO learner free-form text reaches either path. The
    // `enqueueEscalation` API does not accept a `text` parameter, and
    // the bus payload below is category-only. If a future contributor is
    // tempted to add the learner's message in, the type system rejects
    // them. See `lib/safeguarding/escalation-queue.ts` privacy contract.
    const blockedReply = newMessages.find(
      (m) => m.role === "eke" && m.blocked,
    );
    if (
      blockedReply?.blockedTrigger === "crisis_response" &&
      blockedReply.blockedCrisisCategory
    ) {
      const cat = blockedReply.blockedCrisisCategory;
      try {
        const entry = await enqueueEscalation({
          triggerType: "crisis_response",
          crisisPatternCategory: cat,
          jurisdiction,
          studentAgeBand,
        });
        publish(
          "safeguarding.escalation.requested",
          {
            id: entry.id,
            triggerType: "crisis_response",
            crisisPatternCategory: cat,
            jurisdiction,
            studentAgeBand,
          },
          "student",
        );
      } catch {
        // Signing or storage failure must not break the learner-facing
        // helpline message. The block message still rendered above.
      }
    }
    // If the engine routed this turn through the answer-checker, also
    // publish an `answer.validated` event so the Teacher Integrity
    // Ledger can show correctness alongside methodology. The category
    // (correct / off_by_one / sign_flipped / doubled / halved / wrong)
    // is the only payload — never the learner's text and never the
    // expected value.
    const reply = newMessages.find(
      (m) => m.role === "eke" && m.answerCategory
    );
    if (reply?.answerCategory) {
      publish(
        "student.answer.validated",
        {
          category: reply.answerCategory,
          correct: reply.answerCategory === "correct",
          problemTitle,
          jurisdiction,
          ...practiceMarker(),
        },
        "student"
      );
      // v1.4.2 named-error + personal error-bank. Non-correct, non-no_attempt
      // categories are persisted to the learner's private journal on this
      // device and announced on the bus so surfaces (e.g. the "My patterns"
      // card on /student) can refresh live. The payload is category-only,
      // matching the no-leak contract above — never learner text, never the
      // expected value. recordError() itself ignores `correct`/`no_attempt`.
      const cat = reply.answerCategory;
      if (cat !== "correct" && cat !== "no_attempt") {
        recordError(cat, problemTitle);
        publish(
          "student.error.observed",
          { category: cat, problemTitle, jurisdiction, ...practiceMarker() },
          "student",
        );
      }
      // v1.4.4 spacing scheduler. When the surface has declared a stable
      // problemId, every validated attempt drives the Leitner state
      // machine: `correct` promotes the box (cap NUM_BOXES), any other
      // non-skipped category demotes to box 1, and the next dueAt is
      // scheduled at the canonical Leitner cadence (1/3/7/14/30 days).
      // The scheduler ignores `no_attempt` and a missing problemId, so
      // the call site is unconditional.
      if (problemId) {
        recordSchedulerAttempt(problemId, cat);
      }

      // v1.5.0 — surface a teaching message from the signed content
      // registry, if one is available for this (skillFamily, problemId,
      // category). The registry is *additive*: if no manifest is loaded
      // or no item matches, this is a no-op and the engine continues to
      // behave exactly as v1.4.11 did.
      //
      // Two paths:
      //   • A non-correct, non-no_attempt category triggers a keyed
      //     misconception teaching message — shown ONCE per category per
      //     session (teachingShownRef guards repeats).
      //   • A `correct` category triggers the post-answer explanation
      //     ("now you've cracked it, here is *why* this method works…"),
      //     reinforcing methodology rather than substituting for it.
      //
      // The teaching messages are pre-authored, signed, and verified at
      // load time. They are not generated at runtime. There is no model
      // in this code path.
      if (skillFamily && problemId) {
        const key = `${cat}:${problemId}`;
        if (!teachingShownRef.current.has(key)) {
          teachingShownRef.current.add(key);
          if (cat === "correct") {
            void surfaceTeachingMessage(
              () => getExplanation(skillFamily, problemId),
              "Why this method works",
            );
          } else if (cat !== "no_attempt") {
            void surfaceTeachingMessage(
              async () => {
                const m = await getMisconception(skillFamily, problemId, cat);
                if (!m) return null;
                return m.nudge ? `${m.explanation}\n\n${m.nudge}` : m.explanation;
              },
              "Common slip on this kind of problem",
            );
          }
        }
      }
    }
  };

  /**
   * Helper for v1.5.0 teaching messages. Resolves the content-pack lookup,
   * and on a non-null result appends a labelled assistant turn to the
   * conversation. Failures (missing manifest, signature mismatch, network
   * error) are silent by design — the engine's existing reply already
   * carries the Socratic nudge, so the absence of a teaching message is
   * a graceful degradation rather than a user-visible error.
   */
  async function surfaceTeachingMessage(
    lookup: () => Promise<string | null>,
    label: string,
  ) {
    try {
      const text = await lookup();
      if (!text) return;
      const teachingMsg: EkeMessage = {
        id: `teach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "eke",
        content: `${label}:\n\n${text}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, teachingMsg]);
    } catch {
      // Registry unavailable; fall back silently to the v1.4.11 behaviour.
    }
  }

  const requestHint = () => {
    const msg = engine.nextHint();
    setMessages((prev) => [...prev, msg]);
    publish(
      "student.hint.requested",
      { tier: msg.hintTier ?? null, problemTitle, ...practiceMarker() },
      "student"
    );
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const recomputeTrust = () => {
    const p = ipa.calculateMimicryProbability();
    setMimicryPct(Math.round(p * 100));
    setTrust(Math.max(0, Math.round((1 - p) * 100)));
  };

  const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    ipa.recordKeystroke();
    recomputeTrust();
  };

  const stopSpeech = () => {
    speechSessionRef.current?.stop();
    speechSessionRef.current = null;
    setSpeechActive(false);
  };

  const startSpeech = () => {
    setSpeechError(null);
    if (!speechSupport.supported) {
      setSpeechError(speechSupport.reason ?? "Speech-to-text is not supported in this browser.");
      return;
    }
    // Ensure we don't leak multiple recognition sessions.
    stopSpeech();
    setSpeechActive(true);
    speechSessionRef.current = startSpeechRecognition(
      {
        onResult: (text, isFinal) => {
          // The Web Speech API fires onresult for every interim refinement
          // AND for the final transcript (e.g. "hello" → "hello world" →
          // "hello world." final). To avoid duplicated text we only append
          // when the result has been finalised.
          //
          // We deliberately do NOT route speech results through the IPA
          // analyser: dictation is not keystroke evidence and would
          // distort cadence statistics for learners who switch input modes
          // mid-session. Paste and focus-loss tracking still apply.
          if (!isFinal) return;
          const piece = text.trim();
          if (!piece) return;
          setInput((prev) => (prev.length === 0 ? piece : `${prev} ${piece}`));
        },
        onError: (err) => {
          setSpeechError(err);
          stopSpeech();
        },
        onEnd: () => {
          stopSpeech();
        },
      },
      { lang: locale, interimResults: true },
    );
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    ipa.recordPasteAttempt();
    recomputeTrust();
    publish(
      "student.paste.blocked",
      { zeroPaste, problemTitle, ...practiceMarker() },
      "student"
    );
    if (zeroPaste) {
      e.preventDefault();
    }
  };

  // Focus loss is a strong mimicry signal: the most common attack pattern is
  // "copy the problem → tab to ChatGPT → tab back → paste" which always
  // leaves the chat textarea between steps. We forward each blur to the IPA
  // analyser so the trust score reflects it.
  const handleBlur = () => {
    ipa.recordFocusLoss();
    recomputeTrust();
  };

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden"
      style={{
        background: "var(--bg-alt)",
        border: "1px solid var(--border)",
        height: "100%",
        minHeight: 520,
      }}
    >
      {/* header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-serif text-sm font-semibold"
            style={{
              background: "var(--accent)",
              color: "var(--paper)",
            }}
          >
            Ke
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
              Eke
            </p>
            <p
              className="font-mono"
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
              }}
            >
              {t("eke.modeLine", { tone: effectiveTone })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="kl-badge"
            title={
              a11y.assistiveInput
                ? `Mimicry probability: ${mimicryPct}% (cadence checks suppressed; assistive input declared)`
                : `Mimicry probability: ${mimicryPct}%`
            }
            aria-label={`Trust score ${trust} out of 100`}
            style={{
              background:
                trust >= 70
                  ? "var(--accent-soft)"
                  : trust >= 40
                  ? "rgba(245, 166, 35, 0.15)"
                  : "rgba(229, 82, 74, 0.15)",
              color:
                trust >= 70
                  ? "var(--accent)"
                  : trust >= 40
                  ? "var(--amber, #BA7517)"
                  : "var(--red)",
            }}
          >
            <Activity size={10} aria-hidden="true" /> {t("eke.trust")} {trust}
          </span>
          {zeroPaste && (
            <span className="kl-badge" aria-label="Paste blocked on this surface">
              <Shield size={10} aria-hidden="true" /> {t("eke.noPaste")}
            </span>
          )}
          {/* Surface a discreet badge so the silenced cadence checks are
              explainable. Hidden by default; CSS reveals it when the
              user has declared assistive input. */}
          <span
            className="kl-badge"
            data-show-when-assistive="true"
            title="Assistive input declared. Cadence-based mimicry checks are suppressed; paste and focus-loss tracking still apply."
          >
            <Accessibility size={10} aria-hidden="true" /> Assistive
          </span>
        </div>
      </div>

      {/* problem context */}
      <div
        className="px-5 py-3"
        style={{
          background: "var(--bg-deep)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <p
          className="font-mono"
          style={{
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--fg-faint)",
            marginBottom: 4,
          }}
        >
          {problemTitle}
        </p>
        <p className="text-sm font-serif" style={{ color: "var(--fg)" }}>
          <TextWithMath>{problemBody}</TextWithMath>
        </p>
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Conversation with Eke"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
        style={{ minHeight: 260 }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-2 kl-fade-up ${
              m.role === "learner" ? "flex-row-reverse" : ""
            }`}
          >
            <div
              className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-xs font-bold"
              style={{
                background:
                  m.role === "learner"
                    ? "var(--bg-deep)"
                    : m.blocked
                    ? "rgba(229, 82, 74, 0.15)"
                    : "var(--accent-soft)",
                color: m.blocked
                  ? "var(--red)"
                  : m.role === "learner"
                  ? "var(--fg)"
                  : "var(--accent-ink, var(--accent))",
              }}
            >
              {m.role === "learner" ? "You" : "Ke"}
            </div>
            <div
              className="rounded-lg px-3 py-2 text-sm max-w-[80%]"
              style={{
                background:
                  m.role === "learner"
                    ? "var(--bg-deep)"
                    : m.blocked
                    ? "rgba(229, 82, 74, 0.08)"
                    : "var(--bg)",
                color: "var(--fg)",
                border: "1px solid",
                borderColor: m.blocked
                  ? "rgba(229, 82, 74, 0.3)"
                  : "var(--border)",
                // Preserve newlines so the v1.4.5 tier-4 multi-line worked
                // parallel renders correctly. Single-line messages are
                // unaffected.
                whiteSpace: "pre-line",
                // Tier 4 uses column-aligned arithmetic (Step 1, Step 2)
                // that benefits from a fixed-width font; tiers 1-3 stay
                // in the surface's default sans.
                fontFamily: m.hintTier === 4 ? "var(--mono)" : undefined,
              }}
            >
              <TextWithMath>{m.content}</TextWithMath>
              {m.hintTier && (
                <span
                  className="kl-badge ml-2"
                  style={{ fontSize: 9, fontFamily: "var(--sans)" }}
                >
                  {m.hintTier === 4 ? "Tier 4 · Worked parallel" : `Tier ${m.hintTier}`}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* input */}
      <div
        className="p-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={requestHint}
            aria-label="Ask Eke for a tiered hint"
            className="kl-tap-target rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 transition"
            style={{
              background: "var(--bg-deep)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
            }}
            title="Ask Eke for a tiered hint"
          >
            <Lightbulb size={14} aria-hidden="true" /> {t("eke.hint")}
          </button>

          <button
            type="button"
            ref={micButtonRef}
            onClick={() => setSpeechOpen(true)}
            disabled={!speechSupport.supported}
            aria-haspopup="dialog"
            aria-expanded={speechOpen}
            aria-label={
              speechSupport.supported
                ? "Speech-to-text options"
                : "Speech-to-text not supported in this browser"
            }
            className="kl-tap-target rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 transition disabled:opacity-50"
            style={{
              background: "var(--bg-deep)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
            }}
            title={
              speechSupport.supported
                ? "Speech-to-text (requires microphone permission)"
                : speechSupport.reason
            }
          >
            <Mic size={14} aria-hidden="true" />
          </button>
          <label htmlFor="eke-input" className="sr-only">
            Type your reasoning to Eke. Press Enter to send.
          </label>
          <textarea
            id="eke-input"
            value={input}
            onChange={handleTyping}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            onBlur={handleBlur}
            rows={1}
            placeholder="Type your reasoning. Enter to send."
            aria-describedby="eke-input-hint"
            className="flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              fontFamily: "var(--sans)",
              minHeight: 44,
            }}
          />
          <span id="eke-input-hint" className="sr-only">
            Eke replies with Socratic hints, not answers. Pasting is blocked
            on this surface.
          </span>
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || sending}
            aria-label="Send message to Eke"
            className="kl-tap-target rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 transition disabled:opacity-50"
            style={{
              background: "var(--accent)",
              color: "var(--paper)",
            }}
          >
            <Send size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Speech-to-text disclosure + controls. We do NOT start recognition
          until the user explicitly consents because browser speech
          recognition may use a remote service. */}
      {speechOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="speech-title"
          className="fixed inset-0 z-[120]"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSpeechOpen(false);
              stopSpeech();
            }
          }}
        >
          <div
            className="fixed left-1/2 top-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="speech-title" className="font-serif text-lg" style={{ color: "var(--fg)" }}>
                  Speech-to-text
                </h3>
                <p className="text-sm mt-1" style={{ color: "var(--fg-dim)", lineHeight: 1.55 }}>
                  If you choose to use speech-to-text, your browser may send
                  microphone audio to a speech service to create the transcript.
                  Even Keel Learning does not store audio, and the transcript stays only
                  in this text box.
                </p>
              </div>
              <button
                type="button"
                ref={speechCloseRef}
                aria-label="Close speech-to-text"
                className="kl-tap-target inline-flex items-center justify-center rounded-md"
                style={{ width: 44, height: 44, border: "1px solid var(--border)", color: "var(--fg)" }}
                onClick={() => {
                  setSpeechOpen(false);
                  stopSpeech();
                }}
              >
                <MicOff size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2" aria-live="polite">
              {!speechActive ? (
                <button
                  type="button"
                  className="kl-tap-target inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  style={{ background: "var(--accent)", color: "var(--paper)" }}
                  onClick={startSpeech}
                >
                  <Mic size={16} aria-hidden="true" /> Start dictation
                </button>
              ) : (
                <button
                  type="button"
                  className="kl-tap-target inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  style={{ background: "var(--bg-deep)", color: "var(--fg)", border: "1px solid var(--border)" }}
                  onClick={stopSpeech}
                >
                  <MicOff size={16} aria-hidden="true" /> Stop dictation
                </button>
              )}
              <span className="text-xs" style={{ color: "var(--fg-faint)" }}>
                {speechActive ? "Listening…" : "Not listening"}
              </span>
            </div>

            {speechError && (
              <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>
                {speechError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
