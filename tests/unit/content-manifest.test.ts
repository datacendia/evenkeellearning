// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/content-manifest.test.ts
//
// v1.5.0 — Tests the canonical-hash + sign + verify roundtrip used by the
// content-manifest pipeline. Mirrors what scripts/build-content-manifest.mjs
// does at build time and what lib/content/registry.ts does at load time.
// If this test passes, content signed by the build script verifies in the
// browser without algorithmic drift.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { canonicaliseForHash, type SchemaContentItem } from "@/lib/content/schema";

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const VERIFY_ALG = { name: "ECDSA", hash: { name: "SHA-256" } } as const;

/** TS 5.7 BufferSource narrowing helper — mirror of lib/crypto/signing.ts:toArrayBuffer. */
function toAB(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256B64Url(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toAB(new TextEncoder().encode(s)));
  return bytesToB64Url(new Uint8Array(digest));
}

function fixtureItem(): Omit<SchemaContentItem, "approval"> {
  return {
    schemaVersion: "1.0.0",
    id: "fixture-001",
    skillFamily: "linear-eq-1var",
    subject: "maths",
    jurisdictions: ["IE"],
    difficulty: "core",
    prerequisites: [],
    specPoints: [],
    problem: "Solve 2x + 5 = 17",
    expectedAnswer: 6,
    hints: [
      { tier: 1, text: "h1" },
      { tier: 2, text: "h2" },
      { tier: 3, text: "h3" },
    ],
    explanation: "A long enough explanation for the schema to accept it.",
    misconceptions: [],
    workedExamples: [
      { id: "we1", problem: "p", workedSolution: "s", expectedAnswer: 1 },
    ],
    draft: {
      model: "test",
      provider: "test",
      promptHashB64url: "h",
      draftedAtIso: "2026-04-28T00:00:00.000Z",
      drafterVersion: "1.5.0",
    },
  };
}

describe("content/manifest sign+verify roundtrip", () => {
  it("signs an item and verifies it with the imported public key", async () => {
    const kp = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
    const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
    const publicKeyB64url = bytesToB64Url(new Uint8Array(spki));

    const item = fixtureItem();
    const digest = await sha256B64Url(canonicaliseForHash(item));
    const sig = await crypto.subtle.sign(
      ALG,
      kp.privateKey,
      toAB(new TextEncoder().encode(digest))
    );

    // Verify path (mirror of registry.ts)
    const importedKey = await crypto.subtle.importKey(
      "spki",
      toAB(b64UrlToBytes(publicKeyB64url)),
      ALG,
      true,
      ["verify"]
    );
    const expectedDigest = await sha256B64Url(canonicaliseForHash(item));
    const ok = await crypto.subtle.verify(
      VERIFY_ALG,
      importedKey,
      sig,
      toAB(new TextEncoder().encode(expectedDigest))
    );
    expect(ok).toBe(true);
  });

  it("rejects a tampered item", async () => {
    const kp = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
    const spki = await crypto.subtle.exportKey("spki", kp.publicKey);
    const publicKeyB64url = bytesToB64Url(new Uint8Array(spki));

    const item = fixtureItem();
    const digest = await sha256B64Url(canonicaliseForHash(item));
    const sig = await crypto.subtle.sign(
      ALG,
      kp.privateKey,
      toAB(new TextEncoder().encode(digest))
    );

    // Tamper: change the expected answer.
    const tamperedItem = { ...item, expectedAnswer: 999 };
    const importedKey = await crypto.subtle.importKey(
      "spki",
      toAB(b64UrlToBytes(publicKeyB64url)),
      ALG,
      true,
      ["verify"]
    );
    const tamperedDigest = await sha256B64Url(canonicaliseForHash(tamperedItem));
    const ok = await crypto.subtle.verify(
      VERIFY_ALG,
      importedKey,
      sig,
      toAB(new TextEncoder().encode(tamperedDigest))
    );
    expect(ok).toBe(false);
  });

  it("a signature from one key fails verification with a different key", async () => {
    const kpA = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
    const kpB = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);

    const item = fixtureItem();
    const digest = await sha256B64Url(canonicaliseForHash(item));
    const sigA = await crypto.subtle.sign(ALG, kpA.privateKey, toAB(new TextEncoder().encode(digest)));

    const ok = await crypto.subtle.verify(
      VERIFY_ALG,
      kpB.publicKey,
      sigA,
      toAB(new TextEncoder().encode(digest))
    );
    expect(ok).toBe(false);
  });
});
