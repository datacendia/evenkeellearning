// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/content-schema.test.ts
//
// v1.5.0 — Schema validation tests for the content authoring pipeline.
// Covers `validateContentItem`, `validateContentPack`, and the canonical-
// hash determinism contract.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  CONTENT_SCHEMA_VERSION,
  canonicaliseForHash,
  validateContentItem,
  validateContentPack,
  type SchemaContentItem,
  type SchemaContentPack,
} from "@/lib/content/schema";

function makeValidItem(overrides: Partial<SchemaContentItem> = {}): SchemaContentItem {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: "test-item-001",
    skillFamily: "linear-eq-1var",
    subject: "maths",
    jurisdictions: ["IE"],
    difficulty: "core",
    prerequisites: [],
    specPoints: [{ framework: "TEST", code: "T1", label: "Test point" }],
    problem: "Solve 2x + 5 = 17",
    expectedAnswer: 6,
    hints: [
      { tier: 1, text: "What's the first step?" },
      { tier: 2, text: "Could you decompose this?" },
      { tier: 3, text: "Inverse operations isolate the variable." },
    ],
    explanation: "A substantive plain-English walkthrough of how to approach the problem above.",
    misconceptions: [
      { id: "m1", trigger: "off_by_one", explanation: "Off by one explanation here.", nudge: "Try again." },
    ],
    workedExamples: [
      {
        id: "we1",
        problem: "Solve 3x - 4 = 11",
        workedSolution: "Step 1. Add 4 to both sides…",
        expectedAnswer: 5,
      },
    ],
    draft: {
      model: "test",
      provider: "test",
      promptHashB64url: "test-hash",
      draftedAtIso: "2026-04-28T00:00:00.000Z",
      drafterVersion: "1.5.0",
    },
    approvals: [
      {
        reviewerFingerprint: "abc",
        reviewerName: "Test Reviewer",
        approvedAtIso: "2026-04-28T00:00:00.000Z",
        signatureB64url: "fake-sig",
        publicKeyB64url: "fake-key",
      },
      {
        reviewerFingerprint: "def",
        reviewerName: "Peer Reviewer",
        approvedAtIso: "2026-04-28T00:00:00.000Z",
        signatureB64url: "fake-sig-2",
        publicKeyB64url: "fake-key-2",
      }
    ],
    ...overrides,
  };
}

describe("content/schema", () => {
  it("accepts a well-formed item", () => {
    expect(validateContentItem(makeValidItem())).toEqual([]);
  });

  it("rejects wrong schemaVersion", () => {
    const errs = validateContentItem(makeValidItem({ schemaVersion: "0.0.1" as never }));
    expect(errs).toContain(`schemaVersion must be "${CONTENT_SCHEMA_VERSION}"`);
  });

  it("requires all three Socratic tiers", () => {
    const item = makeValidItem();
    const errs = validateContentItem({
      ...item,
      hints: [
        { tier: 1, text: "x" },
        { tier: 2, text: "y" },
        { tier: 1, text: "duplicate tier" },
      ],
    });
    expect(errs.some((e: string) => e.includes("tier 3"))).toBe(true);
  });

  it("requires a substantive explanation", () => {
    const errs = validateContentItem(makeValidItem({ explanation: "too short" }));
    expect(errs.some((e: string) => e.includes("explanation"))).toBe(true);
  });

  it("requires at least one workedExample", () => {
    const errs = validateContentItem(makeValidItem({ workedExamples: [] }));
    expect(errs.some((e: string) => e.includes("workedExamples"))).toBe(true);
  });

  it("requires the approvals block to have at least two signatures", () => {
    const item = makeValidItem();
    const errs1 = validateContentItem({ ...item, approvals: null as never });
    expect(errs1.some((e: string) => e.includes("approvals"))).toBe(true);
    
    const errs2 = validateContentItem({ ...item, approvals: [item.approvals[0]] as never });
    expect(errs2.some((e: string) => e.includes("approvals"))).toBe(true);
  });

  it("rejects duplicate workedExample ids", () => {
    const item = makeValidItem({
      workedExamples: [
        { id: "dup", problem: "p1", workedSolution: "s1", expectedAnswer: 1 },
        { id: "dup", problem: "p2", workedSolution: "s2", expectedAnswer: 2 },
      ],
    });
    const errs = validateContentItem(item);
    expect(errs.some((e: string) => e.includes("duplicate"))).toBe(true);
  });

  it("validateContentPack flags items whose skillFamily disagrees with the pack", () => {
    const pack: SchemaContentPack = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      id: "test.pack",
      title: "Test pack",
      subject: "maths",
      skillFamily: "linear-eq-1var",
      items: [makeValidItem({ skillFamily: "different-family" })],
      metadata: { version: "1.0.0", builtAtIso: "2026-04-28T00:00:00.000Z", description: "x" },
    };
    const errs = validateContentPack(pack);
    expect(errs.some((e: string) => e.includes("skillFamily"))).toBe(true);
  });

  it("canonicaliseForHash is order-independent", () => {
    const a = canonicaliseForHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = canonicaliseForHash({ a: 1, b: 2, nested: { x: 1, y: 2 } });
    expect(a).toBe(b);
  });

  it("canonicaliseForHash distinguishes different content", () => {
    const a = canonicaliseForHash({ x: 1 });
    const b = canonicaliseForHash({ x: 2 });
    expect(a).not.toBe(b);
  });
});
