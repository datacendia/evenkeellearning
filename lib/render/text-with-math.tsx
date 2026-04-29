// ─────────────────────────────────────────────────────────────────────────────
// lib/render/text-with-math.tsx
//
// Mixed prose + LaTeX renderer. Splits a string on `$...$` (inline) and
// `$$...$$` (display) delimiters, renders the maths spans through KaTeX
// (see `lib/render/math.tsx`), and leaves the prose as plain React text.
//
// Why this exists
// ───────────────
// Authored content (problem text, hints, explanations, worked-example
// steps) is free-form prose that may contain inline maths. Content-pack
// authors use the Jupyter / Stack Exchange convention:
//
//   "Solve for x:  $2x + 5 = 17$.  Show your reasoning."
//
// Passing that to a plain React text node renders the literal dollar
// signs. Passing the whole string to `MathInline` explodes because the
// text fragments aren't valid LaTeX. This component splits the string
// correctly and routes each fragment to the right renderer.
//
// Contract (pinned by tests in tests/unit/text-with-math.test.ts)
// ───────────────────────────────────────────────────────────────
// • Plain text with no `$` renders identically to `<>{text}</>`.
// • `$x$` in the middle of prose renders inline maths; surrounding
//   prose survives unchanged.
// • `$$…$$` renders block-level maths (KaTeX displayMode = true).
// • `$$` takes precedence over `$` — a display delimiter is never
//   mis-parsed as two adjacent inline delimiters.
// • A single unmatched `$` (common in learner prose, e.g. a price)
//   is rendered as a literal dollar sign, not as the opening of a
//   maths run. A math span must be *closed* within the same string.
// • Backslash-escaped dollars (`\$`) are emitted as literal `$` and
//   never treated as delimiters.
// • Empty / whitespace-only maths spans are preserved as the literal
//   source so an authoring typo is visible, not silent.
// • No learner text ever flows into this component — only authored,
//   signed pack content. The KaTeX renderer itself has `trust: false`,
//   so even if a future surface did hand it learner input, it could
//   not invoke `\href` / `\includegraphics`.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactElement } from "react";

import { MathBlock, MathInline } from "./math";

export interface TextWithMathProps {
  /** The prose-with-maths source. */
  children: string;
  /** Class name forwarded to the wrapping span. */
  className?: string;
}

/**
 * React component: renders a prose string containing optional `$…$` and
 * `$$…$$` maths spans.
 */
export function TextWithMath({ children, className }: TextWithMathProps): ReactElement {
  const parts = splitProseAndMath(children);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.kind === "prose") {
          // React handles escaping; no dangerouslySetInnerHTML on prose.
          return <span key={i}>{part.text}</span>;
        }
        if (part.kind === "inline-math") {
          return <MathInline key={i} tex={part.tex} />;
        }
        // block-math
        return <MathBlock key={i} tex={part.tex} />;
      })}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser (exported for direct test)
// ─────────────────────────────────────────────────────────────────────────────

export type TextPart =
  | { kind: "prose"; text: string }
  | { kind: "inline-math"; tex: string }
  | { kind: "block-math"; tex: string };

/**
 * Splits a string into an alternating sequence of prose and maths parts.
 *
 * Algorithm: single linear scan. Two bits of state — are we currently
 * inside a `$…$` run, and are we currently inside a `$$…$$` run. The
 * `$$` check is always attempted before `$` so a display delimiter can
 * never be mis-identified as two inlines.
 *
 * Escapes: `\$` is consumed as a literal dollar sign and never opens or
 * closes a maths run.
 *
 * Unbalanced: if the string ends mid-maths (opening delimiter never
 * closed), the entire tail from the last opening delimiter is emitted as
 * prose, including the opening delimiter itself. The practical effect is
 * that a stray `$25 for lunch` in a word problem renders as the literal
 * string rather than as half a maths opening — safer than throwing.
 */
export function splitProseAndMath(input: string): TextPart[] {
  if (typeof input !== "string" || input.length === 0) return [];

  const parts: TextPart[] = [];
  let prose = "";
  let i = 0;
  const n = input.length;

  const pushProse = () => {
    if (prose.length > 0) {
      parts.push({ kind: "prose", text: prose });
      prose = "";
    }
  };

  while (i < n) {
    const ch = input[i]!;
    const next = input[i + 1];

    // Escaped dollar — consume both chars, emit literal `$`.
    if (ch === "\\" && next === "$") {
      prose += "$";
      i += 2;
      continue;
    }

    // Block-math opener `$$`.
    if (ch === "$" && next === "$") {
      const closeRel = findClosingDelimiter(input, i + 2, "$$");
      if (closeRel !== -1) {
        pushProse();
        const tex = input.slice(i + 2, closeRel);
        parts.push({ kind: "block-math", tex });
        i = closeRel + 2;
        continue;
      }
      // Unbalanced: emit as literal prose and advance by one.
      prose += ch;
      i++;
      continue;
    }

    // Inline-math opener `$`.
    if (ch === "$") {
      const closeRel = findClosingDelimiter(input, i + 1, "$");
      if (closeRel !== -1) {
        pushProse();
        const tex = input.slice(i + 1, closeRel);
        parts.push({ kind: "inline-math", tex });
        i = closeRel + 1;
        continue;
      }
      // Unbalanced: treat as literal.
      prose += ch;
      i++;
      continue;
    }

    // Ordinary prose character.
    prose += ch;
    i++;
  }

  pushProse();
  return parts;
}

/**
 * Scans forward from `from` looking for an unescaped occurrence of
 * `delim`. Returns the index of the delimiter, or -1 if not found.
 *
 * Skips `\$` escape pairs so `\$1$...$` with a literal opening dollar
 * doesn't close prematurely. Stops scanning at the first match; does
 * NOT handle nested delimiters (KaTeX doesn't support them either).
 */
function findClosingDelimiter(
  input: string,
  from: number,
  delim: "$" | "$$",
): number {
  const delimLen = delim.length;
  const n = input.length;
  let i = from;
  while (i < n) {
    if (input[i] === "\\" && input[i + 1] === "$") {
      i += 2;
      continue;
    }
    // For inline delim, reject a `$$` at this position (that's a block
    // opener, not an inline close). For block delim, require `$$`.
    if (delim === "$$") {
      if (input[i] === "$" && input[i + 1] === "$") return i;
    } else {
      if (input[i] === "$" && input[i + 1] !== "$") return i;
    }
    i++;
  }
  // If we were looking for `$$` and hit end of string, no close.
  // If we were looking for `$` and hit end of string, no close.
  // Unless the last char IS `$` for the inline case.
  if (delim === "$" && input[n - 1] === "$" && input[n - 2] !== "\\" && input[n - 2] !== "$") {
    return n - 1;
  }
  return -1;
}
