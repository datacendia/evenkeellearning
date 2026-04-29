// ─────────────────────────────────────────────────────────────────────────────
// components/shared/GeometryFigure.tsx
//
// JSXGraph-backed renderer for the v1.5.2 figure spec. Loads JSXGraph
// lazily from a CDN on first mount, validates the spec, then translates
// elements into board calls. Degrades gracefully to a labelled
// placeholder when JSXGraph fails to load (offline, blocked CDN, SSR).
//
// Trust contract
// ──────────────
// • OFF by default. The component must be imported explicitly by a
//   surface that wants to render figures. No engine code path renders
//   figures automatically.
// • JSXGraph is a deterministic 2-D geometry library; it does not call
//   home, does not generate content, and does not see learner text.
//   Loading from CDN is a single GET; we pin the version. Self-host
//   by supplying `scriptSrc` / `cssHref` props.
// • Validation is run client-side every render and an error overlay
//   replaces the figure if the spec is malformed (signed packs are
//   pre-validated by the build script — this is defence-in-depth).
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  type FigureElement,
  type FigureSpec,
  validateFigureSpec,
} from "@/lib/geometry/figure-spec";

/** Pinned JSXGraph release. */
const DEFAULT_JSXGRAPH_VERSION = "1.10.1";
const DEFAULT_SCRIPT_SRC = `https://cdn.jsdelivr.net/npm/jsxgraph@${DEFAULT_JSXGRAPH_VERSION}/distrib/jsxgraphcore.min.js`;
const DEFAULT_CSS_HREF = `https://cdn.jsdelivr.net/npm/jsxgraph@${DEFAULT_JSXGRAPH_VERSION}/distrib/jsxgraph.css`;

declare global {
  // JSXGraph attaches itself to window.JXG.
  // eslint-disable-next-line no-var
  var JXG: undefined | {
    JSXGraph: {
      initBoard: (
        id: string,
        attrs: Record<string, unknown>,
      ) => GeometryBoard;
      freeBoard: (board: GeometryBoard) => void;
    };
  };
}

interface GeometryBoard {
  create: (kind: string, args: unknown[], attrs?: Record<string, unknown>) => unknown;
}

export interface GeometryFigureProps {
  spec: FigureSpec;
  /** Width in CSS pixels. Default 360. */
  width?: number;
  /** Height in CSS pixels. Default 240. */
  height?: number;
  /** Override the JSXGraph script URL (self-hosting). */
  scriptSrc?: string;
  /** Override the JSXGraph CSS URL (self-hosting). */
  cssHref?: string;
  /** Override the className applied to the wrapper element. */
  className?: string;
}

let jsxgraphLoadPromise: Promise<void> | null = null;

/**
 * Loads the JSXGraph script + CSS at most once per page. Subsequent
 * calls return the same in-flight promise. Resolves when `window.JXG`
 * is defined.
 */
function loadJsxgraph(scriptSrc: string, cssHref: string): Promise<void> {
  if (jsxgraphLoadPromise) return jsxgraphLoadPromise;
  jsxgraphLoadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("JSXGraph requires a browser environment"));
      return;
    }
    if (window.JXG && window.JXG.JSXGraph) {
      resolve();
      return;
    }
    // CSS first (non-blocking).
    if (!document.querySelector(`link[data-jsxgraph]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssHref;
      link.dataset.jsxgraph = "true";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    script.dataset.jsxgraph = "true";
    script.onload = () => {
      if (window.JXG && window.JXG.JSXGraph) {
        resolve();
      } else {
        reject(new Error("JSXGraph script loaded but window.JXG is missing"));
      }
    };
    script.onerror = () => reject(new Error(`Failed to load JSXGraph from ${scriptSrc}`));
    document.head.appendChild(script);
  });
  return jsxgraphLoadPromise;
}

/**
 * React component that renders a `FigureSpec` via JSXGraph.
 */
export function GeometryFigure({
  spec,
  width = 360,
  height = 240,
  scriptSrc = DEFAULT_SCRIPT_SRC,
  cssHref = DEFAULT_CSS_HREF,
  className,
}: GeometryFigureProps) {
  const containerId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationOk, setValidationOk] = useState<boolean>(true);

  useEffect(() => {
    const result = validateFigureSpec(spec);
    if (!result.ok) {
      const messages = result.issues
        .filter((i) => i.severity === "error")
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ");
      setValidationOk(false);
      setError(`Figure spec invalid — ${messages}`);
      return;
    }
    setValidationOk(true);

    let cancelled = false;
    let board: GeometryBoard | null = null;

    loadJsxgraph(scriptSrc, cssHref)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const JXG = (window as { JXG?: typeof globalThis.JXG }).JXG;
        if (!JXG) {
          setError("JSXGraph not available");
          return;
        }
        const bbox = spec.boundingBox ?? [-5, 5, 5, -5];
        board = JXG.JSXGraph.initBoard(containerId, {
          boundingbox: bbox,
          axis: spec.axes ?? true,
          grid: spec.grid ?? true,
          keepaspectratio: spec.keepAspectRatio ?? true,
          showCopyright: false,
          showNavigation: false,
          pan: { enabled: !(spec.readOnly ?? true) },
          zoom: { enabled: !(spec.readOnly ?? true) },
        });

        const points = new Map<string, unknown>();
        for (const el of spec.elements) {
          try {
            renderElement(board, el, points);
          } catch (e) {
            // Don't crash the whole figure on a single element fault;
            // log and continue.
            console.warn("GeometryFigure: element render failed", el, e);
          }
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
      if (board && typeof window !== "undefined" && window.JXG) {
        try {
          window.JXG.JSXGraph.freeBoard(board);
        } catch {
          // ignore
        }
      }
    };
  }, [spec, scriptSrc, cssHref, containerId]);

  if (!validationOk) {
    return (
      <div
        role="img"
        aria-label={spec.alt ?? "Geometry figure (invalid)"}
        className={className}
        style={{
          width,
          height,
          border: "1px dashed var(--border)",
          padding: 12,
          fontSize: 12,
          color: "var(--fg-faint)",
          fontFamily: "var(--mono, monospace)",
        }}
      >
        {error}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="img"
        aria-label={spec.alt ?? "Geometry figure unavailable"}
        className={className}
        style={{
          width,
          height,
          border: "1px dashed var(--border)",
          padding: 12,
          fontSize: 12,
          color: "var(--fg-faint)",
        }}
      >
        Figure could not load: {error}
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={spec.alt ?? spec.title ?? `Figure ${spec.id}`}
      className={className}
    >
      <div
        id={containerId}
        ref={containerRef}
        style={{ width, height }}
      />
    </div>
  );
}

/**
 * Translates a single element from the typed spec into the JSXGraph
 * board calls. Centralised here so the renderer stays readable.
 */
function renderElement(
  board: GeometryBoard,
  el: FigureElement,
  points: Map<string, unknown>,
): void {
  const common: Record<string, unknown> = {};
  if (el.label) common.name = el.label;
  if (el.color) common.strokeColor = el.color;
  if (el.color) common.fillColor = el.color;
  if (el.fixed !== undefined) common.fixed = el.fixed;

  switch (el.kind) {
    case "point": {
      const p = board.create("point", [el.x, el.y], common);
      if (el.id) points.set(el.id, p);
      break;
    }
    case "line": {
      const a = points.get(el.through[0]);
      const b = points.get(el.through[1]);
      if (a && b) board.create("line", [a, b], common);
      break;
    }
    case "segment": {
      const a = points.get(el.from);
      const b = points.get(el.to);
      if (a && b) board.create("segment", [a, b], common);
      break;
    }
    case "circle": {
      if (el.centre !== undefined && typeof el.radius === "number") {
        const c = points.get(el.centre);
        if (c) board.create("circle", [c, el.radius], common);
      } else if (el.through) {
        const [a, b, c] = el.through.map((id) => points.get(id));
        if (a && b && c) board.create("circumcircle", [a, b, c], common);
      }
      break;
    }
    case "polygon": {
      const vs = el.vertices.map((id) => points.get(id)).filter(Boolean);
      if (vs.length >= 3) board.create("polygon", vs, common);
      break;
    }
    case "graph": {
      const args: unknown[] = [el.expr];
      if (el.domain) args.push(el.domain[0], el.domain[1]);
      board.create("functiongraph", args, common);
      break;
    }
    case "text": {
      board.create("text", [el.x, el.y, el.text], common);
      break;
    }
  }
}
