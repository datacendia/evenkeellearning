// ─────────────────────────────────────────────────────────────────────────────
// lib/render/math.tsx
//
// Server-safe LaTeX rendering for problem text, hints, explanations, and
// worked-example steps. Wraps KaTeX (MIT, ~280 KB on the client, 0 ms on
// the server because we render to a static HTML string at build/SSR time).
//
// Why this exists
// ───────────────
// Until v1.5.1 the platform served raw text — `2x + 5 = 17` was fine for
// linear equations but a calculus item showing `\\frac{dy}{dx} = 3x^2`
// would render as the literal backslash-laden source. KaTeX renders the
// LaTeX into HTML+MathML on the server side; the client receives static
// markup that needs no JavaScript to display.
//
// Trust contract
// ──────────────
// • No model in this path. KaTeX is a pure parser+renderer; given the
//   same input, it produces the same output, every time.
// • `throwOnError: false` so a malformed expression in authored content
//   degrades to a visible error inline rather than blowing up the whole
//   problem panel. Authoring-time tests will catch the malformed input
//   before it ships.
// • The output is set via `dangerouslySetInnerHTML` because that is how
//   KaTeX is designed to be consumed. The HTML it produces is from a
//   fixed, audited templating function over a parsed AST — no learner
//   text ever flows through this component (only authored, signed pack
//   content does).
//
// Usage
// ─────
//   <MathInline tex="2x + 5 = 17" />
//   <MathBlock  tex="\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}" />
//
// CSS: import the package's stylesheet once at app root —
//      `@import "katex/dist/katex.min.css";` — or rely on Next.js's
//      automatic CSS handling when KaTeX is imported in a client tree.
// ─────────────────────────────────────────────────────────────────────────────

import katex from "katex";
import type { ReactElement } from "react";

export interface MathProps {
  /** LaTeX source. Backslashes must be escaped in JS string literals. */
  tex: string;
  /** Class name forwarded to the wrapping span / div. */
  className?: string;
}

/**
 * Renders an inline maths expression. Produces a `<span>` with the
 * KaTeX-generated HTML inside.
 */
export function MathInline({ tex, className }: MathProps): ReactElement {
  const html = renderTexToHtml(tex, /* displayMode */ false);
  return (
    <span
      className={className}
      // KaTeX-generated markup; safe by construction (see file header).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Renders a block-level maths expression. Produces a `<div>` with the
 * KaTeX-generated HTML inside; the `display` flag tells KaTeX to use
 * larger fonts and centred layout (sums, integrals, fractions render in
 * "tall" form rather than "inline" form).
 */
export function MathBlock({ tex, className }: MathProps): ReactElement {
  const html = renderTexToHtml(tex, /* displayMode */ true);
  return (
    <div
      className={className}
      // KaTeX-generated markup; safe by construction (see file header).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Lower-level helper for callers that need the raw HTML string (for
 * example, to embed maths in a string-templated tooltip or a server-side
 * receipt PDF). Returns the empty string for empty input.
 */
export function renderTexToHtml(tex: string, displayMode: boolean): string {
  if (typeof tex !== "string" || tex.length === 0) return "";
  try {
    return katex.renderToString(tex, {
      displayMode,
      // Soft-fail: render the source in red rather than throwing.
      throwOnError: false,
      // Match Next.js's default colour palette so error markup is
      // visible in both light and dark themes without extra CSS.
      errorColor: "#cc0000",
      // Trust nothing exotic; we only ship core LaTeX in authored
      // content. This rejects raw `\\href`, `\\url`, `\\includegraphics`
      // etc., which we don't author and don't want.
      trust: false,
      // strict mode emits warnings to stderr in development but never
      // throws; combined with throwOnError: false, the output never
      // crashes the React tree.
      strict: "warn",
      // Same macro set every time; do not mutate.
      output: "html",
    });
  } catch {
    // Belt-and-braces — if anything escapes the soft-fail above, we
    // fall back to the literal source so the learner still sees what
    // the author wrote rather than a blank panel.
    return escapeHtml(tex);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
