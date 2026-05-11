// ─────────────────────────────────────────────────────────────────────────────
// lib/roster/schema.ts
//
// v1.6.5 — Learner-record schema for CSV roster imports. Hand-rolled
// (no Zod) because:
//   • This is a small, stable, well-bounded schema. The cost of pulling
//     in Zod for a single use site is not justified.
//   • We need fine-grained, per-FIELD error reporting with line numbers
//     for the spreadsheet UI; rolling our own gives us full control of
//     the error shape.
//   • Roster data is privacy-sensitive (DOB, names, possibly email).
//     Every line of validation logic should be small enough to audit
//     directly.
//
// THE WIRE FORMAT (CSV column names — case-insensitive, space/under-
// score tolerant)
// ─────────────────────────────────────────────────────────────────────
//   external_id        REQUIRED. The school's own learner ID. Unique
//                      within the file. 1–64 chars, [A-Za-z0-9_.-].
//   given_name         REQUIRED. 1–80 chars after trim.
//   family_name        REQUIRED. 1–80 chars after trim.
//   year_group         REQUIRED. Integer; bounds depend on jurisdiction
//                      (UK 7–13, IE 1–6, US 0–12, INTL 0–13).
//   jurisdiction       REQUIRED. One of UK-EN | UK-NI | UK-SC | UK-WL |
//                      IE | US | INTL.
//   date_of_birth      OPTIONAL. ISO YYYY-MM-DD. If present, derived
//                      age must lie in [4, 25]. Used to flag COPPA /
//                      UK-GDPR Article 8 cases.
//   email              OPTIONAL. RFC-5321-ish. Max 254 chars.
//   class_group        OPTIONAL. Free text up to 40 chars (e.g. "10A").
//   consent_status     OPTIONAL. One of parental_consent_on_file |
//                      learner_self_consent | pending | not_required.
//                      Defaults to `pending`.
//
// PRIVACY POSTURE
// ───────────────
// Names + DOB + email are personal data under GDPR. The roster import
// pipeline:
//   (1) parses + validates entirely client-side;
//   (2) commits ONLY after the teacher confirms the dry-run preview;
//   (3) stores at rest using the same encrypted bus mechanism as every
//       other artefact (lib/bus-at-rest);
//   (4) emits ONLY anonymised counts in `roster.import.committed` bus
//       events (e.g. {imported: 28, skipped: 2}); never names or DOBs.
// ─────────────────────────────────────────────────────────────────────────────

import { rowsToObjects, type CsvParseResult } from "./csv-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Jurisdiction =
  | "UK-EN"
  | "UK-NI"
  | "UK-SC"
  | "UK-WL"
  | "IE"
  | "US"
  | "INTL";

export type ConsentStatus =
  | "parental_consent_on_file"
  | "learner_self_consent"
  | "pending"
  | "not_required";

/** A validated, normalised learner record. */
export interface LearnerRecord {
  externalId: string;
  givenName: string;
  familyName: string;
  yearGroup: number;
  jurisdiction: Jurisdiction;
  dateOfBirth?: string; // ISO YYYY-MM-DD, validated
  email?: string;
  classGroup?: string;
  consentStatus: ConsentStatus;
  /**
   * True if the DERIVED age (today − dateOfBirth) is < 13. Flags
   * COPPA-protected and UK-GDPR Article 8 learners so the teacher must
   * confirm parental consent before commit. Only computable when
   * dateOfBirth is present.
   */
  isUnder13?: boolean;
}

/** A structured per-field validation error. */
export interface RowError {
  /** 1-indexed source line in the CSV. */
  line: number;
  /** Logical CSV column (lower-cased, space-stripped) the error refers to.
   * Empty string for whole-row errors (e.g. duplicate external_id). */
  field: string;
  /** Stable machine code for the error class. */
  code: RowErrorCode;
  /** Human-readable message. Safe to display verbatim in the UI. */
  message: string;
}

export type RowErrorCode =
  | "missing_required_field"
  | "field_too_long"
  | "field_too_short"
  | "invalid_external_id_chars"
  | "invalid_year_group"
  | "invalid_jurisdiction"
  | "invalid_date_format"
  | "invalid_age_implied"
  | "invalid_email_format"
  | "invalid_consent_status"
  | "duplicate_external_id"
  | "missing_header_column";

/** Result of validating an entire parsed CSV. */
export interface RosterValidationResult {
  valid: LearnerRecord[];
  errors: RowError[];
  /** True if there are no errors AND at least one valid record. */
  ok: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const REQUIRED_HEADERS = [
  "external_id",
  "given_name",
  "family_name",
  "year_group",
  "jurisdiction",
] as const;

export const OPTIONAL_HEADERS = [
  "date_of_birth",
  "email",
  "class_group",
  "consent_status",
] as const;

const JURISDICTION_VALUES: ReadonlySet<string> = new Set([
  "UK-EN",
  "UK-NI",
  "UK-SC",
  "UK-WL",
  "IE",
  "US",
  "INTL",
]);

const CONSENT_VALUES: ReadonlySet<string> = new Set([
  "parental_consent_on_file",
  "learner_self_consent",
  "pending",
  "not_required",
]);

const YEAR_RANGE: Record<Jurisdiction, [number, number]> = {
  "UK-EN": [7, 13],
  "UK-NI": [7, 14], // NI Years 8–14 historically; we accept 7–14 to be lenient
  "UK-SC": [1, 13], // S1–S6 mapped to internal 7–12 by convention; lenient
  "UK-WL": [7, 13],
  IE: [1, 6], // Junior Cycle 1–3 + Senior Cycle 4–6 (incl. TY)
  US: [0, 12], // K = 0
  INTL: [0, 13],
};

// External-ID character set: alphanumeric plus _ . -. Disallows
// whitespace and control characters. Length checked separately.
const EXTERNAL_ID_RE = /^[A-Za-z0-9_.-]+$/;

// Pragmatic email check. NOT a full RFC 5322 grammar (which is a tar
// pit). Requires: non-empty local part, single @, non-empty domain
// containing at least one dot, no whitespace anywhere.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Header helpers ─────────────────────────────────────────────────────────

/**
 * Normalise a header string to the canonical lower-snake form used in
 * the schema. Tolerates spaces, case differences, and en/em dashes.
 */
function normaliseHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Check that all required headers are present in the parsed CSV. Any
 * missing required header is reported as a single row error at line 1.
 */
function checkRequiredHeaders(parsed: CsvParseResult): RowError[] {
  if (parsed.rows.length === 0) {
    return [
      {
        line: 1,
        field: "",
        code: "missing_header_column",
        message: "CSV is empty — no header row found.",
      },
    ];
  }
  const present = new Set(parsed.rows[0].map(normaliseHeader));
  const errors: RowError[] = [];
  for (const required of REQUIRED_HEADERS) {
    if (!present.has(required)) {
      errors.push({
        line: 1,
        field: required,
        code: "missing_header_column",
        message: `Required column "${required}" is missing from the CSV header.`,
      });
    }
  }
  return errors;
}

// ─── Field validators ───────────────────────────────────────────────────────

function validateExternalId(
  value: string,
  line: number,
  errors: RowError[],
): string | null {
  const v = value.trim();
  if (v.length === 0) {
    errors.push({
      line,
      field: "external_id",
      code: "missing_required_field",
      message: "external_id is required.",
    });
    return null;
  }
  if (v.length > 64) {
    errors.push({
      line,
      field: "external_id",
      code: "field_too_long",
      message: "external_id must be 64 characters or fewer.",
    });
    return null;
  }
  if (!EXTERNAL_ID_RE.test(v)) {
    errors.push({
      line,
      field: "external_id",
      code: "invalid_external_id_chars",
      message:
        "external_id may only contain letters, digits, underscore, dot, or hyphen.",
    });
    return null;
  }
  return v;
}

function validateName(
  value: string,
  fieldName: "given_name" | "family_name",
  line: number,
  errors: RowError[],
): string | null {
  const v = value.trim();
  if (v.length === 0) {
    errors.push({
      line,
      field: fieldName,
      code: "missing_required_field",
      message: `${fieldName} is required.`,
    });
    return null;
  }
  if (v.length > 80) {
    errors.push({
      line,
      field: fieldName,
      code: "field_too_long",
      message: `${fieldName} must be 80 characters or fewer.`,
    });
    return null;
  }
  return v;
}

function validateJurisdiction(
  value: string,
  line: number,
  errors: RowError[],
): Jurisdiction | null {
  const v = value.trim().toUpperCase();
  if (v.length === 0) {
    errors.push({
      line,
      field: "jurisdiction",
      code: "missing_required_field",
      message: "jurisdiction is required.",
    });
    return null;
  }
  if (!JURISDICTION_VALUES.has(v)) {
    errors.push({
      line,
      field: "jurisdiction",
      code: "invalid_jurisdiction",
      message:
        `jurisdiction "${value}" is not recognised. Use one of UK-EN, ` +
        `UK-NI, UK-SC, UK-WL, IE, US, INTL.`,
    });
    return null;
  }
  return v as Jurisdiction;
}

function validateYearGroup(
  value: string,
  jurisdiction: Jurisdiction | null,
  line: number,
  errors: RowError[],
): number | null {
  const v = value.trim();
  if (v.length === 0) {
    errors.push({
      line,
      field: "year_group",
      code: "missing_required_field",
      message: "year_group is required.",
    });
    return null;
  }
  // Tolerate "Year 7", "Y7", "7", "K" (US Kindergarten).
  let n: number;
  if (/^k$/i.test(v)) {
    n = 0;
  } else {
    const m = v.match(/^(?:year\s*|y)?(\d{1,2})$/i);
    if (!m) {
      errors.push({
        line,
        field: "year_group",
        code: "invalid_year_group",
        message: `year_group "${value}" is not a recognised number.`,
      });
      return null;
    }
    n = Number(m[1]);
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    errors.push({
      line,
      field: "year_group",
      code: "invalid_year_group",
      message: `year_group "${value}" is not an integer.`,
    });
    return null;
  }
  if (jurisdiction) {
    const [lo, hi] = YEAR_RANGE[jurisdiction];
    if (n < lo || n > hi) {
      errors.push({
        line,
        field: "year_group",
        code: "invalid_year_group",
        message:
          `year_group ${n} is out of range for jurisdiction ` +
          `${jurisdiction} (expected ${lo}–${hi}).`,
      });
      return null;
    }
  }
  return n;
}

/**
 * Validate ISO date and derive an age (in completed years) at the
 * supplied `today`. Returns the canonicalised date string AND the
 * derived isUnder13 flag, or null on any error.
 */
function validateDateOfBirth(
  value: string,
  line: number,
  errors: RowError[],
  today: Date,
): { iso: string; isUnder13: boolean } | null {
  const v = value.trim();
  if (v.length === 0) return null; // optional field
  if (!ISO_DATE_RE.test(v)) {
    errors.push({
      line,
      field: "date_of_birth",
      code: "invalid_date_format",
      message: `date_of_birth must be in YYYY-MM-DD format. Got "${value}".`,
    });
    return null;
  }
  const [y, m, d] = v.split("-").map(Number);
  // Construct as UTC to avoid local-timezone off-by-one on date math.
  const dob = new Date(Date.UTC(y, m - 1, d));
  if (
    dob.getUTCFullYear() !== y ||
    dob.getUTCMonth() !== m - 1 ||
    dob.getUTCDate() !== d
  ) {
    errors.push({
      line,
      field: "date_of_birth",
      code: "invalid_date_format",
      message: `date_of_birth "${value}" is not a real calendar date.`,
    });
    return null;
  }
  // Compute age in completed years at `today`, in UTC.
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  let age = todayUtc.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    todayUtc.getUTCMonth() < dob.getUTCMonth() ||
    (todayUtc.getUTCMonth() === dob.getUTCMonth() &&
      todayUtc.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age--;

  if (age < 4 || age > 25) {
    errors.push({
      line,
      field: "date_of_birth",
      code: "invalid_age_implied",
      message:
        `date_of_birth "${value}" implies an age of ${age}, which is ` +
        `outside the supported range (4–25).`,
    });
    return null;
  }
  return { iso: v, isUnder13: age < 13 };
}

function validateEmail(
  value: string,
  line: number,
  errors: RowError[],
): string | null {
  const v = value.trim();
  if (v.length === 0) return null; // optional
  if (v.length > 254) {
    errors.push({
      line,
      field: "email",
      code: "field_too_long",
      message: "email must be 254 characters or fewer (RFC 5321).",
    });
    return null;
  }
  if (!EMAIL_RE.test(v)) {
    errors.push({
      line,
      field: "email",
      code: "invalid_email_format",
      message: `email "${value}" is not a recognisable address.`,
    });
    return null;
  }
  return v.toLowerCase();
}

function validateClassGroup(
  value: string,
  line: number,
  errors: RowError[],
): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > 40) {
    errors.push({
      line,
      field: "class_group",
      code: "field_too_long",
      message: "class_group must be 40 characters or fewer.",
    });
    return null;
  }
  return v;
}

function validateConsent(
  value: string,
  line: number,
  errors: RowError[],
): ConsentStatus {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return "pending";
  if (!CONSENT_VALUES.has(v)) {
    errors.push({
      line,
      field: "consent_status",
      code: "invalid_consent_status",
      message:
        `consent_status "${value}" is not recognised. Use one of ` +
        `parental_consent_on_file, learner_self_consent, pending, not_required.`,
    });
    return "pending";
  }
  return v as ConsentStatus;
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Validate a parsed CSV result against the learner-record schema.
 * Returns valid records AND a complete list of structured errors.
 *
 * @param parsed   The output of `parseCsv()`.
 * @param today    Optional override for "today" (used by tests). Defaults
 *                 to `new Date()`. Used only for DOB → age derivation.
 */
export function validateRoster(
  parsed: CsvParseResult,
  today: Date = new Date(),
): RosterValidationResult {
  const headerErrors = checkRequiredHeaders(parsed);
  if (headerErrors.length > 0) {
    // If headers are wrong we cannot meaningfully validate rows.
    return { valid: [], errors: headerErrors, ok: false };
  }

  const { records } = rowsToObjects(parsed);
  // Normalise the values map's keys into our canonical snake form so we
  // can index by required-header names directly. `rowsToObjects`
  // already lower-cases; it does NOT collapse spaces to underscores.
  const errors: RowError[] = [];
  const valid: LearnerRecord[] = [];
  const seenIds = new Map<string, number>(); // externalId → first line seen

  for (const rec of records) {
    const norm: Record<string, string> = {};
    for (const k of Object.keys(rec.values)) {
      norm[normaliseHeader(k)] = rec.values[k];
    }

    const before = errors.length;

    const externalId = validateExternalId(norm.external_id ?? "", rec.line, errors);
    const givenName = validateName(norm.given_name ?? "", "given_name", rec.line, errors);
    const familyName = validateName(norm.family_name ?? "", "family_name", rec.line, errors);
    const jurisdiction = validateJurisdiction(norm.jurisdiction ?? "", rec.line, errors);
    const yearGroup = validateYearGroup(
      norm.year_group ?? "",
      jurisdiction,
      rec.line,
      errors,
    );
    const dob = validateDateOfBirth(
      norm.date_of_birth ?? "",
      rec.line,
      errors,
      today,
    );
    const email = validateEmail(norm.email ?? "", rec.line, errors);
    const classGroup = validateClassGroup(norm.class_group ?? "", rec.line, errors);
    const consentStatus = validateConsent(norm.consent_status ?? "", rec.line, errors);

    // If any required field failed, skip the row entirely (no half-records).
    if (
      errors.length > before ||
      !externalId ||
      !givenName ||
      !familyName ||
      !jurisdiction ||
      yearGroup === null
    ) {
      continue;
    }

    // Duplicate-externalId check (within this import).
    const prior = seenIds.get(externalId);
    if (prior !== undefined) {
      errors.push({
        line: rec.line,
        field: "external_id",
        code: "duplicate_external_id",
        message:
          `external_id "${externalId}" was already used on line ${prior}. ` +
          `Each learner must have a unique external_id within the file.`,
      });
      continue;
    }
    seenIds.set(externalId, rec.line);

    const record: LearnerRecord = {
      externalId,
      givenName,
      familyName,
      yearGroup,
      jurisdiction,
      consentStatus,
    };
    if (dob) {
      record.dateOfBirth = dob.iso;
      record.isUnder13 = dob.isUnder13;
    }
    if (email) record.email = email;
    if (classGroup) record.classGroup = classGroup;

    valid.push(record);
  }

  return {
    valid,
    errors,
    ok: errors.length === 0 && valid.length > 0,
  };
}
