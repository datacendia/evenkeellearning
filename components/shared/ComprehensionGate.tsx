"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, Lock, Unlock, Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

export interface GateQuestion {
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface Props {
  /** Optional override for the gate title; defaults to translated `gate.title`. */
  title?: string;
  subject?: string;
  questions?: GateQuestion[];
  onCleared?: () => void;
}

const DEFAULT_QUESTIONS: GateQuestion[] = [
  {
    prompt:
      "You solved 2x + 5 = 17 and got x = 6. In your OWN words, why do we subtract 5 from both sides first?",
    options: [
      "Because the teacher said to.",
      "To isolate the term with x by undoing the +5.",
      "Because 5 is smaller than 17.",
      "To make the equation look neater.",
    ],
    correct: 1,
    explanation:
      "The goal is isolating x. Subtracting 5 on both sides reverses the +5 so the x-term stands alone — that's the principle, not the recipe.",
  },
  {
    prompt:
      "If the equation had been 2x + 5 = 19 instead, which step would change?",
    options: [
      "The division step, not the subtraction step.",
      "Both steps would be completely different.",
      "Only the final numerical answer — the method is identical.",
      "We'd need a different type of equation.",
    ],
    correct: 2,
    explanation:
      "The structure of a linear equation dictates the method. Only the numbers change; the reasoning is the same.",
  },
  {
    prompt: "What makes this a 'linear' equation rather than something else?",
    options: [
      "The variable x appears with exponent 1 only.",
      "It has an equals sign.",
      "It has two steps to solve.",
      "It uses the number 2.",
    ],
    correct: 0,
    explanation:
      "Linear means the variable's highest power is 1. That's why the graph is a straight line.",
  },
];

type Status = "idle" | "answered" | "cleared" | "failed";

export default function ComprehensionGate({
  title,
  subject = "Linear equations",
  questions = DEFAULT_QUESTIONS,
  onCleared,
}: Props) {
  const t = useT();
  const titleText = title ?? t("gate.title");
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [wrongCount, setWrongCount] = useState(0);

  const q = questions[idx];
  const cleared = status === "cleared";

  const submit = () => {
    if (selected === null) return;
    if (selected === q.correct) {
      if (idx + 1 >= questions.length) {
        setStatus("cleared");
        onCleared?.();
      } else {
        setStatus("answered");
      }
    } else {
      setWrongCount((w) => w + 1);
      setStatus("failed");
    }
  };

  const next = () => {
    setIdx(idx + 1);
    setSelected(null);
    setStatus("idle");
  };

  const retry = () => {
    setSelected(null);
    setStatus("idle");
  };

  return (
    <div className="kl-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* header */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-deep)" }}
      >
        <div className="flex items-center gap-3">
          {cleared ? (
            <Unlock size={18} style={{ color: "var(--accent)" }} />
          ) : (
            <Lock size={18} style={{ color: "var(--fg-dim)" }} />
          )}
          <div>
            <p
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
              }}
            >
              {titleText} · {subject}
            </p>
            <p className="text-sm font-semibold mt-0.5">
              {cleared
                ? t("gate.cleared")
                : t("gate.questionN", { n: idx + 1, total: questions.length })}
            </p>
          </div>
        </div>
        {wrongCount > 0 && !cleared && (
          <span
            className="font-mono"
            style={{ fontSize: 10, color: "var(--red)", letterSpacing: "0.06em" }}
          >
            {t("gate.attempts", { n: wrongCount })}
          </span>
        )}
      </div>

      {/* body */}
      {cleared ? (
        <div className="p-6 text-center">
          <Sparkles
            size={28}
            style={{ color: "var(--accent)", margin: "0 auto 10px" }}
          />
          <p className="font-serif text-2xl mb-2">{t("gate.cleared.title")}</p>
          <p className="text-sm" style={{ color: "var(--fg-dim)" }}>
            {t("gate.cleared.body")}
          </p>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <p className="text-base">{q.prompt}</p>

          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const isSelected = selected === i;
              const isCorrect = status !== "idle" && i === q.correct;
              const isWrong = status === "failed" && isSelected;
              return (
                <button
                  key={i}
                  disabled={status !== "idle"}
                  onClick={() => setSelected(i)}
                  className="w-full text-left px-3.5 py-2.5 rounded-lg text-sm transition flex items-center gap-2.5 disabled:cursor-not-allowed"
                  style={{
                    background: isCorrect
                      ? "var(--accent-soft)"
                      : isWrong
                      ? "rgba(197, 48, 48, 0.08)"
                      : isSelected
                      ? "var(--bg-deep)"
                      : "var(--bg)",
                    border: "1px solid",
                    borderColor: isCorrect
                      ? "var(--accent)"
                      : isWrong
                      ? "var(--red)"
                      : isSelected
                      ? "var(--fg-dim)"
                      : "var(--border)",
                    color: "var(--fg)",
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-mono"
                    style={{
                      background: isCorrect
                        ? "var(--accent)"
                        : isWrong
                        ? "var(--red)"
                        : "var(--bg-deep)",
                      color:
                        isCorrect || isWrong ? "var(--paper)" : "var(--fg-dim)",
                    }}
                  >
                    {isCorrect ? (
                      <CheckCircle2 size={12} />
                    ) : isWrong ? (
                      <XCircle size={12} />
                    ) : (
                      String.fromCharCode(65 + i)
                    )}
                  </span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>

          {status !== "idle" && (
            <div
              className="rounded-md p-3 text-sm kl-fade-up"
              style={{
                background:
                  status === "failed"
                    ? "rgba(197, 48, 48, 0.06)"
                    : "var(--accent-soft)",
                border: "1px solid",
                borderColor:
                  status === "failed" ? "var(--red)" : "var(--accent)",
                color: "var(--fg)",
              }}
            >
              <strong>
                {status === "failed" ? t("gate.feedback.wrong") : t("gate.feedback.right")}
              </strong>
              {q.explanation}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {status === "idle" && (
              <button
                onClick={submit}
                disabled={selected === null}
                className="px-4 py-2 rounded-md text-sm disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--paper)" }}
              >
                {t("gate.submit")}
              </button>
            )}
            {status === "answered" && (
              <button
                onClick={next}
                className="px-4 py-2 rounded-md text-sm"
                style={{ background: "var(--accent)", color: "var(--paper)" }}
              >
                {t("gate.next")} →
              </button>
            )}
            {status === "failed" && (
              <button
                onClick={retry}
                className="px-4 py-2 rounded-md text-sm"
                style={{ background: "var(--bg-deep)", border: "1px solid var(--border)" }}
              >
                {t("gate.tryAgain")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
