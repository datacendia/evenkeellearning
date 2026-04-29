// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/math-render.test.ts
//
// Pins the observable contract of `lib/render/math.tsx`:
//   • Produces HTML, not raw LaTeX.
//   • Empty input → empty output (no crash, no placeholder).
//   • Malformed LaTeX degrades gracefully (KaTeX's throwOnError:false).
//   • Display mode vs inline mode produces distinguishable output.
//   • The two-argument low-level helper does not throw on any string.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { renderTexToHtml } from "@/lib/render/math";

describe("renderTexToHtml", () => {
  it("produces KaTeX HTML markup for a simple expression", () => {
    const html = renderTexToHtml("2x + 5 = 17", false);
    expect(html.length).toBeGreaterThan(0);
    // KaTeX wraps output in a <span class="katex">. Pinning the class
    // name catches regressions where we accidentally switch to a
    // different renderer or miss the output:"html" flag.
    expect(html).toContain("katex");
  });

  it("returns the empty string for empty input (no crash, no placeholder)", () => {
    expect(renderTexToHtml("", false)).toBe("");
    expect(renderTexToHtml("", true)).toBe("");
  });

  it("distinguishes display-mode from inline-mode output", () => {
    const inline = renderTexToHtml("\\frac{a}{b}", false);
    const display = renderTexToHtml("\\frac{a}{b}", true);
    // Display mode adds a `katex-display` wrapper span that inline mode
    // does not produce; this is the observable difference.
    expect(display).toContain("katex-display");
    expect(inline).not.toContain("katex-display");
  });

  it("degrades a malformed expression to an inline error rather than throwing", () => {
    // `\frac{a}` is missing its denominator argument — KaTeX would throw
    // if throwOnError were true. With throwOnError:false it emits an
    // in-line red error marker, which is what we ship.
    const html = renderTexToHtml("\\frac{a}", false);
    // The renderer must not throw and must produce some HTML.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders a calculus-shaped expression end to end", () => {
    // The exact snapshot is intentionally not pinned (KaTeX's internal
    // markup is an implementation detail) — we only assert that the
    // LaTeX is consumed and produces well-formed HTML that isn't the
    // literal backslash-laden source.
    const html = renderTexToHtml("\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}", true);
    expect(html).not.toContain("\\int");
    expect(html).toContain("katex-display");
  });

  it("does not throw on any arbitrary string of reasonable size", () => {
    const samples = [
      "x",
      "x^2 + 3x + 2",
      "\\sum_{i=0}^{n} i",
      "\\sqrt{2}",
      "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
      "arbitrary prose with no latex in it at all",
      "$$x = 1$$", // dollar-sign delimiters should be rejected gracefully
      "\\frac",    // truncated command
    ];
    for (const sample of samples) {
      expect(() => renderTexToHtml(sample, false)).not.toThrow();
      expect(() => renderTexToHtml(sample, true)).not.toThrow();
    }
  });
});
