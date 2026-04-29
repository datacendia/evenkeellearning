// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/text-with-math.test.ts
//
// Pins the parser contract of `lib/render/text-with-math.tsx`:
//   1. Plain prose with no `$` is a single prose part.
//   2. Inline `$…$` is parsed as inline-math; surrounding prose survives.
//   3. Block `$$…$$` is parsed as block-math; $$ is NEVER mis-parsed as
//      two adjacent inline delimiters.
//   4. Escaped `\$` is emitted as a literal dollar sign in prose.
//   5. Unmatched / unbalanced `$` degrades to literal prose — never
//      throws, never silently swallows the tail.
//   6. Empty input produces no parts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { splitProseAndMath } from "@/lib/render/text-with-math";

describe("splitProseAndMath", () => {
  it("returns the empty list for empty input", () => {
    expect(splitProseAndMath("")).toEqual([]);
  });

  it("returns a single prose part for prose with no $", () => {
    const parts = splitProseAndMath("Solve this problem carefully.");
    expect(parts).toEqual([{ kind: "prose", text: "Solve this problem carefully." }]);
  });

  it("extracts an inline-math span from the middle of prose", () => {
    const parts = splitProseAndMath("Solve $2x + 5 = 17$ for x.");
    expect(parts).toEqual([
      { kind: "prose", text: "Solve " },
      { kind: "inline-math", tex: "2x + 5 = 17" },
      { kind: "prose", text: " for x." },
    ]);
  });

  it("extracts an inline-math span at the start of the string", () => {
    const parts = splitProseAndMath("$x$ is the unknown.");
    expect(parts).toEqual([
      { kind: "inline-math", tex: "x" },
      { kind: "prose", text: " is the unknown." },
    ]);
  });

  it("extracts an inline-math span at the end of the string", () => {
    const parts = splitProseAndMath("The answer is $x = 6$");
    expect(parts).toEqual([
      { kind: "prose", text: "The answer is " },
      { kind: "inline-math", tex: "x = 6" },
    ]);
  });

  it("extracts a block-math span and keeps surrounding prose", () => {
    const parts = splitProseAndMath("Consider:\n$$\\frac{a}{b}$$\nReduce it.");
    expect(parts).toEqual([
      { kind: "prose", text: "Consider:\n" },
      { kind: "block-math", tex: "\\frac{a}{b}" },
      { kind: "prose", text: "\nReduce it." },
    ]);
  });

  it("never mis-parses $$ as two adjacent inline delimiters", () => {
    // The string `$$x$$` MUST be a single block-math span, never an
    // empty inline, an `x`, and another empty inline.
    const parts = splitProseAndMath("$$x$$");
    expect(parts).toEqual([{ kind: "block-math", tex: "x" }]);
  });

  it("renders a literal dollar sign when escaped with \\$", () => {
    const parts = splitProseAndMath("Lunch was \\$25 today.");
    expect(parts).toEqual([{ kind: "prose", text: "Lunch was $25 today." }]);
  });

  it("leaves an unbalanced single $ as literal prose", () => {
    // A word problem with a monetary amount should not be parsed as
    // opening a maths run that never closes.
    const parts = splitProseAndMath("She paid $25 for the book.");
    expect(parts).toEqual([{ kind: "prose", text: "She paid $25 for the book." }]);
  });

  it("handles multiple inline-math spans correctly", () => {
    const parts = splitProseAndMath("If $a = 2$ and $b = 3$ then $a + b = 5$.");
    expect(parts).toEqual([
      { kind: "prose", text: "If " },
      { kind: "inline-math", tex: "a = 2" },
      { kind: "prose", text: " and " },
      { kind: "inline-math", tex: "b = 3" },
      { kind: "prose", text: " then " },
      { kind: "inline-math", tex: "a + b = 5" },
      { kind: "prose", text: "." },
    ]);
  });

  it("handles adjacent inline and block spans", () => {
    const parts = splitProseAndMath("Inline: $x$, block: $$y$$");
    expect(parts).toEqual([
      { kind: "prose", text: "Inline: " },
      { kind: "inline-math", tex: "x" },
      { kind: "prose", text: ", block: " },
      { kind: "block-math", tex: "y" },
    ]);
  });

  it("preserves an empty inline-math span verbatim (authoring typo visibility)", () => {
    // `$$` treated alone is block delim — but inside text like `$$$x$$`
    // the first two `$` parse as a block opener, then we look for a
    // `$$` close. Here we pin the simpler case `a$$b` — a double
    // dollar not closed by another `$$`. It should degrade to prose
    // rather than silently swallow the tail.
    const parts = splitProseAndMath("a$$b");
    // Unbalanced $$ : emit as prose literal.
    expect(parts[0]).toEqual({ kind: "prose", text: "a$$b" });
  });
});
