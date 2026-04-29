# Roadmap — higher mathematics, with open-source-only picks

*The honest picture of where Even Keel Learning's runtime sits today
relative to the demands of A-Level / Leaving Cert / undergraduate
maths and computing content, what's missing, and the FOSS
alternatives that close each gap without paying a licensing fee or
accepting vendor lock-in.*

This document complements `@c:\Users\Stu\New folder\docs\WHY_NO_LLM_AT_RUNTIME.md`:
that one explains *why* there's no model in the path that talks to
the learner; this one explains *how* every higher-maths capability
that an LLM-tutor would deliver via a model can be delivered via
hand-authored content plus deterministic open-source tooling instead.

---

## 1. Capability map

| # | Capability | v1.5.0 status | FOSS pick | License | Bundle | Effort |
|---|---|---|---|---|---|---|
| 1 | Numeric answer-checking | ✅ shipping | hand-coded | — | 0 | — |
| 2 | Numeric-equivalence by sample-point<br>*(evaluate `dy/dx = 3x²` at x=2, expect 12)* | 🟡 possible today via numeric `expectedAnswer` | authoring convention only | — | 0 | already works |
| 3 | LaTeX rendering | ✅ **shipping v1.5.1** | **KaTeX** via `lib/render/math.tsx` | MIT | ~280 KB | done |
| 4 | Symbolic answer-checking — light<br>*(`(x+1)(x+2)` ≡ `x² + 3x + 2`)* | ✅ **shipping v1.5.1** | **math.js** via `lib/validation/answer-checker.ts` (`diagnoseSymbolicAttempt`, `diagnose` dispatcher) | Apache-2.0 | ~600 KB | done |
| 5 | Symbolic answer-checking — heavy<br>*(graduate calculus, ODEs, integrals)* | ❌ not built | **Pyodide + Sympy**, lazy-loaded | MPL-2.0 / BSD-3 | ~12 MB cached | 3 days |
| 6 | Step-validity checking | ❌ not built | math.js or Sympy + step parser | as above | as above | 1 week |
| 7 | Geometric figures, function plots, slider-driven exploration | ❌ not built | **JSXGraph** | LGPL-3 / MIT (dual) | ~250 KB | 2 weeks |
| 8 | Simple charts only | ❌ not built | **Chart.js** | MIT | ~200 KB | 2 days |

**Total third-party code if every row ships:** ~16 MB, of which
~12 MB (Pyodide) is *lazy-loaded once and cached* by the service
worker. Typical learner page weight goes up by ~1 MB for the
lightweight path (KaTeX + math.js + JSXGraph). All MIT / Apache /
MPL / BSD / dual-LGPL — **zero licensing cost, zero vendor lock-in,
no API keys, no per-call fees**.

---

## 2. What gets rejected and why

| Rejected | Reason |
|---|---|
| **Wolfram Alpha API** | Paid per-call; vendor lock-in; would require a server-side relay to keep the API key off learner devices, contradicting the *no-back-end* property. |
| **Desmos embed** | Free for now, but proprietary T&Cs and unilateral right to change them; vendor lock-in for a capability JSXGraph already delivers under a permissive licence. |
| **GeoGebra (commercial embed)** | GPL for non-commercial only; commercial embedding requires a paid licence. Wrong fit for a redistributable platform. |
| **Anything that requires sending learner work to a remote API** | Categorical breach of the *"no learner text leaves the device"* contract. Non-starter. |

---

## 3. Recommended escalation order

The honest path through the table, prioritised by *value-per-week-of-work*:

1. ✅ **KaTeX** — done in v1.5.1. See `lib/render/math.tsx`, 6 tests in
   `tests/unit/math-render.test.ts`. Covers ~99% of LaTeX; fall back to
   MathJax only if a content pack needs chemistry / mhchem / advanced
   notation.
2. ✅ **math.js for symbolic equivalence** — done in v1.5.1. See
   `lib/validation/answer-checker.ts` (`diagnoseSymbolicAttempt`,
   `symbolicEquivalent`, `diagnose` dispatcher), 19 tests in
   `tests/unit/symbolic-checker.test.ts`. Unlocks ≤ A-Level symbolic:
   simplification, factorisation, expansion, derivative comparison,
   trivial trig identities via the three-sample numeric fallback.
   Native JS, no Wasm download for the learner.
3. **JSXGraph for geometry and function plots (2 weeks).** Big
   pedagogical unlock — visual reasoning is where most learners turn
   the corner on hard topics. Self-contained 250 KB bundle. **Next up.**
4. **Pyodide + Sympy as the *escalation* path (3 days to wire).**
   Math.js is already enough for ≤ Year-13 content. Pyodide+Sympy is
   the honest answer for genuinely-graduate content (multivariable
   calculus, abstract algebra, symbolic ODE solutions). Lazy-load on
   demand; first hit is heavy, all subsequent hits are cached.
5. **Step-validity checking (1 week).** Built on whichever CAS is
   already loaded for the page. Most pedagogical value for proof-shaped
   subjects (discrete maths, induction proofs, formal-methods modules).
6. **Chart.js (2 days).** Only if needed; data-viz items can usually
   be served as pre-rendered SVGs in the worked-example field.

---

## 4. The architectural property each pick must preserve

Every FOSS choice above must keep the v1.4.x trust contract intact:

- **No learner text leaves the device.** Every CAS evaluation
  happens browser-side. math.js is native JS, Pyodide+Sympy run in a
  web worker against the in-page memory. JSXGraph operates
  exclusively on construction objects defined in the page.
- **Reproducibility.** Same input must produce same output. CAS
  outputs are pinned by version (the package version is included in
  the content manifest's `metadata.tooling`).
- **Provable-by-grep.** Every CAS call site is short, grep-able, and
  scoped to the answer-checker — never to the hint-generation path
  (because there is no hint-generation path).
- **Signature integrity.** The CAS is consulted *after* the signed
  manifest has been verified, never before. CAS evaluation does not
  affect signature validity.

---

## 5. What a pilot week-2 spike would look like

The smallest credible *"shipped a higher-maths capability"* artefact:

1. **Day 1.** Add KaTeX. Pick one A-Level / undergraduate maths
   skill family (e.g. integration by parts, or quadratic factorisation)
   to author content for during the spike. Author one item with the
   `/author` flow.
2. **Day 2.** Add math.js. Wire it into the answer-checker behind a
   feature flag — when an `expectedAnswer` looks like an algebraic
   expression rather than a number, route through math.js
   `simplify(parse(actual) - parse(expected)) == 0`.
3. **Day 3.** Add a worked example to the new skill family. Run the
   `/author` flow. Issue a signed receipt for the integration-by-parts
   item. Verify the receipt in a fresh tab.
4. **End-of-week.** Hand the lecturer / reviewer a working symbolic
   answer-checker for one A-Level skill family, the `/author` flow
   they've already used, and a signed receipt that proves a learner
   solved the problem under the new pipeline. The artefact carries
   the lecturer's reviewer fingerprint, and the receipt verifies in
   the lecturer's own browser with no vendor account.

That's the smallest *"the platform now does symbolic maths"* shape
possible. It's two days of engineering plus a few hours of authoring
with the lecturer. No subscription. No API key. No vendor.

---

## 6. Cross-references

- `@c:\Users\Stu\New folder\docs\WHY_NO_LLM_AT_RUNTIME.md` — why
  none of these capabilities are delivered through a model at
  runtime, and why that's the architecturally correct call.
- `@c:\Users\Stu\New folder\HONESTY.md` §4.3 — the open content
  gaps the v1.5.0 authoring pipeline closes, and the ones it
  doesn't.
- `@c:\Users\Stu\New folder\docs\PROPOSAL_FOR_DOWLING.md` —
  the higher-education pitch that references this roadmap.
- `@c:\Users\Stu\New folder\docs\PROPOSAL_TRUTH_PACK.md` §C —
  Phase-2 narrative.
