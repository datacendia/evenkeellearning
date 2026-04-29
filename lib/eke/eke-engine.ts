// ─────────────────────────────────────────────────────────────────────────────
// lib/eke/eke-engine.ts
//
// The Eke (Key Evidence Logic Engine) Socratic chat engine.
// Bound by the contract in EVENKEEL_BIBLE.md §12.
//
// IMPORTANT: Eke is *not* an LLM. It is a deterministic, template-based
// state machine that:
//   1. Calls `checkSafety()` on every learner message before responding.
//   2. Greets in a tone-appropriate voice (mentor / peer / foreman).
//   3. Serves at most three tiers of hint, each from a static template.
//   4. Refuses to give a direct answer — there is no answer-generation
//      code path in this module. The "no direct answers" property is a
//      *structural* guarantee, not a policy.
//
// The engine is pure; it owns no I/O. State (the conversation log) lives
// inside the engine instance. Use `createKeLe()` from a React component to
// get a per-session instance.
// ─────────────────────────────────────────────────────────────────────────────

import { TONES, EkeTone, ToneProfile } from "./personality";
import { TieredHint, generateTieredHints, revealNext } from "./tiered-hints";
import { hintContainsAnswer } from "./tiered-hints";
import { pickSafeParallel, renderParallelMessage } from "./parallel-problems";
import { checkSafety } from "../regulatory-absorb/decision-gate";
import {
  CrisisPatternCategory,
  SafetyResponse,
  TriggerType,
} from "../regulatory-absorb/types";
import {
  AnswerCategory,
  AnswerDiagnostic,
  diagnose,
  QUALITATIVE_SENTINEL,
} from "../validation/answer-checker";

export interface EkeMessage {
  id: string;
  role: "eke" | "learner";
  content: string;
  timestamp: number;
  hintTier?: 1 | 2 | 3 | 4;
  blocked?: boolean;
  /**
   * If this reply was driven by the answer-checker (v1.4.0), the
   * diagnostic category is surfaced so the UI can publish a
   * `student.answer.validated` bus event without re-running the check.
   */
  answerCategory?: AnswerCategory;
  /**
   * If the Decision Gate blocked this turn, the trigger type is exposed
   * so the UI layer can route a downstream safeguarding event without
   * re-running the gate. Never carries the learner's text. v1.4.8.
   */
  blockedTrigger?: TriggerType;
  /**
   * If `blockedTrigger === "crisis_response"`, this is the family of
   * pattern that matched — used by the DSL escalation pipeline to route
   * a signed, category-only payload. v1.4.8.
   */
  blockedCrisisCategory?: CrisisPatternCategory;
}

export interface EkeContext {
  tone: EkeTone;
  jurisdiction: string;
  studentAgeBand?: string;
  /**
   * Optional expected numeric answer for the active problem. When set,
   * Eke runs the deterministic answer-checker (lib/validation/answer-checker)
   * on each learner message. The checker NEVER leaks the value through the
   * reply — see HONESTY.md §2 "Answer validation".
   *
   * Accepts a number for new callers; legacy string callers are coerced.
   */
  problemAnswer?: number | string;
  /**
   * Optional skill-family key (v1.4.5). When set, the engine can serve a
   * **tier-4** hint after tiers 1-3 are exhausted: a fully-worked
   * **parallel problem** from `lib/eke/parallel-problems.ts` that shares
   * the same skill shape but uses different numbers. The leak guard
   * (`hintContainsAnswer`) still runs, so a parallel whose worked
   * solution would echo the original's expected value is rejected.
   *
   * **Opt-in by design.** Surfaces that omit `skillFamily` — including
   * every existing test — keep the previous 3-tier ceiling and the
   * "I've offered every hint I can" fallback. See HONESTY.md §2.1.
   */
  skillFamily?: string;
}

export class EkeEngine {
  private context: EkeContext;
  private hints: TieredHint[];
  private messages: EkeMessage[] = [];

  constructor(context: EkeContext) {
    this.context = context;
    this.hints = generateTieredHints();
  }

  get tone(): ToneProfile {
    return TONES[this.context.tone];
  }

  greet(): EkeMessage {
    const msg: EkeMessage = {
      id: this.id(),
      role: "eke",
      content: this.tone.greeting,
      timestamp: Date.now(),
    };
    this.messages.push(msg);
    return msg;
  }

  async receive(input: string): Promise<EkeMessage[]> {
    const learnerMsg: EkeMessage = {
      id: this.id(),
      role: "learner",
      content: input,
      timestamp: Date.now(),
    };
    this.messages.push(learnerMsg);

    const safety: SafetyResponse = await checkSafety({
      text: input,
      jurisdiction: this.context.jurisdiction,
      studentAgeBand: this.context.studentAgeBand,
    });

    if (!safety.allow) {
      const blocked: EkeMessage = {
        id: this.id(),
        role: "eke",
        content: safety.userMessage ?? this.tone.blockedTone,
        timestamp: Date.now(),
        blocked: true,
        blockedTrigger: safety.triggerType,
        blockedCrisisCategory: safety.crisisPatternCategory,
      };
      this.messages.push(blocked);
      return [learnerMsg, blocked];
    }

    // ── Answer validation (v1.4.0, symbolic path v1.5.1) ───────────────
    // If the problem has a known answer (numeric OR symbolic), divert to
    // a categorised Socratic response. The `diagnose` dispatcher chooses
    // the numeric or math.js-backed symbolic path based on the runtime
    // type of `expected`. Defence-in-depth: even though both checkers
    // are contracted not to leak the expected value, we re-check via
    // hintContainsAnswer before committing the reply. If the guard fires
    // we fall back to the tiered-hint pipeline.
    //
    // Qualitative-sentinel items (English Q3, MFL essays, etc.) are
    // deliberately skipped here — those route to teacher-marking via
    // the Integrity Ledger, not to the auto-checker.
    const expected = this.coerceExpected();
    if (expected !== null && expected !== QUALITATIVE_SENTINEL) {
      const diagnostic = diagnose(input, expected);
      if (diagnostic.category !== "no_attempt") {
        const replyText = `${this.tone.hintPrefix} ${diagnostic.hint}`.trim();
        const safe = !hintContainsAnswer(replyText, String(expected));
        if (safe) {
          const reply: EkeMessage = {
            id: this.id(),
            role: "eke",
            content: replyText,
            timestamp: Date.now(),
            answerCategory: diagnostic.category,
          };
          this.messages.push(reply);
          return [learnerMsg, reply];
        }
      }
    }

    const reply = this.nextHint();
    this.messages.push(reply);
    return [learnerMsg, reply];
  }

  /**
   * Returns the configured `problemAnswer` as either a finite number
   * (numeric items) or a non-empty string (symbolic / qualitative items),
   * or null when unset / unusable.
   *
   * Back-compat: a string that parses as a finite number is still
   * returned as a number, so existing callers that configure a numeric
   * answer through the string form behave identically. String values
   * that do NOT parse as numbers are passed through to the symbolic
   * path (e.g. `"(x+1)(x+2)"`, or the `qualitative-no-auto-check`
   * sentinel).
   */
  private coerceExpected(): number | string | null {
    const raw = this.context.problemAnswer;
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "number") {
      return Number.isFinite(raw) ? raw : null;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
    return trimmed;
  }

  /**
   * Narrows `coerceExpected()` to the numeric form for call sites that
   * can only handle numbers (the parallel-problem selector, the leak
   * guard's numeric tolerance path).
   */
  private coerceExpectedNumeric(): number | null {
    const v = this.coerceExpected();
    return typeof v === "number" ? v : null;
  }

  /**
   * Read-only view of the most recent diagnostic, exposed for tests and
   * for surfaces that want to publish `student.answer.validated` events.
   */
  lastAnswerDiagnostic(): AnswerDiagnostic | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.role === "eke" && m.answerCategory) {
        return {
          category: m.answerCategory,
          attempt: null,
          hint: m.content,
        };
      }
    }
    return null;
  }

  /**
   * Tier-4 worked parallel is served at most once per session. Once it
   * has fired, every subsequent `nextHint()` call falls through to the
   * "I've offered every hint I can" line so the learner is gently
   * pushed back to their own reasoning rather than handed a stream of
   * worked examples.
   */
  private parallelServed = false;

  nextHint(): EkeMessage {
    // Tiers 1-3 are template-driven and unchanged from v1.3.0.
    const allRevealed = this.hints.every((h) => h.isRevealed);
    if (!allRevealed) {
      this.hints = revealNext(this.hints);
      const revealed = this.hints.filter((h) => h.isRevealed);
      const last = revealed[revealed.length - 1]!;
      return {
        id: this.id(),
        role: "eke",
        content: `${this.tone.hintPrefix} ${last.content}`,
        timestamp: Date.now(),
        hintTier: last.tier,
      };
    }

    // v1.4.5 tier-4: a fully-worked parallel problem in the same skill
    // family. Defence-in-depth via `hintContainsAnswer` is run inside
    // `pickSafeParallel`. Both gates must pass: the surface declared a
    // `skillFamily`, and a leak-safe candidate survives the guard.
    if (!this.parallelServed && this.context.skillFamily) {
      const parallel = pickSafeParallel(
        this.context.skillFamily,
        this.coerceExpectedNumeric(),
      );
      if (parallel) {
        this.parallelServed = true;
        return {
          id: this.id(),
          role: "eke",
          content: renderParallelMessage(parallel),
          timestamp: Date.now(),
          hintTier: 4,
        };
      }
    }

    return {
      id: this.id(),
      role: "eke",
      content: "I've offered every hint I can. Trust your reasoning — what does your gut say?",
      timestamp: Date.now(),
    };
  }

  history(): EkeMessage[] {
    return [...this.messages];
  }

  hintTierUsed(): number {
    const tier3Used = this.hints.filter((h) => h.isRevealed).length;
    return tier3Used + (this.parallelServed ? 1 : 0);
  }

  reset(): void {
    this.hints = generateTieredHints();
    this.messages = [];
    this.parallelServed = false;
  }

  private id(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function createKeLe(context: EkeContext): EkeEngine {
  return new EkeEngine(context);
}
