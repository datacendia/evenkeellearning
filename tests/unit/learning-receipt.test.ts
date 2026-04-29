import { describe, it, expect, beforeEach } from "vitest";
import {
  EMPTY_CATEGORY_COUNTS,
  __resetMigrationFlagForTests,
  clearReceipts,
  getReceipt,
  importReceiptJson,
  issueReceipt,
  listReceipts,
  subscribeReceipts,
  verifyReceipt,
  type LearningReceiptPayload,
  type SignedLearningReceipt,
} from "@/lib/receipts/learning-receipt";
import { resetSessionKeyPair } from "@/lib/crypto/signing";

const STORAGE_KEY = "evenkeel.receipts.bank";
const LEGACY_STORAGE_KEY = "keellearn.receipts.bank";

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  __resetMigrationFlagForTests();
  resetSessionKeyPair();
});

const SAMPLE_PARTIAL: Omit<
  LearningReceiptPayload,
  "receiptId" | "issuedAtIso" | "schemaVersion"
> = {
  learnerInitials: "ALEX · Y10",
  problemId: "demo-001",
  problemTitle: "MATHS · today's problem",
  skillFamily: "linear-eq-1var",
  attemptsTotal: 3,
  correctOnAttempt: 3,
  hintTierMax: 2,
  categoryCounts: {
    ...EMPTY_CATEGORY_COUNTS,
    correct: 1,
    sign_flipped: 1,
    off_by_one: 1,
  },
  leitnerBox: 2,
  gateCleared: true,
  pasteAttempts: 0,
  trustScore: 88,
  practiceSessionsCount: 1,
  jurisdiction: "IE",
};

describe("learning-receipt: issue + verify", () => {
  it("issues a signed receipt with a fresh id and current timestamp", async () => {
    const before = Date.now();
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const after = Date.now();
    expect(r.id.length).toBeGreaterThan(0);
    expect(r.envelope.payload.receiptId).toBe(r.id);
    expect(r.envelope.payload.schemaVersion).toBe(1);
    const issuedTs = Date.parse(r.issuedAtIso);
    expect(issuedTs).toBeGreaterThanOrEqual(before);
    expect(issuedTs).toBeLessThanOrEqual(after);
  });

  it("the signed receipt verifies end-to-end", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const ok = await verifyReceipt(r);
    expect(ok).toBe(true);
  });

  it("verify fails after any payload mutation (tamper detection)", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const tampered: SignedLearningReceipt = {
      ...r,
      envelope: {
        ...r.envelope,
        payload: { ...r.envelope.payload, attemptsTotal: 999 },
      },
    };
    const ok = await verifyReceipt(tampered);
    expect(ok).toBe(false);
  });

  it("verify fails after signature mutation", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const orig = r.envelope.signatureB64url;
    const flipped = (orig[0] === "A" ? "B" : "A") + orig.slice(1);
    const tampered: SignedLearningReceipt = {
      ...r,
      envelope: { ...r.envelope, signatureB64url: flipped },
    };
    const ok = await verifyReceipt(tampered);
    expect(ok).toBe(false);
  });
});

describe("learning-receipt: privacy contract (payload shape)", () => {
  it("the signed payload contains exactly the schema-1 fields and nothing else", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const keys = Object.keys(r.envelope.payload).sort();
    expect(keys).toEqual(
      [
        "attemptsTotal",
        "categoryCounts",
        "correctOnAttempt",
        "gateCleared",
        "hintTierMax",
        "issuedAtIso",
        "jurisdiction",
        "learnerInitials",
        "leitnerBox",
        "pasteAttempts",
        "practiceSessionsCount",
        "problemId",
        "problemTitle",
        "receiptId",
        "schemaVersion",
        "skillFamily",
        "trustScore",
      ].sort(),
    );
  });

  it("category counts is a fixed-key object — no per-attempt detail", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const cc = r.envelope.payload.categoryCounts;
    expect(Object.keys(cc).sort()).toEqual(
      ["correct", "doubled", "halved", "off_by_one", "sign_flipped", "wrong"].sort(),
    );
    for (const v of Object.values(cc)) {
      expect(typeof v).toBe("number");
    }
  });
});

describe("learning-receipt: persistence + listing", () => {
  it("issued receipts persist to localStorage and are readable via getReceipt", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const fetched = getReceipt(r.id);
    expect(fetched?.id).toBe(r.id);
  });

  it("listReceipts returns newest first", async () => {
    const r1 = await issueReceipt(SAMPLE_PARTIAL);
    // Keep a deterministic ordering: pause briefly so the second
    // issuedAtIso is strictly after the first.
    await new Promise((res) => setTimeout(res, 10));
    const r2 = await issueReceipt(SAMPLE_PARTIAL);
    const list = listReceipts();
    expect(list[0]?.id).toBe(r2.id);
    expect(list[1]?.id).toBe(r1.id);
  });

  it("clearReceipts wipes the bank and notifies subscribers", async () => {
    const calls: number[] = [];
    const off = subscribeReceipts((entries) => calls.push(entries.length));
    await issueReceipt(SAMPLE_PARTIAL);
    clearReceipts();
    expect(calls.at(-1)).toBe(0);
    expect(listReceipts()).toHaveLength(0);
    off();
  });
});

describe("learning-receipt: import / export", () => {
  it("importReceiptJson round-trips a serialised receipt and verification still passes", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const json = JSON.stringify(r);
    clearReceipts();
    expect(getReceipt(r.id)).toBeUndefined();

    const imported = importReceiptJson(json);
    expect(imported).not.toBeNull();
    expect(imported!.id).toBe(r.id);

    const ok = await verifyReceipt(imported!);
    expect(ok).toBe(true);
    // After import, the receipt is also in the local bank.
    expect(getReceipt(r.id)?.id).toBe(r.id);
  });

  it("importReceiptJson returns null on malformed JSON", () => {
    expect(importReceiptJson("{not json")).toBeNull();
    expect(importReceiptJson('"just a string"')).toBeNull();
    expect(importReceiptJson("[]")).toBeNull();
    expect(importReceiptJson("{}")).toBeNull();
  });

  it("an imported, then mutated receipt fails verification", async () => {
    const r = await issueReceipt(SAMPLE_PARTIAL);
    const mutated = JSON.parse(JSON.stringify(r)) as SignedLearningReceipt;
    mutated.envelope.payload.trustScore = 1; // tamper after export
    clearReceipts();
    const imported = importReceiptJson(JSON.stringify(mutated));
    expect(imported).not.toBeNull();
    const ok = await verifyReceipt(imported!);
    expect(ok).toBe(false);
  });
});

describe("learning-receipt: defensive parsing + migration", () => {
  it("non-array localStorage contents are ignored", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ broken: true }));
    expect(listReceipts()).toEqual([]);
  });

  it("malformed entries are filtered out without crashing", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        // Valid-ish (no envelope content but passes the surface guard)
        { id: "ok", issuedAtIso: "2026-01-01T00:00:00Z", envelope: {} },
        // Missing id
        { issuedAtIso: "2026-01-01T00:00:00Z", envelope: {} },
        // Wrong types
        { id: 5, issuedAtIso: 5, envelope: 5 },
        // Empty id
        { id: "", issuedAtIso: "2026-01-01T00:00:00Z", envelope: {} },
      ]),
    );
    const list = listReceipts();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("ok");
  });

  it("migrates from keellearn.receipts.bank into the new key on first read", () => {
    const legacy = JSON.stringify([
      {
        id: "legacy-1",
        issuedAtIso: "2026-01-01T00:00:00Z",
        envelope: { foo: "bar" },
      },
    ]);
    window.localStorage.setItem(LEGACY_STORAGE_KEY, legacy);
    __resetMigrationFlagForTests();

    const list = listReceipts();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("legacy-1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(legacy);
    expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
