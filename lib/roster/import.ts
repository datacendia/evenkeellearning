// ─────────────────────────────────────────────────────────────────────────────
// lib/roster/import.ts
//
// v1.6.5 — Roster import orchestrator. Wires together the CSV parser
// and the schema validator, and provides a small dry-run / commit API
// the teacher UI calls.
//
// THE PIPELINE
// ────────────
//   string  →  parseCsv()      →  CsvParseResult
//           →  validateRoster() →  RosterValidationResult
//           →  prepareImport()  →  RosterImportPlan          (this file)
//           →  commitImport()   →  RosterImportReceipt       (this file)
//
// `prepareImport` is a PURE function: no side effects, safe to call for
// preview rendering. `commitImport` is the only function that writes
// roster records to durable storage and emits a bus event.
//
// At the bus boundary, ONLY anonymised counts are emitted. Names, DOBs
// and emails never appear in the bus event payload — the bus is read by
// the Compliance Integrity Ledger and by parent / teacher views, none
// of which need PII to function.
// ─────────────────────────────────────────────────────────────────────────────

import { parseCsv, CsvParseError } from "./csv-parser";
import {
  validateRoster,
  type LearnerRecord,
  type RowError,
} from "./schema";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Result of a successful preview parse + validate. The teacher inspects
 * this in the UI before committing. Contains everything the UI needs to
 * render a preview table and an error panel side-by-side.
 */
export interface RosterImportPlan {
  /** Records that passed all validation checks. */
  valid: LearnerRecord[];
  /** Per-row / per-field errors. Empty array means a clean import. */
  errors: RowError[];
  /**
   * High-level summary suitable for a one-line UI banner. Counts only;
   * never exposes PII. */
  summary: {
    totalRows: number;
    valid: number;
    errors: number;
    under13: number;
    duplicates: number;
  };
  /**
   * True if at least one valid record exists. The UI may permit
   * committing even when `errors.length > 0`, as long as `committable`
   * is true — bad rows are skipped, good ones are imported.
   */
  committable: boolean;
}

/**
 * A fatal pipeline error — only used for input-level problems that
 * prevent any validation at all (e.g. unterminated quoted field).
 */
export interface RosterImportFatalError {
  kind: "fatal";
  message: string;
  line?: number;
  column?: number;
}

/**
 * The result of `prepareImport`. Either a plan the UI can preview, or
 * a fatal error that must be surfaced before validation can proceed.
 */
export type PrepareImportResult =
  | { ok: true; plan: RosterImportPlan }
  | { ok: false; error: RosterImportFatalError };

/**
 * The result of `commitImport`. Returned synchronously to the caller
 * AND emitted (in summarised form) on the bus.
 */
export interface RosterImportReceipt {
  /** ISO timestamp of the commit. */
  committedAtIso: string;
  /** Number of records actually written. */
  imported: number;
  /** Number of skipped rows (those with errors). */
  skipped: number;
  /** Number of imported records with isUnder13 = true. */
  under13Count: number;
  /** Stable hash of the imported record set, base64url. Lets the bus
   *  ledger reference the import without storing PII. */
  rosterDigestB64url: string;
}

// ─── Pure preview pipeline ─────────────────────────────────────────────────

/**
 * Parse + validate a CSV string and return a preview plan. Pure — no
 * side effects, safe to call any number of times.
 */
export function prepareImport(
  csv: string,
  today: Date = new Date(),
): PrepareImportResult {
  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (e) {
    if (e instanceof CsvParseError) {
      return {
        ok: false,
        error: {
          kind: "fatal",
          message: e.message,
          line: e.line,
          column: e.column,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "fatal",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const result = validateRoster(parsed, today);

  // Count under-13 in the valid set; count distinct duplicate
  // external_ids reported (one per repeated line).
  let under13 = 0;
  for (const r of result.valid) {
    if (r.isUnder13) under13++;
  }
  const duplicates = result.errors.filter(
    (e) => e.code === "duplicate_external_id",
  ).length;

  // `totalRows` excludes the header row. `parsed.rows.length` includes
  // it; subtract 1 if there's at least one row, but never go below 0.
  const totalRows = Math.max(0, parsed.rows.length - 1);

  const plan: RosterImportPlan = {
    valid: result.valid,
    errors: result.errors,
    summary: {
      totalRows,
      valid: result.valid.length,
      errors: result.errors.length,
      under13,
      duplicates,
    },
    committable: result.valid.length > 0,
  };
  return { ok: true, plan };
}

// ─── Commit ────────────────────────────────────────────────────────────────

/**
 * Compute a stable digest of the imported roster — used as a bus-safe
 * reference to the import without exposing PII. Implementation uses
 * SHA-256 of the canonical JSON of the (sorted) external IDs only;
 * names and DOBs are NOT part of the digest.
 *
 * Async because we use Web Crypto. Falls back to a deterministic
 * non-cryptographic stamp if Web Crypto is unavailable (test env).
 */
async function digestRoster(records: LearnerRecord[]): Promise<string> {
  const ids = records.map((r) => r.externalId).sort();
  const payload = JSON.stringify(ids);
  const enc = new TextEncoder();
  const bytes = enc.encode(payload);
  if (
    typeof globalThis.crypto !== "undefined" &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === "function"
  ) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return base64UrlFromBytes(new Uint8Array(buf));
  }
  // Deterministic non-cryptographic fallback — test envs only.
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  return `fallback-${h1.toString(16)}${h2.toString(16)}`;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === "function"
      ? btoa(bin)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Commit a previously-prepared import plan. Writes records via the
 * supplied `writer` callback (allowing the test suite to use a
 * pure-memory writer and the production code to use the encrypted
 * roster store), and returns a receipt.
 *
 * The bus event is emitted by `writer` via the optional `emit`
 * callback so callers retain control over what the bus sees. This
 * module never imports the bus directly — keeping it side-effect-free
 * and trivially testable.
 */
export async function commitImport(
  plan: RosterImportPlan,
  writer: (records: LearnerRecord[]) => Promise<void> | void,
  emit?: (event: { type: string; payload: Record<string, unknown> }) => void,
): Promise<RosterImportReceipt> {
  if (!plan.committable) {
    throw new Error(
      "commitImport called on a non-committable plan (no valid records).",
    );
  }
  await writer(plan.valid);

  const under13Count = plan.valid.filter((r) => r.isUnder13).length;
  const rosterDigestB64url = await digestRoster(plan.valid);
  const receipt: RosterImportReceipt = {
    committedAtIso: new Date().toISOString(),
    imported: plan.valid.length,
    skipped: plan.errors.length,
    under13Count,
    rosterDigestB64url,
  };

  if (emit) {
    // PII-free payload: counts + digest only.
    emit({
      type: "roster.import.committed",
      payload: {
        committedAtIso: receipt.committedAtIso,
        imported: receipt.imported,
        skipped: receipt.skipped,
        under13Count: receipt.under13Count,
        rosterDigestB64url: receipt.rosterDigestB64url,
      },
    });
  }

  return receipt;
}
