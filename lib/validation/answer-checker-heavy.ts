// ─────────────────────────────────────────────────────────────────────────────
// lib/validation/answer-checker-heavy.ts
//
// Heavy-CAS-backed answer-checker (v1.5.3). Wraps the math.js-backed
// `diagnose(...)` path with an escalation to Pyodide + Sympy when
// math.js's simplifier returns a `wrong` verdict that *might* be a
// transcendental / trig / advanced-algebra identity it can't reduce.
//
// Design rationale
// ────────────────
// math.js's `simplify` is sound for the polynomial / rational-function
// fragment we ship for ≤ A-Level content. For higher-maths content
// (graduate calculus, trig identities like `2 sin x cos x = sin(2x)`,
// abstract-algebra reductions) it can return "no simplification" and
// the numeric-sample fallback may reject expressions that ARE
// equivalent at three sample points but happen to differ at one of
// those specific seeds (e.g. branch cuts, removable singularities).
//
// `diagnoseHeavy(...)` accepts the same interface as `diagnose(...)`,
// but is `async` and takes an optional CAS client. It:
//
//   1. Runs the synchronous math.js path first. If it returns
//      `correct` or `no_attempt`, we're done — no escalation.
//   2. If it returns `wrong` AND the answer is symbolic AND the
//      learner's text parses as a math.js expression, we ask Pyodide
//      to simplify `(actual) - (expected)`. If the result is 0,
//      math.js was wrong and we upgrade the verdict to `correct`.
//   3. Otherwise the math.js verdict stands.
//
// Trust contract
// ──────────────
// • OFF the engine hot path. The engine still calls the synchronous
//   `diagnose(...)` (which has no model, no network, ~1 ms latency).
//   Surfaces that want the heavy path call this module directly.
// • Pyodide is loaded lazily on first use. Fetches WASM assets from a
//   pinned CDN (or self-hosted via `getHeavyCAS({ indexURL })`).
//   Learner text never leaves the device — Pyodide is a local
//   interpreter, not a remote API.
// • Information-leakage discipline preserved: the diagnostic returned
//   is the same shape `diagnose(...)` returns, with no expected value
//   ever surfaced in `hint`.
// • Failures degrade silently: if Pyodide is unavailable / errors /
//   times out, we fall back to the math.js verdict. We never leave a
//   surface waiting forever.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type AnswerDiagnostic,
  type DiagnoseOptions,
  diagnose,
} from "./answer-checker";
import {
  type CASResult,
  type HeavyCASClient,
  HeavyCASTimeoutError,
  HeavyCASUnavailableError,
  getHeavyCAS,
} from "../cas/heavy-client";

/**
 * Why the math.js verdict was kept or upgraded. Surfaces and logs
 * use this for telemetry / debugging — never for learner-facing copy.
 */
export type HeavyEscalationReason =
  | "no-escalation-correct"
  | "no-escalation-no-attempt"
  | "no-escalation-numeric-path"
  | "escalated-confirmed-wrong"
  | "escalated-upgraded-to-correct"
  | "escalation-skipped-empty-text"
  | "escalation-failed-cas-unavailable"
  | "escalation-failed-timeout"
  | "escalation-failed-error";

export interface HeavyDiagnosticEnvelope {
  /** The verdict surfaces should consume. Same shape as diagnose(). */
  diagnostic: AnswerDiagnostic;
  /** Audit trail of why the verdict is what it is. */
  reason: HeavyEscalationReason;
  /** True iff Pyodide was actually consulted. */
  escalated: boolean;
}

export interface DiagnoseHeavyOptions extends DiagnoseOptions {
  /**
   * Inject an alternate CAS client. Defaults to the module-level
   * singleton from `lib/cas/heavy-client.ts`. Tests use this to inject
   * a mock; surfaces with stricter privacy controls (self-hosted
   * Pyodide, custom indexURL) can use it to point at their own client.
   */
  casClient?: HeavyCASClient;
  /**
   * Hard timeout for the escalation step in milliseconds. If Pyodide
   * doesn't respond in this window, we keep the math.js verdict.
   * Default 10 000 ms.
   */
  escalationTimeoutMs?: number;
  /**
   * Optional AbortSignal to cancel the escalation early (e.g., if the
   * learner navigates away). Cancellation falls through to the
   * math.js verdict.
   */
  signal?: AbortSignal;
}

const DEFAULT_ESCALATION_TIMEOUT_MS = 10_000;

/**
 * Heavy-CAS-backed dispatcher. Always returns a verdict (never throws);
 * `reason` records what happened.
 */
export async function diagnoseHeavy(
  text: string,
  expected: number | string,
  options: DiagnoseHeavyOptions = {},
): Promise<HeavyDiagnosticEnvelope> {
  // Step 1: synchronous math.js path. This is the same call the engine
  // makes — same trust contract, same latency profile.
  const baseline = diagnose(text, expected, options);

  // Numeric expected → math.js is the right tool, no escalation.
  if (typeof expected === "number") {
    return {
      diagnostic: baseline,
      reason: "no-escalation-numeric-path",
      escalated: false,
    };
  }

  if (baseline.category === "correct") {
    return {
      diagnostic: baseline,
      reason: "no-escalation-correct",
      escalated: false,
    };
  }
  if (baseline.category === "no_attempt") {
    return {
      diagnostic: baseline,
      reason: "no-escalation-no-attempt",
      escalated: false,
    };
  }

  // Step 2: escalate the `wrong` verdict to Pyodide. We need actual
  // text to consult on.
  const actualText = (typeof text === "string" ? text : "").trim();
  if (actualText.length === 0) {
    return {
      diagnostic: baseline,
      reason: "escalation-skipped-empty-text",
      escalated: false,
    };
  }

  const cas = options.casClient ?? getHeavyCAS();
  const timeoutMs = options.escalationTimeoutMs ?? DEFAULT_ESCALATION_TIMEOUT_MS;

  // Compose `(actual) - (expected)` and ask Sympy to simplify. If the
  // result is the literal "0" string, math.js was wrong.
  const diffExpr = `(${actualText}) - (${expected})`;

  // Build a dedicated AbortController for the timeout, optionally
  // chained to the caller's signal so external cancellation works too.
  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort();
  if (options.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const value = await cas.run(
      { op: "simplify", expr: diffExpr },
      ctrl.signal,
    );
    const result = value as CASResult;
    if (typeof result.text === "string" && isAlgebraicZero(result.text)) {
      // Sympy says actual ≡ expected. Upgrade to correct.
      return {
        diagnostic: {
          category: "correct",
          attempt: null,
          // Keep the leakage-safe correct hint shape from the math.js
          // path. We deliberately don't reveal the simplified form,
          // even though Sympy returned it — that would still leak the
          // expected value (because the diff simplified to 0).
          hint: "Looks correct. Why does this method work?",
        },
        reason: "escalated-upgraded-to-correct",
        escalated: true,
      };
    }
    return {
      diagnostic: baseline,
      reason: "escalated-confirmed-wrong",
      escalated: true,
    };
  } catch (err) {
    let reason: HeavyEscalationReason = "escalation-failed-error";
    if (err instanceof HeavyCASUnavailableError) reason = "escalation-failed-cas-unavailable";
    else if (err instanceof HeavyCASTimeoutError) reason = "escalation-failed-timeout";
    else if ((err as Error)?.message === "aborted") reason = "escalation-failed-timeout";
    return {
      diagnostic: baseline,
      reason,
      escalated: false,
    };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Decides whether a Sympy `simplify` result string represents the
 * algebraic zero. Sympy returns `"0"` for the polynomial-zero case,
 * but for some symbolic forms it may return things like `"0.0"` or
 * `"-0"` or a near-zero numeric — we accept all of those.
 */
function isAlgebraicZero(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === "0" || trimmed === "0.0" || trimmed === "-0") return true;
  // If it evaluates to a finite number very close to zero, accept.
  const n = Number(trimmed);
  if (Number.isFinite(n) && Math.abs(n) < 1e-12) return true;
  return false;
}
