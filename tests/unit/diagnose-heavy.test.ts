// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/diagnose-heavy.test.ts
//
// Tests for the v1.5.3 heavy-CAS escalation dispatcher
// (`lib/validation/answer-checker-heavy.ts`). Pyodide is browser-only,
// so we inject a stub `HeavyCASClient` whose `run()` returns a scripted
// response. That lets us pin every escalation reason in pure Node.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";

import { diagnoseHeavy } from "@/lib/validation/answer-checker-heavy";
import {
  type CASArgs,
  type CASResult,
  type CASVersionInfo,
  HeavyCASClient,
  HeavyCASTimeoutError,
  HeavyCASUnavailableError,
} from "@/lib/cas/heavy-client";

/**
 * Build a `HeavyCASClient`-shaped stub whose `run` is a vitest fn.
 * We never spawn a real Worker — `init` resolves immediately and
 * `run` returns whatever the test scripted.
 */
function stubClient(
  runImpl: (args: CASArgs, signal?: AbortSignal) => Promise<CASResult | CASVersionInfo>,
): HeavyCASClient {
  const stub = {
    run: vi.fn((args: CASArgs, signal?: AbortSignal) => runImpl(args, signal)),
    init: vi.fn(() => Promise.resolve()),
    terminate: vi.fn(),
    simplify: vi.fn(),
    expand: vi.fn(),
    factor: vi.fn(),
    integrate: vi.fn(),
    diff: vi.fn(),
    solve: vi.fn(),
    ode: vi.fn(),
    version: vi.fn(),
  } as unknown as HeavyCASClient;
  return stub;
}

describe("diagnoseHeavy", () => {
  it("returns numeric path verdict without escalating", async () => {
    const cas = stubClient(async () => ({ text: "0", latex: "0" }));
    const env = await diagnoseHeavy("3.14", 3.14, { casClient: cas });
    expect(env.escalated).toBe(false);
    expect(env.reason).toBe("no-escalation-numeric-path");
    expect(cas.run).not.toHaveBeenCalled();
  });

  it("does not escalate when math.js path returns `correct`", async () => {
    const cas = stubClient(async () => ({ text: "?", latex: "?" }));
    // (x+1)(x+2) is algebraically equivalent to x^2 + 3x + 2 — math.js
    // accepts this directly, so diagnose() returns `correct`.
    const env = await diagnoseHeavy("(x+1)(x+2)", "x^2 + 3*x + 2", { casClient: cas });
    expect(env.diagnostic.category).toBe("correct");
    expect(env.escalated).toBe(false);
    expect(env.reason).toBe("no-escalation-correct");
    expect(cas.run).not.toHaveBeenCalled();
  });

  it("does not escalate when the learner has not attempted", async () => {
    const cas = stubClient(async () => ({ text: "?", latex: "?" }));
    const env = await diagnoseHeavy("Hi, what should I do?", "x^2 + 1", { casClient: cas });
    expect(env.diagnostic.category).toBe("no_attempt");
    expect(env.escalated).toBe(false);
    expect(env.reason).toBe("no-escalation-no-attempt");
    expect(cas.run).not.toHaveBeenCalled();
  });

  it("upgrades to `correct` when Sympy says the diff simplifies to 0", async () => {
    // Pick an example math.js actively rejects (literally different
    // strings, different simplifications, different sample values).
    // The test pins the WIRING: baseline says wrong, stub says diff=0,
    // the envelope upgrades to correct.
    const cas = stubClient(async (args) => {
      expect(args.op).toBe("simplify");
      return { text: "0", latex: "0" };
    });
    // Build a pathological case: math.js sees "learner says f(x)" but
    // expected is "g(x)" where they're equivalent under some Pyodide-
    // level identity. We use unrelated-looking strings to force math.js
    // to say wrong.
    const env = await diagnoseHeavy("x + 999", "x^2 - x + 17", { casClient: cas });
    expect(env.escalated).toBe(true);
    expect(env.reason).toBe("escalated-upgraded-to-correct");
    expect(env.diagnostic.category).toBe("correct");
    // Information-leakage pin: even when upgraded, the hint must NOT
    // echo the simplified expected form.
    expect(env.diagnostic.hint).not.toMatch(/x\^2|999/);
  });

  it("keeps the `wrong` verdict when Sympy confirms non-zero", async () => {
    const cas = stubClient(async () => ({ text: "x - 1", latex: "x - 1" }));
    const env = await diagnoseHeavy("x + 1", "x^2 + 1", { casClient: cas });
    expect(env.escalated).toBe(true);
    expect(env.reason).toBe("escalated-confirmed-wrong");
    expect(env.diagnostic.category).toBe("wrong");
  });

  it("falls back to math.js verdict when CAS is unavailable", async () => {
    const cas = stubClient(async () => {
      throw new HeavyCASUnavailableError("no worker");
    });
    const env = await diagnoseHeavy("wrong-answer", "x^2 + 1", { casClient: cas });
    expect(env.escalated).toBe(false);
    expect(env.reason).toBe("escalation-failed-cas-unavailable");
    expect(env.diagnostic.category).toBe("wrong");
  });

  it("falls back when CAS times out", async () => {
    const cas = stubClient(async () => {
      throw new HeavyCASTimeoutError("simplify", 50);
    });
    const env = await diagnoseHeavy("wrong-answer", "x^2 + 1", { casClient: cas });
    expect(env.reason).toBe("escalation-failed-timeout");
    expect(env.diagnostic.category).toBe("wrong");
  });

  it("falls back on a generic error", async () => {
    const cas = stubClient(async () => {
      throw new Error("kaboom");
    });
    const env = await diagnoseHeavy("wrong-answer", "x^2 + 1", { casClient: cas });
    expect(env.reason).toBe("escalation-failed-error");
    expect(env.diagnostic.category).toBe("wrong");
  });

  it("respects an external AbortSignal", async () => {
    // The stub honours the signal the dispatcher passes through.
    const cas = stubClient((_args, signal) => {
      return new Promise<CASResult>((_, reject) => {
        if (signal?.aborted) reject(new Error("aborted"));
        else signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const ctrl = new AbortController();
    const promise = diagnoseHeavy("wrong-answer-expr", "x^2 + 1", {
      casClient: cas,
      signal: ctrl.signal,
      escalationTimeoutMs: 60_000, // long, so caller-abort is the trigger
    });
    setTimeout(() => ctrl.abort(), 5);
    const env = await promise;
    expect(env.escalated).toBe(false);
    expect(env.diagnostic.category).toBe("wrong");
  });

  it("never reveals the expected value in the hint, even on upgrade", async () => {
    const cas = stubClient(async () => ({ text: "0", latex: "0" }));
    const env = await diagnoseHeavy("(x+1)*(x+2)", "x^2 + 3*x + 2", { casClient: cas });
    // (math.js already accepts this — but pinning the leakage discipline
    // either way: the hint must never echo the expected.)
    expect(env.diagnostic.hint).not.toContain("x^2");
    expect(env.diagnostic.hint).not.toContain("3*x");
  });
});
