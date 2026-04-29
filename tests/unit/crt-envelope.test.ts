// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/crt-envelope.test.ts
//
// Pin the per-submission CRT envelope contract that EkeChat builds at submit
// time. We don't render the React component here — the focus is on the
// shape + integrity guarantees of the signed envelope:
//
//   1. The envelope payload contains a SHA-256 digest of the learner's
//      text and never the plaintext.
//   2. `signPayload` produces a verifiable envelope that round-trips
//      through `verifyEnvelope` with no tampering.
//   3. Mutating the digest field invalidates the envelope.
//   4. Mutating any other field invalidates the envelope.
//   5. The envelope is byte-stable for byte-identical input — the digest
//      and signature don't drift on re-sign of the same payload (digest
//      stable; signature ECDSA is non-deterministic, but the digest is
//      deterministic and that's the integrity anchor).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  contentDigest,
  resetSessionKeyPair,
  signPayload,
  verifyEnvelope,
} from "@/lib/crypto/signing";

/** Same helper EkeChat uses; kept local so the test pins the wire format. */
async function sha256B64url(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let bin = "";
  const arr = new Uint8Array(digest);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface SubmissionCRT {
  version: 1;
  kind: "submission-crt";
  submittedAtIso: string;
  problemTitle?: string;
  problemId?: string;
  jurisdiction?: string;
  studentAgeBand?: string;
  inputDigestB64url: string;
  inputChars: number;
  trust: number;
  mimicryPct: number;
}

function buildCRT(text: string, digest: string): SubmissionCRT {
  return {
    version: 1,
    kind: "submission-crt",
    submittedAtIso: "2026-04-29T12:00:00.000Z",
    problemTitle: "Demo problem",
    problemId: "demo-001",
    jurisdiction: "IE",
    studentAgeBand: "Y10",
    inputDigestB64url: digest,
    inputChars: text.length,
    trust: 72,
    mimicryPct: 0,
  };
}

describe("CRT submission envelope — integrity contract", () => {
  it("payload contains a digest of the input, not the input itself", async () => {
    const text = "I think x = 6 because 2*6 + 5 = 17.";
    const digest = await sha256B64url(text);
    const crt = buildCRT(text, digest);

    const env = await signPayload(crt);

    // Plaintext appears nowhere in the envelope.
    const serialised = JSON.stringify(env);
    expect(serialised.includes(text)).toBe(false);
    expect(serialised.includes("x = 6")).toBe(false);
    // The digest IS in the payload.
    expect(env.payload.inputDigestB64url).toBe(digest);
  });

  it("round-trips through verifyEnvelope with no tampering", async () => {
    resetSessionKeyPair();
    const text = "trial answer";
    const digest = await sha256B64url(text);
    const env = await signPayload(buildCRT(text, digest));

    const ok = await verifyEnvelope(env);
    expect(ok).toBe(true);
  });

  it("mutating the inputDigest invalidates the envelope", async () => {
    resetSessionKeyPair();
    const text = "answer A";
    const digestA = await sha256B64url(text);
    const env = await signPayload(buildCRT(text, digestA));

    // Swap in a digest of a different string.
    const digestB = await sha256B64url("answer B");
    const tampered = {
      ...env,
      payload: { ...env.payload, inputDigestB64url: digestB },
    };
    expect(await verifyEnvelope(tampered)).toBe(false);
  });

  it("mutating a non-digest field also invalidates the envelope", async () => {
    resetSessionKeyPair();
    const text = "x";
    const digest = await sha256B64url(text);
    const env = await signPayload(buildCRT(text, digest));

    const tampered = {
      ...env,
      payload: { ...env.payload, jurisdiction: "ZZ" },
    };
    expect(await verifyEnvelope(tampered)).toBe(false);
  });

  it("the input digest is stable across calls (deterministic SHA-256)", async () => {
    const text = "stable text 🌊 with unicode";
    const a = await sha256B64url(text);
    const b = await sha256B64url(text);
    expect(a).toBe(b);
  });

  it("the envelope contentDigest is the digest of the canonical payload (covers every field)", async () => {
    resetSessionKeyPair();
    const text = "anything";
    const digest = await sha256B64url(text);
    const crt = buildCRT(text, digest);

    const env = await signPayload(crt);
    const recomputed = await contentDigest(crt);
    expect(env.contentDigestB64url).toBe(recomputed);
  });
});
