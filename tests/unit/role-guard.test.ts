// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/role-guard.test.ts
//
// v1.6.0 — audit H-1. The client-side sessionStorage-based guard is gone.
// The real tests now live in two places:
//   - `tests/unit/server-session.test.ts`    — HMAC + cookie + passphrase
//   - `tests/unit/role-guard-client.test.ts` — the fetch shim
//
// This file retains only the `derivePassphraseDigest` test, because the
// helper is preserved as a back-compat pure utility and a handful of
// display paths still import it. All tests of auth *behaviour* have
// moved to the two files above.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { derivePassphraseDigest } from "@/lib/auth/role-guard";

describe("auth/role-guard — back-compat digest helper", () => {
  it("is deterministic and exactly 16 hex chars", async () => {
    const a = await derivePassphraseDigest("hello");
    const b = await derivePassphraseDigest("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when input changes", async () => {
    const a = await derivePassphraseDigest("mentor-alpha-42");
    const b = await derivePassphraseDigest("mentor-alpha-43");
    expect(a).not.toBe(b);
  });
});
