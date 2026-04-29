// ─────────────────────────────────────────────────────────────────────────────
// lib/cas/heavy-client.ts
//
// Heavy-CAS client (v1.5.2). Spawns the Pyodide + Sympy web worker
// (`public/workers/heavy-cas.worker.js`) lazily on first use, exposes
// a promise-based API for the supported operations, and handles
// timeouts, cancellation, and request correlation.
//
// Trust contract
// ──────────────
// • OFF by default. Surfaces opt in by importing this module and
//   calling `runCAS(...)` or `getHeavyCAS()`. No engine code path
//   autoloads it.
// • Pyodide assets are fetched from a CDN by default (jsDelivr,
//   pinned to `DEFAULT_PYODIDE_VERSION`). Self-host by passing
//   `{ indexURL: "/pyodide/" }` to `getHeavyCAS()` and serving the
//   release tarball from `public/pyodide/`.
// • Learner text never leaves the device — Pyodide is a local
//   interpreter, not a remote API. The only network traffic is the
//   initial GET for the WASM blob. Disclosed in HONESTY.md §4.4.
// • The Worker constructor and `URL` are guarded so this module is
//   safe to import in SSR / Node test contexts; calls fail loudly
//   instead of silently if Workers are unavailable.
//
// Testing strategy
// ────────────────
// The `HeavyCASClient` class is structured so the underlying Worker
// can be replaced with a `MockWorker` in tests (`makeClient(workerFactory)`).
// That lets us pin the request/response protocol without spinning up
// Pyodide. Real-Pyodide validation is via Playwright (E2E follow-up).
// ─────────────────────────────────────────────────────────────────────────────

/** Pinned Pyodide version. Must match the worker's DEFAULT_INDEX_URL. */
export const DEFAULT_PYODIDE_VERSION = "0.27.0";

/** Default CDN URL the worker uses when no override is given. */
export const DEFAULT_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${DEFAULT_PYODIDE_VERSION}/full/`;

/** Default path to the worker bundle relative to the site root. */
export const DEFAULT_WORKER_URL = "/workers/heavy-cas.worker.js";

/** Default per-call timeout. Pyodide simplification can be slow on
 * mobile WASM, so we err on the side of generous. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Supported CAS operations. */
export type CASOp =
  | "simplify"
  | "expand"
  | "factor"
  | "integrate"
  | "diff"
  | "solve"
  | "ode"
  | "version";

/** Argument shape per op. Discriminated by `op`. */
export type CASArgs =
  | { op: "simplify"; expr: string }
  | { op: "expand"; expr: string }
  | { op: "factor"; expr: string }
  | { op: "integrate"; expr: string; var: string }
  | { op: "diff"; expr: string; var: string; n?: number }
  | { op: "solve"; equation: string; var: string }
  | { op: "ode"; equation: string; func: string; var: string }
  | { op: "version" };

/** A successful CAS result. `text` is the plain string form, `latex`
 * is the TeX form ready to feed into KaTeX. */
export interface CASResult {
  text: string;
  latex: string;
}

/** The version op returns a metadata object instead of a CASResult. */
export interface CASVersionInfo {
  python: string;
  sympy: string;
}

export interface HeavyCASOptions {
  /** Override the worker bundle URL. Useful for tests / self-hosted assets. */
  workerUrl?: string;
  /** Override the Pyodide assets URL. Useful for offline / self-hosted deployments. */
  indexURL?: string;
  /** Per-call timeout in milliseconds (default `DEFAULT_TIMEOUT_MS`). */
  timeoutMs?: number;
  /**
   * Test-only escape hatch: factory that returns a Worker-shaped object.
   * When provided, `workerUrl` is ignored. The factory receives the
   * worker URL it would have used so test mocks can branch on it.
   */
  workerFactory?: (url: string) => WorkerLike;
}

/** Minimal Worker contract this client uses. Lets us mock in tests. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    handler: (event: { data?: unknown; message?: string } | unknown) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    handler: (event: { data?: unknown; message?: string } | unknown) => void,
  ): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class HeavyCASUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeavyCASUnavailableError";
  }
}

export class HeavyCASTimeoutError extends Error {
  constructor(public readonly op: string, ms: number) {
    super(`Heavy CAS op '${op}' did not respond within ${ms} ms`);
    this.name = "HeavyCASTimeoutError";
  }
}

export class HeavyCASClient {
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private terminated = false;

  constructor(private readonly options: HeavyCASOptions = {}) {}

  /**
   * Returns true iff the runtime exposes the Worker constructor
   * (browser context). Always false in Node, jsdom without workers,
   * and during SSR.
   */
  static isAvailable(): boolean {
    return typeof Worker !== "undefined";
  }

  /**
   * Spins up the worker and waits for the `ready` message. Subsequent
   * calls are no-ops. Throws `HeavyCASUnavailableError` in environments
   * with no Worker constructor.
   */
  init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      try {
        this.worker = this.spawnWorker();
      } catch (e) {
        reject(
          new HeavyCASUnavailableError(
            `Could not start heavy-CAS worker: ${(e as Error).message}`,
          ),
        );
        return;
      }
      this.worker.addEventListener("message", this.handleMessage);
      this.worker.addEventListener("error", this.handleWorkerError);
      const onReady = (event: unknown) => {
        const data = (event as { data?: { kind?: string } }).data;
        if (data && data.kind === "ready") {
          this.worker?.removeEventListener("message", onReady);
          resolve();
        } else if (data && data.kind === "error") {
          const payload = (data as { payload?: { message?: string } }).payload;
          reject(new Error(payload?.message ?? "heavy-cas init failed"));
        }
      };
      this.worker.addEventListener("message", onReady);
      this.worker.postMessage({
        id: null,
        kind: "init",
        payload: { indexURL: this.options.indexURL ?? DEFAULT_INDEX_URL },
      });
    });
    return this.ready;
  }

  /**
   * Calls a CAS op. Returns the parsed result or rejects on error /
   * timeout / cancellation.
   */
  async run(args: CASArgs, signal?: AbortSignal): Promise<CASResult | CASVersionInfo> {
    if (this.terminated) {
      throw new HeavyCASUnavailableError("Heavy CAS client has been terminated");
    }
    await this.init();
    const id = `cas-${this.nextId++}`;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<CASResult | CASVersionInfo>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              const pending = this.pending.get(id);
              if (pending) {
                this.pending.delete(id);
                pending.reject(new HeavyCASTimeoutError(args.op, timeoutMs));
              }
            }, timeoutMs)
          : null;

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      if (signal) {
        const onAbort = () => {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            if (pending.timer) clearTimeout(pending.timer);
            pending.reject(new Error("aborted"));
          }
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.worker!.postMessage({
        id,
        kind: "eval",
        payload: { op: args.op, args },
      });
    });
  }

  /** Convenience wrappers (typed-narrowed). */
  simplify(expr: string): Promise<CASResult> {
    return this.run({ op: "simplify", expr }) as Promise<CASResult>;
  }
  expand(expr: string): Promise<CASResult> {
    return this.run({ op: "expand", expr }) as Promise<CASResult>;
  }
  factor(expr: string): Promise<CASResult> {
    return this.run({ op: "factor", expr }) as Promise<CASResult>;
  }
  integrate(expr: string, varName: string): Promise<CASResult> {
    return this.run({ op: "integrate", expr, var: varName }) as Promise<CASResult>;
  }
  diff(expr: string, varName: string, n = 1): Promise<CASResult> {
    return this.run({ op: "diff", expr, var: varName, n }) as Promise<CASResult>;
  }
  solve(equation: string, varName: string): Promise<CASResult> {
    return this.run({ op: "solve", equation, var: varName }) as Promise<CASResult>;
  }
  ode(equation: string, func: string, varName: string): Promise<CASResult> {
    return this.run({
      op: "ode",
      equation,
      func,
      var: varName,
    }) as Promise<CASResult>;
  }
  version(): Promise<CASVersionInfo> {
    return this.run({ op: "version" }) as Promise<CASVersionInfo>;
  }

  /** Tears down the worker. Subsequent calls reject. */
  terminate(): void {
    this.terminated = true;
    if (this.worker) {
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleWorkerError);
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new HeavyCASUnavailableError("Heavy CAS client terminated"));
    }
    this.pending.clear();
  }

  private spawnWorker(): WorkerLike {
    if (this.options.workerFactory) {
      return this.options.workerFactory(
        this.options.workerUrl ?? DEFAULT_WORKER_URL,
      );
    }
    if (typeof Worker === "undefined") {
      throw new HeavyCASUnavailableError(
        "Worker constructor unavailable in this environment",
      );
    }
    return new Worker(
      this.options.workerUrl ?? DEFAULT_WORKER_URL,
    ) as unknown as WorkerLike;
  }

  private handleMessage = (event: unknown) => {
    const data = (event as { data?: { id?: string; kind?: string; payload?: { ok?: boolean; value?: unknown; message?: string } } }).data;
    if (!data || typeof data !== "object") return;
    const { id, kind, payload } = data;
    if (!id || typeof id !== "string") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (kind === "result" && payload && payload.ok === true) {
      pending.resolve(payload.value);
    } else {
      const message =
        payload && typeof payload.message === "string"
          ? payload.message
          : "heavy-cas: unknown error";
      pending.reject(new Error(message));
    }
  };

  private handleWorkerError = (event: unknown) => {
    const message =
      (event as { message?: string }).message ?? "heavy-cas worker error";
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level singleton (lazy)
// ─────────────────────────────────────────────────────────────────────────────

let singleton: HeavyCASClient | null = null;

/**
 * Returns (and lazily creates) a process-wide heavy-CAS client. Most
 * surfaces should call this; create a fresh client only if you need
 * isolation (different `indexURL`, separate teardown, test fixture).
 */
export function getHeavyCAS(options?: HeavyCASOptions): HeavyCASClient {
  if (!singleton) {
    singleton = new HeavyCASClient(options);
  }
  return singleton;
}

/** Convenience one-shot. Equivalent to `getHeavyCAS().run(args)`. */
export function runCAS(
  args: CASArgs,
  signal?: AbortSignal,
): Promise<CASResult | CASVersionInfo> {
  return getHeavyCAS().run(args, signal);
}

/** Tears down the singleton (test cleanup, hot-reload). */
export function resetHeavyCAS(): void {
  if (singleton) {
    singleton.terminate();
    singleton = null;
  }
}
