// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/heavy-cas-client.test.ts
//
// Protocol-level tests for the v1.5.2 heavy-CAS client. The actual
// Pyodide + Sympy execution is browser-only (it loads WASM via
// importScripts) and is validated separately in the Playwright suite.
//
// Here we mock the Worker and pin:
//   1. init flow — client posts `init`, waits for `ready`, resolves.
//   2. eval flow — client posts `eval { id, op, args }`, correlates
//      the matching `result` by id, returns the parsed value.
//   3. error path — `error` payloads reject the call.
//   4. timeout — slow worker rejects with HeavyCASTimeoutError.
//   5. abort — AbortSignal triggers rejection and removes the pending
//      entry.
//   6. terminate — pending calls reject; further calls fail loudly.
//   7. concurrent calls — out-of-order responses are correlated by id.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";

import {
  HeavyCASClient,
  HeavyCASTimeoutError,
  HeavyCASUnavailableError,
  type WorkerLike,
} from "@/lib/cas/heavy-client";

interface PostedMessage {
  id: string | null;
  kind: string;
  payload?: { op?: string; args?: unknown; indexURL?: string };
}

type MessageHandler = (event: { data?: unknown }) => void;

class MockWorker implements WorkerLike {
  posts: PostedMessage[] = [];
  private messageHandlers = new Set<MessageHandler>();
  private errorHandlers = new Set<(e: unknown) => void>();
  terminated = false;

  /** Auto-respond to init with `ready` after the next microtask. */
  autoReady = true;

  postMessage(msg: unknown): void {
    this.posts.push(msg as PostedMessage);
    const m = msg as PostedMessage;
    if (this.autoReady && m.kind === "init") {
      queueMicrotask(() => {
        this.emitMessage({ id: null, kind: "ready", payload: {} });
      });
    }
  }
  terminate(): void {
    this.terminated = true;
    this.messageHandlers.clear();
    this.errorHandlers.clear();
  }
  addEventListener(type: "message" | "error" | "messageerror", handler: (e: unknown) => void): void {
    if (type === "message") this.messageHandlers.add(handler);
    else if (type === "error") this.errorHandlers.add(handler);
  }
  removeEventListener(type: "message" | "error" | "messageerror", handler: (e: unknown) => void): void {
    if (type === "message") this.messageHandlers.delete(handler);
    else if (type === "error") this.errorHandlers.delete(handler);
  }

  /** Synthesise a message FROM the worker TO the client. */
  emitMessage(data: unknown): void {
    for (const h of Array.from(this.messageHandlers)) {
      h({ data });
    }
  }
  emitError(message: string): void {
    for (const h of Array.from(this.errorHandlers)) {
      h({ message });
    }
  }

  /** Returns the most recent `eval` post, or null. */
  lastEval(): PostedMessage | null {
    for (let i = this.posts.length - 1; i >= 0; i--) {
      if (this.posts[i]!.kind === "eval") return this.posts[i]!;
    }
    return null;
  }
}

describe("HeavyCASClient protocol", () => {
  it("posts an `init` then waits for `ready`", async () => {
    const mock = new MockWorker();
    const client = new HeavyCASClient({ workerFactory: () => mock });
    await client.init();
    expect(mock.posts[0]!.kind).toBe("init");
    expect(mock.posts[0]!.payload?.indexURL).toMatch(/pyodide/);
    client.terminate();
  });

  it("correlates an `eval` request to the matching `result` response", async () => {
    const mock = new MockWorker();
    const client = new HeavyCASClient({ workerFactory: () => mock });

    const promise = client.simplify("(x+1)*(x-1)");
    // Wait one tick so init's auto-ready runs and the eval is posted.
    await Promise.resolve();
    await Promise.resolve();

    const ev = mock.lastEval()!;
    expect(ev.kind).toBe("eval");
    expect(ev.payload?.op).toBe("simplify");
    expect((ev.payload?.args as { expr: string }).expr).toBe("(x+1)*(x-1)");

    mock.emitMessage({
      id: ev.id,
      kind: "result",
      payload: { ok: true, value: { text: "x^2 - 1", latex: "x^{2} - 1" } },
    });

    const result = await promise;
    expect(result).toEqual({ text: "x^2 - 1", latex: "x^{2} - 1" });
    client.terminate();
  });

  it("rejects when the worker emits an `error` payload", async () => {
    const mock = new MockWorker();
    const client = new HeavyCASClient({ workerFactory: () => mock });

    const promise = client.integrate("1/0", "x");
    await Promise.resolve();
    await Promise.resolve();

    const ev = mock.lastEval()!;
    mock.emitMessage({
      id: ev.id,
      kind: "error",
      payload: { ok: false, message: "ZeroDivisionError" },
    });

    await expect(promise).rejects.toThrow(/ZeroDivisionError/);
    client.terminate();
  });

  it("rejects with HeavyCASTimeoutError when the worker is silent", async () => {
    vi.useFakeTimers();
    const mock = new MockWorker();
    const client = new HeavyCASClient({
      workerFactory: () => mock,
      timeoutMs: 50,
    });

    const promise = client.simplify("x");
    promise.catch(() => {/* swallow */});
    // Drain microtasks so init resolves and eval is posted.
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.lastEval()?.kind).toBe("eval");
    await vi.advanceTimersByTimeAsync(60);

    await expect(promise).rejects.toBeInstanceOf(HeavyCASTimeoutError);
    vi.useRealTimers();
    client.terminate();
  });

  it("respects an AbortSignal", async () => {
    const mock = new MockWorker();
    const client = new HeavyCASClient({ workerFactory: () => mock });

    const ctrl = new AbortController();
    const promise = client.run({ op: "simplify", expr: "x" }, ctrl.signal);
    promise.catch(() => {/* swallow */});

    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort();
    await expect(promise).rejects.toThrow(/aborted/);
    client.terminate();
  });

  it("rejects pending calls when terminate() is invoked", async () => {
    const mock = new MockWorker();
    const client = new HeavyCASClient({ workerFactory: () => mock });

    const promise = client.simplify("x");
    promise.catch(() => {/* swallow */});
    await Promise.resolve();
    await Promise.resolve();

    client.terminate();
    await expect(promise).rejects.toBeInstanceOf(HeavyCASUnavailableError);
  });

  it("correlates concurrent out-of-order responses by id", async () => {
    const mock = new MockWorker();
    const client = new HeavyCASClient({ workerFactory: () => mock });

    const a = client.simplify("a-expr");
    const b = client.simplify("b-expr");
    await Promise.resolve();
    await Promise.resolve();

    const evals = mock.posts.filter((p) => p.kind === "eval");
    expect(evals.length).toBe(2);
    const [evA, evB] = evals;

    // Respond to B FIRST.
    mock.emitMessage({
      id: evB!.id,
      kind: "result",
      payload: { ok: true, value: { text: "B!", latex: "B!" } },
    });
    mock.emitMessage({
      id: evA!.id,
      kind: "result",
      payload: { ok: true, value: { text: "A!", latex: "A!" } },
    });

    expect((await a) as { text: string }).toMatchObject({ text: "A!" });
    expect((await b) as { text: string }).toMatchObject({ text: "B!" });
    client.terminate();
  });

  it("HeavyCASClient.isAvailable() is false in Node test env", () => {
    expect(HeavyCASClient.isAvailable()).toBe(false);
  });

  it("init() rejects with HeavyCASUnavailableError when the factory throws", async () => {
    const client = new HeavyCASClient({
      workerFactory: () => {
        throw new Error("nope");
      },
    });
    await expect(client.init()).rejects.toBeInstanceOf(HeavyCASUnavailableError);
  });
});
