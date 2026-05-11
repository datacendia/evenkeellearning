// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/role-guard-client.test.ts
//
// v1.6.0 — audit H-1. Contract tests for the browser-side shim that calls
// /api/auth/role-*. The shim should NEVER trust anything the client
// computes — it is a thin fetch wrapper, and these tests pin that
// behaviour:
//
//   1. isUnlocked/fetchRoleStatus reflect exactly what the server returns
//      (no localStorage, no sessionStorage, no client-computed digest).
//   2. tryUnlock reports success iff the server returns { ok: true }.
//   3. tryUnlock reports failure (not throws) on network error / 401.
//   4. lock() is best-effort and never throws.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRoleStatus,
  isUnlocked,
  tryUnlock,
  lock,
} from "@/lib/auth/role-guard-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("auth/role-guard-client", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchRoleStatus reflects the server response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { roles: { teacher: true, compliance: false, author: false } }),
    );
    const status = await fetchRoleStatus();
    expect(status).toEqual({ teacher: true, compliance: false, author: false });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/role-status",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("fetchRoleStatus returns all-false on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const status = await fetchRoleStatus();
    expect(status).toEqual({ teacher: false, compliance: false, author: false });
  });

  it("fetchRoleStatus returns all-false on non-2xx", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { error: "kaboom" }));
    const status = await fetchRoleStatus();
    expect(status).toEqual({ teacher: false, compliance: false, author: false });
  });

  it("isUnlocked is a view over fetchRoleStatus", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { roles: { teacher: true, compliance: false, author: false } }),
    );
    expect(await isUnlocked("teacher")).toBe(true);
  });

  it("tryUnlock reports true iff the server says ok", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    expect(await tryUnlock("teacher", "correct")).toBe(true);
  });

  it("tryUnlock reports false on 401", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { ok: false }));
    expect(await tryUnlock("teacher", "wrong")).toBe(false);
  });

  it("tryUnlock reports false on network error (does not throw)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    await expect(tryUnlock("teacher", "anything")).resolves.toBe(false);
  });

  it("tryUnlock POSTs the role and passphrase as JSON", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await tryUnlock("compliance", "officer-alpha-42");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/role-verify",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ role: "compliance", passphrase: "officer-alpha-42" }),
      }),
    );
  });

  it("lock() is best-effort and does not throw on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    await expect(lock("teacher")).resolves.toBeUndefined();
  });
});
