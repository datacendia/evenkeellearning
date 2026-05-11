// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/roster-schema.test.ts
//
// Pins the learner-record validation contract in `lib/roster/schema.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/roster/csv-parser";
import {
  validateRoster,
  type RowError,
  type LearnerRecord,
} from "@/lib/roster/schema";

// Fixed "today" for deterministic age math.
const TODAY = new Date(Date.UTC(2026, 4, 11)); // 2026-05-11

const HEADER =
  "external_id,given_name,family_name,year_group,jurisdiction,date_of_birth,email,class_group,consent_status";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("validateRoster — header checks", () => {
  it("reports every missing required header at line 1", () => {
    // Missing family_name, year_group.
    const r = validateRoster(parseCsv("external_id,given_name,jurisdiction\nA,B,UK-EN"));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: RowError) => e.code === "missing_header_column" && e.field === "family_name")).toBe(true);
    expect(r.errors.some((e: RowError) => e.code === "missing_header_column" && e.field === "year_group")).toBe(true);
  });

  it("reports an empty CSV as a missing-header error", () => {
    const r = validateRoster(parseCsv(""));
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("missing_header_column");
  });

  it("tolerates spaces, case, and dashes in header names", () => {
    const input =
      "External ID,Given-Name,Family Name,Year Group,Jurisdiction\nA1,Sara,Smith,8,UK-EN";
    const r = validateRoster(parseCsv(input), TODAY);
    expect(r.ok).toBe(true);
    expect(r.valid[0].externalId).toBe("A1");
  });
});

describe("validateRoster — required fields", () => {
  it("accepts a clean row", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.ok).toBe(true);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]).toMatchObject({
      externalId: "A1",
      givenName: "Sara",
      familyName: "Smith",
      yearGroup: 8,
      jurisdiction: "UK-EN",
      consentStatus: "pending",
    });
  });

  it("rejects missing external_id", () => {
    const r = validateRoster(parseCsv(csv(",Sara,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.valid).toHaveLength(0);
    expect(r.errors.some((e: RowError) => e.code === "missing_required_field" && e.field === "external_id")).toBe(true);
  });

  it("rejects external_id with disallowed characters (spaces)", () => {
    const r = validateRoster(parseCsv(csv("A 1,Sara,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.errors.some((e: RowError) => e.code === "invalid_external_id_chars")).toBe(true);
  });

  it("rejects external_id over 64 characters", () => {
    const long = "A".repeat(65);
    const r = validateRoster(parseCsv(csv(`${long},Sara,Smith,8,UK-EN,,,,`)), TODAY);
    expect(r.errors.some((e: RowError) => e.code === "field_too_long")).toBe(true);
  });

  it("rejects empty given_name or family_name", () => {
    const r = validateRoster(parseCsv(csv("A1,,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.errors.some((e: RowError) => e.field === "given_name" && e.code === "missing_required_field")).toBe(true);

    const r2 = validateRoster(parseCsv(csv("A1,Sara,,8,UK-EN,,,,")), TODAY);
    expect(r2.errors.some((e: RowError) => e.field === "family_name" && e.code === "missing_required_field")).toBe(true);
  });
});

describe("validateRoster — jurisdiction + year_group", () => {
  it("accepts each supported jurisdiction (with a year that is valid for it)", () => {
    const sampleYear: Record<string, number> = {
      "UK-EN": 8,
      "UK-NI": 9,
      "UK-SC": 7,
      "UK-WL": 8,
      IE: 3,
      US: 6,
      INTL: 5,
    };
    for (const j of Object.keys(sampleYear)) {
      const r = validateRoster(
        parseCsv(csv(`A1,Sara,Smith,${sampleYear[j]},${j},,,,`)),
        TODAY,
      );
      expect(r.valid, `jurisdiction ${j} should accept year ${sampleYear[j]}`).toHaveLength(1);
    }
  });

  it("rejects unknown jurisdiction", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,8,UK,,,,")), TODAY);
    expect(r.errors.some((e: RowError) => e.code === "invalid_jurisdiction")).toBe(true);
  });

  it("year_group: tolerates 'Year 7', 'Y7', '7', 'K'", () => {
    const a = validateRoster(parseCsv(csv("A1,Sara,Smith,Year 7,UK-EN,,,,")), TODAY);
    expect(a.valid[0].yearGroup).toBe(7);
    const b = validateRoster(parseCsv(csv("A2,Sara,Smith,Y7,UK-EN,,,,")), TODAY);
    expect(b.valid[0].yearGroup).toBe(7);
    const c = validateRoster(parseCsv(csv("A3,Sara,Smith,K,US,,,,")), TODAY);
    expect(c.valid[0].yearGroup).toBe(0);
  });

  it("year_group: rejects out-of-range for jurisdiction", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,14,UK-EN,,,,")), TODAY);
    expect(r.errors.some((e: RowError) => e.code === "invalid_year_group")).toBe(true);
    const r2 = validateRoster(parseCsv(csv("A2,Sara,Smith,7,IE,,,,")), TODAY);
    expect(r2.errors.some((e: RowError) => e.code === "invalid_year_group")).toBe(true);
  });

  it("year_group: rejects non-numeric", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,Eight,UK-EN,,,,")), TODAY);
    expect(r.errors.some((e: RowError) => e.code === "invalid_year_group")).toBe(true);
  });
});

describe("validateRoster — date_of_birth + age derivation", () => {
  it("computes isUnder13=false for a learner who has had their 13th birthday", () => {
    // DOB 2012-05-11; today 2026-05-11 → exactly 14.
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,9,UK-EN,2012-05-11,,,")),
      TODAY,
    );
    expect(r.valid[0].isUnder13).toBe(false);
  });

  it("computes isUnder13=true for a learner not yet 13 (before-birthday)", () => {
    // DOB 2014-05-12; today 2026-05-11 → age 11 (birthday tomorrow).
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,7,UK-EN,2014-05-12,,,")),
      TODAY,
    );
    expect(r.valid[0].isUnder13).toBe(true);
  });

  it("computes isUnder13=false on the exact 13th birthday", () => {
    // DOB 2013-05-11; today 2026-05-11 → exactly 13.
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,2013-05-11,,,")),
      TODAY,
    );
    expect(r.valid[0].isUnder13).toBe(false);
  });

  it("rejects non-ISO date formats", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,11/05/2014,,,")),
      TODAY,
    );
    expect(r.errors.some((e: RowError) => e.code === "invalid_date_format")).toBe(true);
  });

  it("rejects fake calendar dates (Feb 30)", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,2014-02-30,,,")),
      TODAY,
    );
    expect(r.errors.some((e: RowError) => e.code === "invalid_date_format")).toBe(true);
  });

  it("rejects ages outside 4..25", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,1999-01-01,,,")),
      TODAY,
    );
    expect(r.errors.some((e: RowError) => e.code === "invalid_age_implied")).toBe(true);
  });

  it("treats an empty date_of_birth as omitted (no error)", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.ok).toBe(true);
    expect(r.valid[0].dateOfBirth).toBeUndefined();
    expect(r.valid[0].isUnder13).toBeUndefined();
  });
});

describe("validateRoster — email, class_group, consent_status", () => {
  it("accepts a valid email and normalises to lowercase", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,,Sara.S@School.ie,,")),
      TODAY,
    );
    expect(r.valid[0].email).toBe("sara.s@school.ie");
  });

  it("rejects malformed email", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,,not-an-email,,")),
      TODAY,
    );
    expect(r.errors.some((e: RowError) => e.code === "invalid_email_format")).toBe(true);
  });

  it("treats empty email as omitted", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.valid[0].email).toBeUndefined();
  });

  it("accepts class_group up to 40 chars", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,Year 8 Set 2,")),
      TODAY,
    );
    expect(r.valid[0].classGroup).toBe("Year 8 Set 2");
  });

  it("rejects over-long class_group", () => {
    const r = validateRoster(
      parseCsv(csv(`A1,Sara,Smith,8,UK-EN,,,${"x".repeat(41)},`)),
      TODAY,
    );
    expect(r.errors.some((e: RowError) => e.code === "field_too_long")).toBe(true);
  });

  it("defaults consent_status to 'pending' when omitted", () => {
    const r = validateRoster(parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,,")), TODAY);
    expect(r.valid[0].consentStatus).toBe("pending");
  });

  it("accepts the four valid consent_status values", () => {
    for (const c of [
      "parental_consent_on_file",
      "learner_self_consent",
      "pending",
      "not_required",
    ]) {
      const r = validateRoster(
        parseCsv(csv(`A1,Sara,Smith,8,UK-EN,,,,${c}`)),
        TODAY,
      );
      expect(r.valid[0].consentStatus).toBe(c);
    }
  });

  it("rejects unknown consent_status", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,,unknown")),
      TODAY,
    );
    expect(r.errors.some((e: RowError) => e.code === "invalid_consent_status")).toBe(true);
  });
});

describe("validateRoster — duplicate external_id", () => {
  it("flags the SECOND occurrence and references the first line", () => {
    const r = validateRoster(
      parseCsv(csv("A1,Sara,Smith,8,UK-EN,,,,", "A1,Tom,Jones,8,UK-EN,,,,")),
      TODAY,
    );
    expect(r.valid).toHaveLength(1);
    const dup = r.errors.find((e: RowError) => e.code === "duplicate_external_id");
    expect(dup).toBeDefined();
    expect(dup!.line).toBe(3);
    expect(dup!.message).toMatch(/line 2/);
  });
});

describe("validateRoster — mixed valid + invalid", () => {
  it("returns valid rows AND errors when both occur in one import", () => {
    const r = validateRoster(
      parseCsv(
        csv(
          "A1,Sara,Smith,8,UK-EN,,,,",            // valid
          ",Bob,Jones,8,UK-EN,,,,",                // missing external_id
          "A3,Mia,Lee,99,UK-EN,,,,",               // bad year_group
          "A4,Liu,Wei,9,UK-EN,2014-05-12,,,",      // valid + under-13
        ),
      ),
      TODAY,
    );
    expect(r.valid).toHaveLength(2);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.valid.find((v: LearnerRecord) => v.externalId === "A4")!.isUnder13).toBe(true);
  });
});
