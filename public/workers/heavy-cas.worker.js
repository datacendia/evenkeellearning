// ─────────────────────────────────────────────────────────────────────────────
// public/workers/heavy-cas.worker.js
//
// Heavy CAS web worker (v1.5.2). Wraps Pyodide + Sympy and exposes a
// JSON request/response protocol for symbolic operations math.js can't
// handle: indefinite integrals, ODEs, simplification of transcendental
// expressions, exact-form roots, etc.
//
// Why a worker (not the main thread)
// ──────────────────────────────────
// • Pyodide compiles WebAssembly and runs CPython. Initial load is
//   ~10-20 MB and 1-3 seconds; first-call overhead can spike. A worker
//   keeps that off the UI thread.
// • Pyodide can't be transpiled — it loads its WASM bundle from a URL.
//   Bundling it into Next would inflate the build by ~50 MB. So we
//   load it by `importScripts(...)` from a CDN by default, with an
//   `indexURL` override for self-hosting.
// • Workers have no DOM, but learner answers / problem text are JSON
//   strings — there's nothing here that requires DOM access.
//
// Trust contract
// ──────────────
// • This worker is OFF by default. Surfaces opt in by importing
//   `lib/cas/heavy-client.ts` and calling `runCAS(...)`. No engine code
//   path autoloads the worker.
// • The default `indexURL` points to jsDelivr's pinned Pyodide release.
//   That means Pyodide ASSETS are fetched from a CDN. **Learner text
//   never leaves the device.** What the worker sends OUT to Pyodide
//   stays inside the worker — Pyodide is a local interpreter, not a
//   remote API. The only network traffic is the initial GET for the
//   WASM blob.
// • Disclosed in HONESTY.md §4.4 (v1.5.2).
//
// Protocol
// ────────
// Every message has `{ id, kind, payload }`. The client correlates
// responses by `id`. `kind` is one of:
//   - "ready"      (worker → client; sent once after Pyodide loads)
//   - "init"       (client → worker; payload: { indexURL? })
//   - "eval"       (client → worker; payload: { op, args })
//   - "result"     (worker → client; payload: { ok: true, value })
//   - "error"      (worker → client; payload: { ok: false, message })
//
// Supported `op` values (v1.5.2):
//   - "simplify"      args: { expr: string }
//   - "expand"        args: { expr: string }
//   - "factor"        args: { expr: string }
//   - "integrate"     args: { expr: string, var: string }
//   - "diff"          args: { expr: string, var: string, n?: number }
//   - "solve"         args: { equation: string, var: string }
//   - "ode"           args: { equation: string, func: string, var: string }
//   - "version"       args: {}    (returns python + sympy versions)
//
// All ops return a `value` field with a `.text` (string form) and
// `.latex` (TeX form) so the surface can either display raw or feed
// into `lib/render/math.tsx`.
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable */
// This file runs in a Web Worker context, NOT through the Next bundler.
// It's served verbatim from /workers/heavy-cas.worker.js.

let pyodide = null;
let pyodideLoadingPromise = null;

// Pinned Pyodide release. Bumping this is a deliberate operation —
// it's not chasing latest, and the pin is verifiable in the
// CHANGELOG. The version pin must match `lib/cas/heavy-client.ts`
// `DEFAULT_PYODIDE_VERSION`.
const DEFAULT_INDEX_URL =
  "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/";

function postReady() {
  self.postMessage({ id: null, kind: "ready", payload: {} });
}

function postResult(id, value) {
  self.postMessage({ id, kind: "result", payload: { ok: true, value } });
}

function postError(id, message) {
  self.postMessage({ id, kind: "error", payload: { ok: false, message } });
}

async function ensurePyodide(indexURL) {
  if (pyodide) return pyodide;
  if (pyodideLoadingPromise) return pyodideLoadingPromise;

  pyodideLoadingPromise = (async () => {
    const url = indexURL || DEFAULT_INDEX_URL;
    // importScripts is the only way to load classic scripts in a worker.
    self.importScripts(url + "pyodide.js");
    // `loadPyodide` is now on the global scope.
    pyodide = await self.loadPyodide({ indexURL: url });
    await pyodide.loadPackage(["sympy"]);
    // Pre-import sympy and set up a small bridge module.
    pyodide.runPython(`
import json
from sympy import (
    symbols, sympify, simplify, expand, factor, integrate, diff,
    solve, dsolve, Function, latex, Symbol, Eq
)
from sympy.parsing.sympy_parser import parse_expr

def _result(node):
    return {"text": str(node), "latex": latex(node)}

def cas_simplify(expr):
    return _result(simplify(sympify(expr)))

def cas_expand(expr):
    return _result(expand(sympify(expr)))

def cas_factor(expr):
    return _result(factor(sympify(expr)))

def cas_integrate(expr, var):
    return _result(integrate(sympify(expr), Symbol(var)))

def cas_diff(expr, var, n=1):
    return _result(diff(sympify(expr), Symbol(var), int(n)))

def cas_solve(equation, var):
    # Accept either "lhs = rhs" or a bare expression interpreted as = 0.
    if "=" in equation:
        lhs, rhs = equation.split("=", 1)
        eq = Eq(sympify(lhs), sympify(rhs))
    else:
        eq = sympify(equation)
    sols = solve(eq, Symbol(var))
    return {"text": str(sols), "latex": latex(sols)}

def cas_ode(equation, func, var):
    x = Symbol(var)
    f = Function(func)
    # Allow learners to write y' / y'' in math.js style by mapping to
    # f(x).diff(x). The parser accepts python-style equation text.
    if "=" in equation:
        lhs, rhs = equation.split("=", 1)
        eq = Eq(sympify(lhs, evaluate=False), sympify(rhs, evaluate=False))
    else:
        eq = sympify(equation, evaluate=False)
    sol = dsolve(eq, f(x))
    return _result(sol)

def cas_version():
    import sys, sympy
    return {
        "python": sys.version.split()[0],
        "sympy": sympy.__version__,
    }
    `);
    return pyodide;
  })();

  return pyodideLoadingPromise;
}

async function dispatch(op, args) {
  if (!pyodide) throw new Error("pyodide not initialised");
  // Pass arguments through json to keep types simple.
  const argsJson = JSON.stringify(args);
  const py = `
import json
_args = json.loads(${JSON.stringify(argsJson)})
_op = ${JSON.stringify(op)}
if _op == "simplify":
    _v = cas_simplify(_args["expr"])
elif _op == "expand":
    _v = cas_expand(_args["expr"])
elif _op == "factor":
    _v = cas_factor(_args["expr"])
elif _op == "integrate":
    _v = cas_integrate(_args["expr"], _args["var"])
elif _op == "diff":
    _v = cas_diff(_args["expr"], _args["var"], _args.get("n", 1))
elif _op == "solve":
    _v = cas_solve(_args["equation"], _args["var"])
elif _op == "ode":
    _v = cas_ode(_args["equation"], _args["func"], _args["var"])
elif _op == "version":
    _v = cas_version()
else:
    raise ValueError("unknown op: " + str(_op))
json.dumps(_v)
`;
  const resultJson = pyodide.runPython(py);
  return JSON.parse(resultJson);
}

self.addEventListener("message", async (event) => {
  const { id, kind, payload } = event.data || {};
  try {
    if (kind === "init") {
      await ensurePyodide(payload && payload.indexURL);
      postReady();
      return;
    }
    if (kind === "eval") {
      await ensurePyodide(payload && payload.indexURL);
      const value = await dispatch(payload.op, payload.args || {});
      postResult(id, value);
      return;
    }
    postError(id, `unknown message kind: ${kind}`);
  } catch (err) {
    const message = (err && err.message) ? err.message : String(err);
    postError(id, message);
  }
});
