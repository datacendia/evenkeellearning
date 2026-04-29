// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/figure-spec.test.ts
//
// Pins the v1.5.2 figure-spec validator. All checks are pure functions
// — no JSXGraph runtime needed. Real rendering is exercised in the
// Playwright E2E suite.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { validateFigureSpec, type FigureSpec } from "@/lib/geometry/figure-spec";

const baseFigure: FigureSpec = {
  id: "demo",
  alt: "Two points and the segment between them",
  elements: [
    { kind: "point", id: "A", x: -2, y: 0 },
    { kind: "point", id: "B", x: 2, y: 0 },
    { kind: "segment", from: "A", to: "B" },
  ],
};

describe("validateFigureSpec", () => {
  it("accepts a minimal valid figure", () => {
    const r = validateFigureSpec(baseFigure);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateFigureSpec(null).ok).toBe(false);
    expect(validateFigureSpec("nope").ok).toBe(false);
  });

  it("requires a non-empty `id`", () => {
    const r = validateFigureSpec({ ...baseFigure, id: "" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "missing-id")).toBe(true);
  });

  it("requires `elements` to be an array", () => {
    const r = validateFigureSpec({ id: "x", elements: "not-an-array" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "missing-elements")).toBe(true);
  });

  it("warns when `alt` is missing (a11y)", () => {
    const figure = { ...baseFigure };
    delete (figure as Partial<FigureSpec>).alt;
    const r = validateFigureSpec(figure);
    expect(r.ok).toBe(true); // warning, not error
    expect(r.issues.some((i) => i.code === "no-alt" && i.severity === "warning")).toBe(true);
  });

  it("rejects a line referencing an undefined point", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      elements: [
        { kind: "point", id: "A", x: 0, y: 0 },
        { kind: "line", through: ["A", "ghost"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "undefined-point")).toBe(true);
  });

  it("rejects a degenerate segment (same endpoint twice)", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      elements: [
        { kind: "point", id: "A", x: 0, y: 0 },
        { kind: "segment", from: "A", to: "A" },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "degenerate")).toBe(true);
  });

  it("rejects a circle with neither centre+radius nor 3 points", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      elements: [
        { kind: "point", id: "A", x: 0, y: 0 },
        { kind: "circle" } as unknown as FigureSpec["elements"][number],
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "bad-circle")).toBe(true);
  });

  it("rejects a non-positive circle radius", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      elements: [
        { kind: "point", id: "A", x: 0, y: 0 },
        { kind: "circle", centre: "A", radius: -1 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "bad-radius")).toBe(true);
  });

  it("rejects a polygon with fewer than 3 vertices", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      elements: [
        { kind: "point", id: "A", x: 0, y: 0 },
        { kind: "point", id: "B", x: 1, y: 0 },
        { kind: "polygon", vertices: ["A", "B"] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "bad-polygon")).toBe(true);
  });

  it("accepts a function-graph element with a valid expression", () => {
    const r = validateFigureSpec({
      id: "parabola",
      alt: "y = x squared",
      elements: [{ kind: "graph", expr: "x^2" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a function-graph with empty expression", () => {
    const r = validateFigureSpec({
      id: "bad",
      alt: "x",
      elements: [{ kind: "graph", expr: "" }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "bad-graph")).toBe(true);
  });

  it("rejects an unknown element kind", () => {
    const r = validateFigureSpec({
      id: "x",
      alt: "x",
      elements: [{ kind: "wormhole" } as unknown as FigureSpec["elements"][number]],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "unknown-kind")).toBe(true);
  });

  it("rejects duplicate point ids", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      elements: [
        { kind: "point", id: "A", x: 0, y: 0 },
        { kind: "point", id: "A", x: 1, y: 1 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "duplicate-id")).toBe(true);
  });

  it("rejects an invalid bounding box", () => {
    const r = validateFigureSpec({
      ...baseFigure,
      boundingBox: [1, 2, 3] as unknown as FigureSpec["boundingBox"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "bad-bbox")).toBe(true);
  });
});
