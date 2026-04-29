// ─────────────────────────────────────────────────────────────────────────────
// lib/geometry/figure-spec.ts
//
// Authoring schema for v1.5.2 geometric figures, rendered by JSXGraph
// in the browser via `components/shared/GeometryFigure.tsx`.
//
// Why a typed spec (and not raw JSXGraph code)
// ────────────────────────────────────────────
// • Content packs ship as JSON. They cannot embed live JavaScript —
//   that would break the v1.5.0 trust contract (every signed item has
//   a deterministic, statically-validatable shape).
// • A typed spec is auditable: the build script can reject malformed
//   figures before signing, the registry can render them safely on
//   any device, and reviewers can read them without needing to
//   evaluate code.
// • The runtime (`GeometryFigure.tsx`) translates the spec into
//   JSXGraph board calls. JSXGraph itself loads from CDN at runtime;
//   if loading fails, the surface degrades to a labelled placeholder.
//
// Trust contract
// ──────────────
// • Pure data. Validators are pure functions. No I/O. Safe to import
//   in tests, the build script, the registry, and the renderer.
// • No coordinates or labels in a figure spec ever leak the answer to
//   the problem they belong to — that's an authoring discipline; the
//   validator can flag obvious leaks but cannot enforce them.
//
// Scope (v1.5.2)
// ──────────────
// Element kinds supported: point, line (through two points), segment,
// circle (centre + radius or three points), polygon, function-graph
// (`y = f(x)`), text label.
//
// Out of scope (deferred to v1.5.3+): conic sections by general
// equation, parametric curves, animated sliders, 3D, hyperbolic
// geometry.
// ─────────────────────────────────────────────────────────────────────────────

/** Bounding box for the figure: `[xMin, yMax, xMax, yMin]` (JSXGraph
 *  convention, top-left to bottom-right). */
export type BoundingBox = [number, number, number, number];

/** Common visual options every element accepts. */
export interface FigureElementCommon {
  /** Stable id for cross-referencing (e.g. "A", "B", "lineAB"). */
  id?: string;
  /** Display label (rendered by JSXGraph next to the element). */
  label?: string;
  /** Stroke / fill colour as a CSS hex. Optional; surface theme picks
   *  a default. */
  color?: string;
  /** Whether the element is fixed (not draggable in interactive mode). */
  fixed?: boolean;
}

export type FigureElement =
  | (FigureElementCommon & { kind: "point"; x: number; y: number })
  | (FigureElementCommon & {
      kind: "line";
      /** ids of the two defining points. */
      through: [string, string];
    })
  | (FigureElementCommon & {
      kind: "segment";
      from: string;
      to: string;
    })
  | (FigureElementCommon & {
      kind: "circle";
      /** Either { centre, radius } or { through: [a,b,c] } (3-point form). */
      centre?: string;
      radius?: number;
      through?: [string, string, string];
    })
  | (FigureElementCommon & {
      kind: "polygon";
      vertices: string[];
    })
  | (FigureElementCommon & {
      kind: "graph";
      /** A pure function-of-x string. Evaluated by JSXGraph's expression
       *  parser at render time — math.js syntax (e.g. `x^2 + 3*x + 2`). */
      expr: string;
      /** Optional explicit x-range. Defaults to the bounding box. */
      domain?: [number, number];
    })
  | (FigureElementCommon & {
      kind: "text";
      x: number;
      y: number;
      text: string;
    });

export interface FigureSpec {
  /** A short id for the figure (used for cache keys, accessibility). */
  id: string;
  /** Optional descriptive title. */
  title?: string;
  /** Optional alt-text for screen readers. Required for figures embedded
   *  in problem text — the validator warns if absent. */
  alt?: string;
  /** Bounding box. Defaults to [-5, 5, 5, -5]. */
  boundingBox?: BoundingBox;
  /** Whether to render axes. Default true. */
  axes?: boolean;
  /** Whether to render the grid. Default true. */
  grid?: boolean;
  /** Whether to keep the aspect ratio square. Default true. */
  keepAspectRatio?: boolean;
  /** Whether the figure is read-only (no dragging). Default true. */
  readOnly?: boolean;
  /** The elements, drawn in source order (later elements paint on top). */
  elements: FigureElement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────────────

export interface FigureValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
}

export interface FigureValidationResult {
  ok: boolean;
  issues: FigureValidationIssue[];
}

/**
 * Validates a figure spec. Pure function. Returns a structured list
 * of errors (which block rendering / signing) and warnings (which
 * are surfaced in the authoring UI but don't block).
 *
 * Pinned by `tests/unit/figure-spec.test.ts`. The validator is
 * deliberately strict — geometry that won't render, references to
 * undefined points, or undefined operations all surface as errors.
 */
export function validateFigureSpec(spec: unknown): FigureValidationResult {
  const issues: FigureValidationIssue[] = [];
  const err = (code: string, message: string, path: string) =>
    issues.push({ severity: "error", code, message, path });
  const warn = (code: string, message: string, path: string) =>
    issues.push({ severity: "warning", code, message, path });

  if (!spec || typeof spec !== "object") {
    err("not-object", "Figure spec must be an object", "$");
    return { ok: false, issues };
  }
  const s = spec as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.trim() === "") {
    err("missing-id", "Figure spec must have a non-empty `id`", "$.id");
  }
  if (!Array.isArray(s.elements)) {
    err("missing-elements", "Figure spec must have an `elements` array", "$.elements");
    return { ok: false, issues };
  }
  if (s.alt !== undefined && (typeof s.alt !== "string" || s.alt.trim() === "")) {
    err("bad-alt", "`alt` must be a non-empty string when present", "$.alt");
  } else if (s.alt === undefined) {
    warn("no-alt", "Figure has no `alt` text — screen-reader users will hear nothing", "$.alt");
  }
  if (s.boundingBox !== undefined) {
    if (!Array.isArray(s.boundingBox) || s.boundingBox.length !== 4) {
      err("bad-bbox", "`boundingBox` must be an array of 4 numbers", "$.boundingBox");
    } else if (s.boundingBox.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      err("bad-bbox", "`boundingBox` entries must be finite numbers", "$.boundingBox");
    }
  }

  // Track defined point-ids for downstream cross-references.
  const points = new Set<string>();
  for (let i = 0; i < (s.elements as unknown[]).length; i++) {
    const el = (s.elements as unknown[])[i] as Record<string, unknown>;
    const path = `$.elements[${i}]`;
    if (!el || typeof el !== "object") {
      err("bad-element", "Element must be an object", path);
      continue;
    }
    if (el.kind === "point") {
      if (typeof el.x !== "number" || typeof el.y !== "number") {
        err("bad-point", "Point must have numeric `x` and `y`", path);
      }
      if (typeof el.id === "string" && el.id.length > 0) {
        if (points.has(el.id)) {
          err("duplicate-id", `Duplicate point id: ${el.id}`, `${path}.id`);
        }
        points.add(el.id);
      }
    }
  }

  for (let i = 0; i < (s.elements as unknown[]).length; i++) {
    const el = (s.elements as unknown[])[i] as Record<string, unknown>;
    const path = `$.elements[${i}]`;
    if (!el || typeof el !== "object") continue;
    const kind = el.kind;
    if (kind === "line" || kind === "segment") {
      const from = kind === "line" ? (el.through as [string, string] | undefined)?.[0] : (el.from as string);
      const to = kind === "line" ? (el.through as [string, string] | undefined)?.[1] : (el.to as string);
      if (typeof from !== "string" || typeof to !== "string") {
        err("bad-endpoints", `${kind} must reference two point ids`, path);
        continue;
      }
      if (!points.has(from)) err("undefined-point", `Point id "${from}" not defined`, `${path}.from`);
      if (!points.has(to)) err("undefined-point", `Point id "${to}" not defined`, `${path}.to`);
      if (from === to) err("degenerate", `${kind} endpoints must differ`, path);
    } else if (kind === "circle") {
      const hasCentreRadius = typeof el.centre === "string" && typeof el.radius === "number";
      const hasThree = Array.isArray(el.through) && (el.through as unknown[]).length === 3;
      if (!hasCentreRadius && !hasThree) {
        err(
          "bad-circle",
          "circle needs either { centre, radius } or { through: [a,b,c] }",
          path,
        );
      }
      if (hasCentreRadius && !points.has(el.centre as string)) {
        err("undefined-point", `Circle centre "${el.centre}" not defined`, `${path}.centre`);
      }
      if (hasCentreRadius && (el.radius as number) <= 0) {
        err("bad-radius", "Circle radius must be positive", `${path}.radius`);
      }
      if (hasThree) {
        for (const pid of el.through as string[]) {
          if (!points.has(pid)) err("undefined-point", `Point id "${pid}" not defined`, `${path}.through`);
        }
      }
    } else if (kind === "polygon") {
      const vs = el.vertices as unknown;
      if (!Array.isArray(vs) || vs.length < 3) {
        err("bad-polygon", "polygon needs at least 3 vertex ids", path);
      } else {
        for (const pid of vs as string[]) {
          if (!points.has(pid)) err("undefined-point", `Point id "${pid}" not defined`, `${path}.vertices`);
        }
      }
    } else if (kind === "graph") {
      if (typeof el.expr !== "string" || el.expr.trim() === "") {
        err("bad-graph", "graph needs a non-empty `expr` string", `${path}.expr`);
      }
      if (el.domain !== undefined) {
        if (
          !Array.isArray(el.domain) ||
          (el.domain as unknown[]).length !== 2 ||
          !(el.domain as unknown[]).every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          err("bad-domain", "graph `domain` must be [xMin, xMax]", `${path}.domain`);
        }
      }
    } else if (kind === "text") {
      if (typeof el.x !== "number" || typeof el.y !== "number") {
        err("bad-text", "text needs numeric `x` and `y`", path);
      }
      if (typeof el.text !== "string" || el.text === "") {
        err("bad-text", "text needs a non-empty `text` string", `${path}.text`);
      }
    } else if (kind === "point") {
      // already handled above
    } else {
      err("unknown-kind", `Unknown element kind: ${String(kind)}`, `${path}.kind`);
    }
  }

  return { ok: !issues.some((iss) => iss.severity === "error"), issues };
}
