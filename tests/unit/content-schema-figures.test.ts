// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/content-schema-figures.test.ts
//
// v1.5.3 — pins the integration between `lib/content/schema.ts` and the
// figure validator. A SchemaContentItem may carry an optional `figures`
// array; valid figures pass, malformed figures cause `validateContentItem`
// to fail loudly so the registry can't serve a broken figure to a learner.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { validateContentItem } from "@/lib/content/schema";

const baseItem = {
  schemaVersion: "1.0.0",
  id: "item-001",
  skillFamily: "linear-eq-1var",
  subject: "maths",
  jurisdictions: ["IE"],
  difficulty: "core",
  prerequisites: [],
  specPoints: [],
  problem: "Solve for x: 2x + 5 = 17",
  expectedAnswer: 6,
  hints: [
    { tier: 1, text: "First move?" },
    { tier: 2, text: "Undo +5?" },
    { tier: 3, text: "Inverse operations in reverse order." },
  ],
  explanation: "Subtract 5, then divide by 2 — the standard two-step method.",
  misconceptions: [],
  workedExamples: [
    { id: "wx-1", problem: "Solve 3x − 4 = 11", workedSolution: "x = 5", expectedAnswer: 5 },
  ],
  draft: {
    model: "manual",
    provider: "human-author",
    promptHashB64url: "X",
    draftedAtIso: "2026-04-28T00:00:00.000Z",
    drafterVersion: "1.5.0",
  },
  approval: {
    reviewerFingerprint: "abc",
    reviewerName: "Test Reviewer",
    approvedAtIso: "2026-04-28T00:00:00.000Z",
    signatureB64url: "sig",
    publicKeyB64url: "pub",
  },
};

describe("validateContentItem — figures integration (v1.5.3)", () => {
  it("accepts an item with no figures field", () => {
    const errs = validateContentItem(baseItem);
    expect(errs).toEqual([]);
  });

  it("accepts an item with a valid figure", () => {
    const errs = validateContentItem({
      ...baseItem,
      figures: [
        {
          id: "graph-1",
          alt: "graph of y equals 2 x plus 5",
          elements: [{ kind: "graph", expr: "2*x + 5" }],
        },
      ],
    });
    expect(errs).toEqual([]);
  });

  it("rejects an item with `figures` that is not an array", () => {
    const errs = validateContentItem({ ...baseItem, figures: "not-an-array" });
    expect(errs.some((e) => e.includes("figures must be an array"))).toBe(true);
  });

  it("rejects an item with a malformed figure (missing id)", () => {
    const errs = validateContentItem({
      ...baseItem,
      figures: [
        {
          // id missing
          alt: "x",
          elements: [{ kind: "graph", expr: "x" }],
        },
      ],
    });
    expect(errs.some((e) => e.includes("figures[0]") && e.includes("id"))).toBe(true);
  });

  it("rejects an item whose figure references an undefined point", () => {
    const errs = validateContentItem({
      ...baseItem,
      figures: [
        {
          id: "bad-1",
          alt: "ghost",
          elements: [
            { kind: "point", id: "A", x: 0, y: 0 },
            { kind: "line", through: ["A", "phantom"] },
          ],
        },
      ],
    });
    expect(errs.some((e) => e.includes("phantom"))).toBe(true);
  });

  it("propagates figure errors with prefixed paths so reviewers can locate them", () => {
    const errs = validateContentItem({
      ...baseItem,
      figures: [
        { id: "ok", alt: "a", elements: [{ kind: "graph", expr: "x" }] },
        { id: "bad", alt: "b", elements: [{ kind: "graph", expr: "" }] },
      ],
    });
    expect(errs.some((e) => e.startsWith("figures[1]"))).toBe(true);
  });
});
