// ─────────────────────────────────────────────────────────────────────────────
// lib/roster/csv-parser.ts
//
// v1.6.5 — RFC 4180 compliant CSV parser. Hand-rolled (no dependency)
// because:
//   • CSV libraries on npm vary wildly in their RFC 4180 conformance,
//     particularly around embedded quotes ("") and embedded newlines
//     inside quoted fields.
//   • Roster import is a sensitive data path; we want every line of
//     parsing logic to be auditable and tested directly.
//   • The performance cost of writing it ourselves is negligible for
//     classroom-scale files (<1 MB / <1000 rows).
//
// CONFORMANCE
// ───────────
// This parser implements RFC 4180:
//   • Records separated by CRLF (\r\n). LF (\n) alone is also accepted
//     (a widespread real-world deviation; required for UNIX-line-ending
//     files exported from spreadsheet apps on macOS / Linux).
//   • Fields separated by commas.
//   • Fields MAY be enclosed in double quotes.
//   • A field containing a comma, newline, or double quote MUST be
//     enclosed in double quotes.
//   • A double quote inside a quoted field is represented by a pair
//     of double quotes ("").
//   • A trailing line terminator on the last record is optional.
//   • Whitespace within unquoted fields is preserved exactly.
//   • Empty fields ("a,,b") are returned as empty strings.
//
// NON-CONFORMANCE (deliberate, documented)
// ────────────────────────────────────────
//   • A row with a different field count from its peers is NOT auto-
//     rejected here — `parseCsv` returns the rows as parsed, and the
//     downstream `roster/schema` validator decides what to do with a
//     ragged row. Separation of concerns: this file is a parser, not
//     a schema enforcer.
//   • UTF-8 BOM (\uFEFF) at the start of the input is silently stripped.
//   • Header row detection is the caller's responsibility (`parseCsv`
//     does NOT special-case the first row).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One parsed row, returned in the order the fields appeared. Use
 * `rowsToObjects` if you have a header row and want named fields.
 */
export type CsvRow = string[];

/**
 * Result of parsing a CSV input. Includes 1-indexed line numbers so
 * downstream validators can report errors at the source line.
 */
export interface CsvParseResult {
  rows: CsvRow[];
  /**
   * 1-indexed source line number for each row. A row that spans
   * multiple physical lines (because it contains quoted newlines) is
   * reported at its FIRST line.
   */
  rowLineNumbers: number[];
}

/**
 * A structured parse error. Distinguishes recoverable issues (e.g. a
 * row with the wrong field count) from fatal ones (unterminated quoted
 * field) by using exception throws only for fatal errors. `parseCsv`
 * itself never throws — it returns rows even when ragged.
 */
export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`CSV parse error at line ${line}, column ${column}: ${message}`);
    this.name = "CsvParseError";
  }
}

/** Internal parser state. */
const enum State {
  // Between fields — we've just finished a field or are at the start
  // of a record. The next character determines the field type.
  FIELD_START = 0,
  // Inside an unquoted field. Comma ends the field; CR/LF ends the row.
  IN_UNQUOTED = 1,
  // Inside a quoted field. Only a closing quote can end it.
  IN_QUOTED = 2,
  // Just saw a quote inside a quoted field. Either it's the close, or
  // (if followed by another quote) it's an escaped quote.
  QUOTE_IN_QUOTED = 3,
}

/**
 * Parse a CSV string into rows. Never throws on ragged-row issues; will
 * throw a `CsvParseError` only on a fatal structural defect (an
 * unterminated quoted field).
 */
export function parseCsv(input: string): CsvParseResult {
  // Strip UTF-8 BOM if present. Spreadsheet apps frequently emit one.
  if (input.length > 0 && input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1);
  }

  const rows: CsvRow[] = [];
  const rowLineNumbers: number[] = [];

  let state: State = State.FIELD_START;
  let field = "";
  let row: string[] = [];
  let line = 1;
  let column = 0;
  // Line where the current row started (for error reporting).
  let rowStartLine = 1;

  // Whether we have started a row (i.e. seen at least one character of
  // a field, or a separator). Used to distinguish a truly empty input
  // from one whose last record has a trailing newline.
  let rowHasContent = false;

  const finishField = () => {
    row.push(field);
    field = "";
  };

  const finishRow = () => {
    rows.push(row);
    rowLineNumbers.push(rowStartLine);
    row = [];
    rowHasContent = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    column++;

    if (ch === "\r") {
      // Treat CR as part of a CRLF pair if followed by LF; otherwise as
      // a bare CR line terminator (rare but legal historically).
      if (state === State.IN_QUOTED) {
        // CR inside a quoted field is part of the field content.
        field += ch;
        continue;
      }
      // Look ahead — if next is \n we'll handle it on the next loop
      // iteration; if not, we still close the row here.
      if (state === State.QUOTE_IN_QUOTED) {
        // Closing quote was the previous char; we're now between fields.
        state = State.FIELD_START;
      }
      finishField();
      finishRow();
      state = State.FIELD_START;
      // If next is LF, swallow it as part of the same line terminator.
      if (input[i + 1] === "\n") {
        i++;
      }
      line++;
      column = 0;
      rowStartLine = line;
      continue;
    }

    if (ch === "\n") {
      if (state === State.IN_QUOTED) {
        // Newline inside a quoted field is part of the field content.
        field += ch;
        line++;
        column = 0;
        continue;
      }
      if (state === State.QUOTE_IN_QUOTED) {
        // Closing quote was the previous char; row ends here.
        state = State.FIELD_START;
      }
      finishField();
      finishRow();
      state = State.FIELD_START;
      line++;
      column = 0;
      rowStartLine = line;
      continue;
    }

    // Non-line-terminator character. Mark that the current row has
    // started so a trailing newline doesn't produce a phantom empty row.
    rowHasContent = true;

    switch (state) {
      case State.FIELD_START:
        if (ch === '"') {
          state = State.IN_QUOTED;
        } else if (ch === ",") {
          // Empty field followed by a separator; commit and continue.
          finishField();
          state = State.FIELD_START;
        } else {
          field += ch;
          state = State.IN_UNQUOTED;
        }
        break;

      case State.IN_UNQUOTED:
        if (ch === ",") {
          finishField();
          state = State.FIELD_START;
        } else if (ch === '"') {
          // RFC 4180 doesn't permit a quote inside an unquoted field.
          // Real-world CSV often does this anyway. We accept it as a
          // literal character to stay tolerant — if this becomes a
          // problem we can flag it as a recoverable warning.
          field += ch;
        } else {
          field += ch;
        }
        break;

      case State.IN_QUOTED:
        if (ch === '"') {
          // Could be a closing quote or the start of an escaped pair.
          state = State.QUOTE_IN_QUOTED;
        } else {
          field += ch;
        }
        break;

      case State.QUOTE_IN_QUOTED:
        if (ch === '"') {
          // Escaped quote — emit a literal quote and stay quoted.
          field += '"';
          state = State.IN_QUOTED;
        } else if (ch === ",") {
          finishField();
          state = State.FIELD_START;
        } else {
          // Garbage after a closing quote (e.g. `"abc"def`). Be
          // tolerant and continue as unquoted; this is the most common
          // real-world recovery.
          field += ch;
          state = State.IN_UNQUOTED;
        }
        break;
    }
  }

  // End of input. If we're still inside a quoted field, that's fatal —
  // the file is structurally malformed.
  if (state === State.IN_QUOTED) {
    throw new CsvParseError(
      "unterminated quoted field at end of input",
      rowStartLine,
      column,
    );
  }

  // Commit any remaining content as a final row. RFC 4180 allows the
  // last record to omit its line terminator.
  if (rowHasContent || row.length > 0 || field.length > 0) {
    finishField();
    finishRow();
  }

  return { rows, rowLineNumbers };
}

/**
 * Convert a parsed CsvParseResult into header-keyed objects. The first
 * row is treated as the header. Returns one object per data row, with
 * the original row's line number alongside (for error reporting).
 *
 * If a data row has more fields than the header, extra fields are
 * silently dropped. If it has fewer, missing fields are `""`.
 *
 * Header column names are trimmed and lower-cased to make the importer
 * tolerant of common spreadsheet artefacts (`"  External ID  "` →
 * `"external id"`). The schema layer is responsible for normalising
 * spaces vs underscores.
 */
export function rowsToObjects(
  parsed: CsvParseResult,
): {
  headers: string[];
  records: { line: number; values: Record<string, string> }[];
} {
  if (parsed.rows.length === 0) {
    return { headers: [], records: [] };
  }
  const rawHeaders = parsed.rows[0];
  const headers = rawHeaders.map((h) => h.trim().toLowerCase());

  const records: { line: number; values: Record<string, string> }[] = [];
  for (let i = 1; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    // Skip entirely-empty rows (a row with one empty field). Spreadsheet
    // exports often add a trailing empty row.
    if (row.length === 1 && row[0] === "") continue;

    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      values[headers[c]] = c < row.length ? row[c] : "";
    }
    records.push({ line: parsed.rowLineNumbers[i], values });
  }
  return { headers, records };
}
