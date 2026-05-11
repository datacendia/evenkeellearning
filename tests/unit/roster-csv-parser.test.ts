// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/roster-csv-parser.test.ts
//
// Pins RFC 4180 conformance for the hand-rolled parser in
// `lib/roster/csv-parser.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  parseCsv,
  rowsToObjects,
  CsvParseError,
} from "@/lib/roster/csv-parser";

describe("parseCsv — basic", () => {
  it("parses a simple header + one row", () => {
    const r = parseCsv("a,b,c\n1,2,3");
    expect(r.rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(r.rowLineNumbers).toEqual([1, 2]);
  });

  it("accepts CRLF line endings", () => {
    const r = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(r.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("accepts LF-only line endings (UNIX exports)", () => {
    const r = parseCsv("a,b\n1,2\n3,4");
    expect(r.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("preserves trailing optional newline absence", () => {
    const a = parseCsv("a,b\n1,2");
    const b = parseCsv("a,b\n1,2\n");
    expect(a.rows).toEqual(b.rows);
  });

  it("returns empty rows for empty input", () => {
    expect(parseCsv("").rows).toEqual([]);
  });

  it("strips a UTF-8 BOM at the start", () => {
    const r = parseCsv("\uFEFFa,b\n1,2");
    expect(r.rows[0]).toEqual(["a", "b"]);
  });

  it("returns empty fields for adjacent commas", () => {
    const r = parseCsv("a,,b");
    expect(r.rows[0]).toEqual(["a", "", "b"]);
  });
});

describe("parseCsv — quoted fields", () => {
  it("parses quoted fields", () => {
    const r = parseCsv('"a","b","c"\n"1","2","3"');
    expect(r.rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("preserves commas inside quoted fields", () => {
    const r = parseCsv('a,"b,c",d');
    expect(r.rows[0]).toEqual(["a", "b,c", "d"]);
  });

  it("preserves newlines inside quoted fields", () => {
    const r = parseCsv('a,"line1\nline2",c\nnext,row,here');
    expect(r.rows).toEqual([
      ["a", "line1\nline2", "c"],
      ["next", "row", "here"],
    ]);
  });

  it("decodes escaped double quotes (\"\")", () => {
    const r = parseCsv('a,"she said ""hi""",c');
    expect(r.rows[0]).toEqual(["a", 'she said "hi"', "c"]);
  });

  it("preserves leading and trailing whitespace inside quoted fields", () => {
    const r = parseCsv('a,"  spaced  ",c');
    expect(r.rows[0]).toEqual(["a", "  spaced  ", "c"]);
  });

  it("handles a row that is entirely quoted", () => {
    const r = parseCsv('"a","b"\n"1","2"');
    expect(r.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsv — error reporting", () => {
  it("throws CsvParseError on an unterminated quoted field", () => {
    expect(() => parseCsv('a,"unterminated')).toThrowError(CsvParseError);
  });

  it("error includes the row's start line", () => {
    try {
      parseCsv('a,b,c\n1,"unterminated');
    } catch (e) {
      expect(e).toBeInstanceOf(CsvParseError);
      expect((e as CsvParseError).line).toBe(2);
    }
  });

  it("does NOT throw on ragged-row field counts (separation of concerns)", () => {
    // Three header fields, but the data rows have 2 and 4. The parser
    // returns them as parsed; the schema layer decides what to do.
    const r = parseCsv("a,b,c\n1,2\n3,4,5,6");
    expect(r.rows[1]).toEqual(["1", "2"]);
    expect(r.rows[2]).toEqual(["3", "4", "5", "6"]);
  });
});

describe("rowsToObjects", () => {
  it("uses the first row as headers and lower-cases them", () => {
    const r = parseCsv("ExternalID,Given Name\n123,Sara");
    const o = rowsToObjects(r);
    expect(o.headers).toEqual(["externalid", "given name"]);
    expect(o.records[0].values).toEqual({
      externalid: "123",
      "given name": "Sara",
    });
  });

  it("attaches the source line number to each record", () => {
    const r = parseCsv("a,b\n1,2\n3,4");
    const o = rowsToObjects(r);
    expect(o.records[0].line).toBe(2);
    expect(o.records[1].line).toBe(3);
  });

  it("skips trailing entirely-empty rows", () => {
    const r = parseCsv("a,b\n1,2\n");
    const o = rowsToObjects(r);
    expect(o.records).toHaveLength(1);
  });

  it("fills missing fields with empty strings (ragged short rows)", () => {
    const r = parseCsv("a,b,c\n1,2");
    const o = rowsToObjects(r);
    expect(o.records[0].values).toEqual({ a: "1", b: "2", c: "" });
  });

  it("drops extra fields (ragged long rows)", () => {
    const r = parseCsv("a,b\n1,2,3,4");
    const o = rowsToObjects(r);
    expect(o.records[0].values).toEqual({ a: "1", b: "2" });
  });

  it("returns empty headers + records on empty input", () => {
    const o = rowsToObjects(parseCsv(""));
    expect(o).toEqual({ headers: [], records: [] });
  });
});
