// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/roster-import.test.ts
//
// End-to-end tests for the roster import orchestrator. Exercises the
// full pipeline (CSV string → prepareImport → commitImport) and verifies
// the bus-emission contract (PII never escapes commitImport).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import {
  prepareImport,
  commitImport,
  type RosterImportPlan,
} from "@/lib/roster/import";
import type { LearnerRecord } from "@/lib/roster/schema";

const TODAY = new Date(Date.UTC(2026, 4, 11));

const HEADER =
  "external_id,given_name,family_name,year_group,jurisdiction,date_of_birth,email,class_group,consent_status";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("prepareImport — happy path", () => {
  it("returns a committable plan for a clean CSV", () => {
    const r = prepareImport(csv("A1,Sara,Smith,8,UK-EN,,,,"), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.committable).toBe(true);
    expect(r.plan.summary).toEqual({
      totalRows: 1,
      valid: 1,
      errors: 0,
      under13: 0,
      duplicates: 0,
    });
  });

  it("counts under-13 learners in the summary", () => {
    const r = prepareImport(
      csv(
        "A1,Sara,Smith,7,UK-EN,2014-05-12,,,",
        "A2,Tom,Jones,9,UK-EN,2011-05-12,,,",
      ),
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.summary.under13).toBe(1);
  });

  it("counts duplicates in the summary", () => {
    const r = prepareImport(
      csv(
        "A1,Sara,Smith,8,UK-EN,,,,",
        "A1,Tom,Jones,8,UK-EN,,,,",
        "A1,Mia,Lee,8,UK-EN,,,,",
      ),
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.summary.duplicates).toBe(2);
    expect(r.plan.summary.valid).toBe(1);
  });
});

describe("prepareImport — error paths", () => {
  it("returns a fatal error for unterminated quoted field", () => {
    const r = prepareImport(`${HEADER}\n"A1,Sara,Smith,8,UK-EN,,,,`, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("fatal");
    expect(r.error.line).toBe(2);
  });

  it("returns committable=false when no rows are valid", () => {
    const r = prepareImport(
      csv(",Sara,Smith,8,UK-EN,,,,"),
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.committable).toBe(false);
    expect(r.plan.summary.errors).toBeGreaterThan(0);
  });

  it("still committable when there is a mix of valid + invalid rows", () => {
    const r = prepareImport(
      csv("A1,Sara,Smith,8,UK-EN,,,,", ",Bob,Jones,8,UK-EN,,,,"),
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.committable).toBe(true);
    expect(r.plan.summary.valid).toBe(1);
    expect(r.plan.summary.errors).toBeGreaterThan(0);
  });
});

describe("commitImport", () => {
  function buildPlan(): RosterImportPlan {
    const r = prepareImport(
      csv(
        "A1,Sara,Smith,7,UK-EN,2014-05-12,,,",
        "A2,Tom,Jones,9,UK-EN,2011-05-12,,,",
      ),
      TODAY,
    );
    if (!r.ok) throw new Error("expected ok");
    return r.plan;
  }

  it("writes records and returns a receipt", async () => {
    const plan = buildPlan();
    const written: LearnerRecord[] = [];
    const receipt = await commitImport(plan, (recs: LearnerRecord[]) => {
      written.push(...recs);
    });
    expect(written).toHaveLength(2);
    expect(receipt.imported).toBe(2);
    expect(receipt.under13Count).toBe(1);
    expect(receipt.rosterDigestB64url.length).toBeGreaterThan(0);
  });

  it("emits a PII-free bus event when an emit callback is provided", async () => {
    const plan = buildPlan();
    const emit = vi.fn();
    await commitImport(plan, () => {}, emit);
    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0] as {
      type: string;
      payload: Record<string, unknown>;
    };
    expect(event.type).toBe("roster.import.committed");
    // PII guard: payload keys must not include name / dob / email.
    const payloadJson = JSON.stringify(event.payload);
    expect(payloadJson).not.toMatch(/sara|tom|smith|jones|2014|2011|@/i);
    // Counts present.
    expect(event.payload.imported).toBe(2);
    expect(event.payload.under13Count).toBe(1);
    expect(typeof event.payload.rosterDigestB64url).toBe("string");
  });

  it("digest is stable across calls and order-independent", async () => {
    const planA = buildPlan();
    const planB = buildPlan();
    // Reverse the valid list in plan B to confirm digest sorts.
    planB.valid = [...planB.valid].reverse();
    const a = await commitImport(planA, () => {});
    const b = await commitImport(planB, () => {});
    expect(a.rosterDigestB64url).toBe(b.rosterDigestB64url);
  });

  it("digest differs when the external_id set differs", async () => {
    const planA = buildPlan();
    const planB = buildPlan();
    planB.valid = [planB.valid[0]];
    const a = await commitImport(planA, () => {});
    const b = await commitImport(planB, () => {});
    expect(a.rosterDigestB64url).not.toBe(b.rosterDigestB64url);
  });

  it("throws when called on a non-committable plan", async () => {
    const r = prepareImport(csv(",Sara,Smith,8,UK-EN,,,,"), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await expect(commitImport(r.plan, () => {})).rejects.toThrow(/non-committable/);
  });

  it("propagates writer exceptions", async () => {
    const plan = buildPlan();
    await expect(
      commitImport(plan, () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
  });
});
