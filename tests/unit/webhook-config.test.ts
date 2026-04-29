// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/webhook-config.test.ts
//
// Pins SAFEGUARDING.md §1.8 webhook-endpoint validation:
//   • https:// hosts pass.
//   • http://localhost / 127.0.0.1 pass (dev exception).
//   • http to public hosts is REJECTED (would leak the signed envelope).
//   • file: / javascript: / data: / ftp: are REJECTED.
//   • Empty / malformed inputs return a structured error, never a throw.
//   • Round-trip persistence works; corrupt storage returns null.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearWebhookEndpoint,
  getWebhookEndpoint,
  setWebhookEndpoint,
  validateWebhookEndpoint,
} from "@/lib/safeguarding/webhook-config";

const STORAGE_KEY = "evenkeel.safeguarding.webhook.v1";

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

describe("validateWebhookEndpoint", () => {
  it("accepts https URLs", () => {
    expect(validateWebhookEndpoint("https://safeguarding.school.example/ingest").ok)
      .toBe(true);
  });

  it("accepts http://localhost and http://127.0.0.1 for development", () => {
    expect(validateWebhookEndpoint("http://localhost:8080/hook").ok).toBe(true);
    expect(validateWebhookEndpoint("http://127.0.0.1:9000/").ok).toBe(true);
  });

  it("rejects http URLs to public hosts", () => {
    const v = validateWebhookEndpoint("http://leak.example.com/hook");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason.toLowerCase()).toContain("https");
  });

  it("rejects non-http(s) schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/plain,abc",
      "ftp://example.com/hook",
    ]) {
      expect(validateWebhookEndpoint(url).ok, `rejects ${url}`).toBe(false);
    }
  });

  it("rejects empty / whitespace / malformed input without throwing", () => {
    for (const bad of ["", "   ", "not a url", "https://"]) {
      const v = validateWebhookEndpoint(bad);
      expect(v.ok, `rejects ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("getWebhookEndpoint / setWebhookEndpoint persistence", () => {
  it("returns null when nothing is set", () => {
    expect(getWebhookEndpoint()).toBeNull();
  });

  it("round-trips a validated URL", () => {
    const v = setWebhookEndpoint("https://hook.example.test/ingest");
    expect(v.ok).toBe(true);
    expect(getWebhookEndpoint()).toBe("https://hook.example.test/ingest");
  });

  it("does not persist an invalid URL", () => {
    setWebhookEndpoint("javascript:alert(1)");
    expect(getWebhookEndpoint()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearWebhookEndpoint removes the value", () => {
    setWebhookEndpoint("https://x.example/y");
    clearWebhookEndpoint();
    expect(getWebhookEndpoint()).toBeNull();
  });

  it("returns null on corrupted storage rather than throwing", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    expect(getWebhookEndpoint()).toBeNull();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: 42 }));
    expect(getWebhookEndpoint()).toBeNull();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: "ftp://x" }));
    expect(getWebhookEndpoint()).toBeNull();
  });
});
