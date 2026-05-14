import { describe, it, expect } from "vitest";
import {
  STATUS_LIST_MIN_BITS,
  STATUS_LIST_ENTRY_TYPE,
  STATUS_LIST_SUBJECT_TYPE,
  STATUS_LIST_CREDENTIAL_TYPE,
  allocBitstring,
  buildStatusEntry,
  buildStatusListCredential,
  createEmptyEncodedList,
  decodeBitstring,
  encodeBitstring,
  getBit,
  getStatusAtIndex,
  setBit,
  withStatusAtIndex,
} from "@/lib/vc/status-list";

// ─── Bitstring primitives ──────────────────────────────────────────────────

describe("allocBitstring", () => {
  it("allocates the right byte length", () => {
    expect(allocBitstring(8).length).toBe(1);
    expect(allocBitstring(16).length).toBe(2);
    expect(allocBitstring(STATUS_LIST_MIN_BITS).length).toBe(16384);
  });

  it("rejects sizes that aren't a positive multiple of 8", () => {
    expect(() => allocBitstring(0)).toThrow();
    expect(() => allocBitstring(-8)).toThrow();
    expect(() => allocBitstring(7)).toThrow();
    expect(() => allocBitstring(9)).toThrow();
    expect(() => allocBitstring(1.5)).toThrow();
  });

  it("returns an all-zero buffer", () => {
    const b = allocBitstring(64);
    for (const v of b) expect(v).toBe(0);
  });
});

describe("getBit / setBit", () => {
  it("uses MSB-first bit ordering per W3C spec", () => {
    // After setting bit 0, the first byte should be 0b1000_0000 = 0x80.
    const bits = allocBitstring(8);
    setBit(bits, 0, 1);
    expect(bits[0]).toBe(0x80);
    expect(getBit(bits, 0)).toBe(1);
  });

  it("setting bit 7 yields 0x01", () => {
    const bits = allocBitstring(8);
    setBit(bits, 7, 1);
    expect(bits[0]).toBe(0x01);
    expect(getBit(bits, 7)).toBe(1);
  });

  it("crosses byte boundaries correctly", () => {
    const bits = allocBitstring(16);
    setBit(bits, 8, 1);
    expect(bits[0]).toBe(0x00);
    expect(bits[1]).toBe(0x80);
    expect(getBit(bits, 8)).toBe(1);
  });

  it("setting then clearing returns 0", () => {
    const bits = allocBitstring(8);
    setBit(bits, 3, 1);
    expect(getBit(bits, 3)).toBe(1);
    setBit(bits, 3, 0);
    expect(getBit(bits, 3)).toBe(0);
    expect(bits[0]).toBe(0);
  });

  it("does not flip neighbouring bits", () => {
    const bits = allocBitstring(8);
    setBit(bits, 3, 1);
    for (let i = 0; i < 8; i++) {
      expect(getBit(bits, i)).toBe(i === 3 ? 1 : 0);
    }
  });

  it("rejects out-of-range indices", () => {
    const bits = allocBitstring(8);
    expect(() => getBit(bits, -1)).toThrow();
    expect(() => getBit(bits, 8)).toThrow();
    expect(() => setBit(bits, -1, 1)).toThrow();
    expect(() => setBit(bits, 8, 1)).toThrow();
  });
});

// ─── Gzip + base64url codec ────────────────────────────────────────────────

describe("encodeBitstring / decodeBitstring", () => {
  it("round-trips a small bitstring", async () => {
    const bits = allocBitstring(32);
    setBit(bits, 5, 1);
    setBit(bits, 17, 1);
    const encoded = await encodeBitstring(bits);
    const decoded = await decodeBitstring(encoded);
    expect(decoded.length).toBe(bits.length);
    for (let i = 0; i < bits.length; i++) {
      expect(decoded[i]).toBe(bits[i]);
    }
  });

  it("round-trips the spec-minimum size (16 KB)", async () => {
    const bits = allocBitstring(STATUS_LIST_MIN_BITS);
    setBit(bits, 0, 1);
    setBit(bits, STATUS_LIST_MIN_BITS - 1, 1);
    const encoded = await encodeBitstring(bits);
    const decoded = await decodeBitstring(encoded);
    expect(decoded.length).toBe(bits.length);
    expect(getBit(decoded, 0)).toBe(1);
    expect(getBit(decoded, STATUS_LIST_MIN_BITS - 1)).toBe(1);
    // Privacy property: a giant bitstring with two bits set compresses
    // to a small payload (gzip on a sparse bitstring should be tiny).
    expect(encoded.length).toBeLessThan(2_000);
  });

  it("encoded output is base64url (no +, /, or =)", async () => {
    const bits = allocBitstring(STATUS_LIST_MIN_BITS);
    setBit(bits, 100, 1);
    const encoded = await encodeBitstring(bits);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("decode rejects malformed input with bad_encoded_list", async () => {
    await expect(decodeBitstring("!!!not_base64url!!!")).rejects.toThrow(
      "bad_encoded_list",
    );
  });

  it("decode rejects valid base64 that is not gzip", async () => {
    // "hello world" base64url
    await expect(decodeBitstring("aGVsbG8gd29ybGQ")).rejects.toThrow(
      "bad_encoded_list",
    );
  });
});

describe("getStatusAtIndex / withStatusAtIndex / createEmptyEncodedList", () => {
  it("createEmptyEncodedList yields an all-zero list", async () => {
    const enc = await createEmptyEncodedList(64);
    for (let i = 0; i < 64; i++) {
      expect(await getStatusAtIndex(enc, i)).toBe(0);
    }
  });

  it("withStatusAtIndex flips the bit and is observable", async () => {
    const enc = await createEmptyEncodedList(64);
    const enc1 = await withStatusAtIndex(enc, 7, 1);
    expect(await getStatusAtIndex(enc1, 7)).toBe(1);
    expect(await getStatusAtIndex(enc1, 6)).toBe(0);
    expect(await getStatusAtIndex(enc1, 8)).toBe(0);
    // Original is unmodified.
    expect(await getStatusAtIndex(enc, 7)).toBe(0);
  });

  it("withStatusAtIndex unset returns to 0", async () => {
    const enc = await createEmptyEncodedList(64);
    const e1 = await withStatusAtIndex(enc, 5, 1);
    expect(await getStatusAtIndex(e1, 5)).toBe(1);
    const e2 = await withStatusAtIndex(e1, 5, 0);
    expect(await getStatusAtIndex(e2, 5)).toBe(0);
  });
});

// ─── buildStatusEntry ──────────────────────────────────────────────────────

describe("buildStatusEntry", () => {
  it("builds a well-formed entry", () => {
    const e = buildStatusEntry({
      statusListCredential: "https://issuer.example/sl/1",
      statusListIndex: 42,
    });
    expect(e.id).toBe("https://issuer.example/sl/1#42");
    expect(e.type).toBe(STATUS_LIST_ENTRY_TYPE);
    expect(e.statusPurpose).toBe("revocation");
    expect(e.statusListIndex).toBe("42"); // STRING per spec
    expect(e.statusListCredential).toBe("https://issuer.example/sl/1");
  });

  it("supports suspension purpose", () => {
    const e = buildStatusEntry({
      statusListCredential: "https://issuer.example/sl/1",
      statusListIndex: 0,
      statusPurpose: "suspension",
    });
    expect(e.statusPurpose).toBe("suspension");
  });

  it("rejects negative or non-integer indices", () => {
    expect(() =>
      buildStatusEntry({
        statusListCredential: "https://issuer.example/sl/1",
        statusListIndex: -1,
      }),
    ).toThrow();
    expect(() =>
      buildStatusEntry({
        statusListCredential: "https://issuer.example/sl/1",
        statusListIndex: 1.5,
      }),
    ).toThrow();
  });

  it("rejects non-http URLs", () => {
    expect(() =>
      buildStatusEntry({
        statusListCredential: "ftp://issuer.example/sl/1",
        statusListIndex: 0,
      }),
    ).toThrow();
  });

  it("emits index 0 (a real boundary, not an error)", () => {
    const e = buildStatusEntry({
      statusListCredential: "https://issuer.example/sl/1",
      statusListIndex: 0,
    });
    expect(e.statusListIndex).toBe("0");
    expect(e.id).toBe("https://issuer.example/sl/1#0");
  });
});

// ─── buildStatusListCredential ─────────────────────────────────────────────

describe("buildStatusListCredential", () => {
  it("emits a well-formed unsigned StatusList2021Credential", () => {
    const cred = buildStatusListCredential({
      id: "https://issuer.example/sl/1",
      issuerDid: "did:web:issuer.example",
      validFromIso: "2026-05-11T10:00:00Z",
      encodedList: "ABCD",
    });
    expect(cred["@context"][0]).toBe("https://www.w3.org/ns/credentials/v2");
    expect(cred.type).toEqual([
      "VerifiableCredential",
      STATUS_LIST_CREDENTIAL_TYPE,
    ]);
    expect(cred.id).toBe("https://issuer.example/sl/1");
    expect(cred.issuer).toBe("did:web:issuer.example");
    expect(cred.validFrom).toBe("2026-05-11T10:00:00Z");
    expect(cred.credentialSubject).toEqual({
      id: "https://issuer.example/sl/1#list",
      type: STATUS_LIST_SUBJECT_TYPE,
      statusPurpose: "revocation",
      encodedList: "ABCD",
    });
  });

  it("supports suspension purpose", () => {
    const cred = buildStatusListCredential({
      id: "https://issuer.example/sl/1",
      issuerDid: "did:web:issuer.example",
      validFromIso: "2026-05-11T10:00:00Z",
      encodedList: "ABCD",
      statusPurpose: "suspension",
    });
    expect(cred.credentialSubject.statusPurpose).toBe("suspension");
  });

  it("appends extra contexts", () => {
    const cred = buildStatusListCredential({
      id: "https://issuer.example/sl/1",
      issuerDid: "did:web:issuer.example",
      validFromIso: "2026-05-11T10:00:00Z",
      encodedList: "ABCD",
      extraContexts: ["https://w3id.org/vc/status-list/2021/v1"],
    });
    expect(cred["@context"]).toEqual([
      "https://www.w3.org/ns/credentials/v2",
      "https://w3id.org/vc/status-list/2021/v1",
    ]);
  });

  it("rejects bad inputs", () => {
    const base = {
      id: "https://issuer.example/sl/1",
      issuerDid: "did:web:issuer.example",
      validFromIso: "2026-05-11T10:00:00Z",
      encodedList: "ABCD",
    };
    expect(() =>
      buildStatusListCredential({ ...base, id: "ftp://x" }),
    ).toThrow();
    expect(() =>
      buildStatusListCredential({ ...base, issuerDid: "" }),
    ).toThrow();
    expect(() =>
      buildStatusListCredential({ ...base, validFromIso: "" }),
    ).toThrow();
    expect(() =>
      buildStatusListCredential({ ...base, encodedList: "" }),
    ).toThrow();
  });
});
