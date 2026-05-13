// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-config.test.ts
//
// v1.8.0 — Tests for the LTI platform registry.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BUILTIN_LTI_PLATFORMS,
  findPlatform,
  findPlatformByIssuer,
  loadPlatforms,
  resetPlatformsCache,
} from "../../lib/lti/config";

describe("lti/config — loadPlatforms (dev fallback)", () => {
  beforeEach(() => {
    delete process.env.LTI_PLATFORMS_JSON;
    resetPlatformsCache();
  });

  it("falls back to the built-in fixture in non-production", () => {
    const platforms = loadPlatforms();
    expect(platforms.length).toBe(BUILTIN_LTI_PLATFORMS.length);
    expect(platforms.map((p) => p.id)).toContain("dev-canvas");
  });

  it("findPlatform resolves a fixture by (issuer, clientId, deploymentId)", () => {
    const p = findPlatform(
      "https://canvas.instructure.com",
      "10000000000001",
      "1:abcdef0123456789",
    );
    expect(p).not.toBeNull();
    expect(p?.id).toBe("dev-canvas");
  });

  it("findPlatform returns null for an unknown deployment", () => {
    const p = findPlatform(
      "https://canvas.instructure.com",
      "10000000000001",
      "unknown-deployment",
    );
    expect(p).toBeNull();
  });

  it("findPlatformByIssuer resolves without a deployment id", () => {
    const p = findPlatformByIssuer(
      "https://canvas.instructure.com",
      "10000000000001",
    );
    expect(p).not.toBeNull();
    expect(p?.id).toBe("dev-canvas");
  });
});

describe("lti/config — env-driven JSON config", () => {
  const originalEnv = process.env.LTI_PLATFORMS_JSON;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LTI_PLATFORMS_JSON;
    else process.env.LTI_PLATFORMS_JSON = originalEnv;
    resetPlatformsCache();
  });

  it("loads platforms from LTI_PLATFORMS_JSON", () => {
    process.env.LTI_PLATFORMS_JSON = JSON.stringify([
      {
        id: "test-platform",
        issuer: "https://lms.test",
        clientId: "client-test",
        deploymentIds: ["d-1"],
        authLoginUrl: "https://lms.test/auth",
        jwksUrl: "https://lms.test/jwks",
      },
    ]);
    resetPlatformsCache();
    const platforms = loadPlatforms();
    expect(platforms.length).toBe(1);
    expect(platforms[0].id).toBe("test-platform");
  });

  it("skips entries with missing required fields", () => {
    process.env.LTI_PLATFORMS_JSON = JSON.stringify([
      {
        id: "good",
        issuer: "https://lms.test",
        clientId: "c",
        deploymentIds: ["d"],
        authLoginUrl: "https://lms.test/auth",
        jwksUrl: "https://lms.test/jwks",
      },
      { id: "bad", issuer: "no-https" }, // missing fields
      { issuer: "https://lms.test", clientId: "c" }, // missing id
    ]);
    resetPlatformsCache();
    const platforms = loadPlatforms();
    expect(platforms.length).toBe(1);
    expect(platforms[0].id).toBe("good");
  });

  it("falls back to fixture when LTI_PLATFORMS_JSON is invalid JSON", () => {
    process.env.LTI_PLATFORMS_JSON = "{not json";
    resetPlatformsCache();
    const platforms = loadPlatforms();
    expect(platforms.length).toBeGreaterThan(0);
    expect(platforms.map((p) => p.id)).toContain("dev-canvas");
  });

  it("refuses entries with http:// (non-localhost) URLs", () => {
    process.env.LTI_PLATFORMS_JSON = JSON.stringify([
      {
        id: "insecure",
        issuer: "http://lms.test",
        clientId: "c",
        deploymentIds: ["d"],
        authLoginUrl: "http://lms.test/auth",
        jwksUrl: "http://lms.test/jwks",
      },
    ]);
    resetPlatformsCache();
    const platforms = loadPlatforms();
    expect(platforms.length).toBe(0);
  });

  it("accepts http://localhost URLs in dev", () => {
    process.env.LTI_PLATFORMS_JSON = JSON.stringify([
      {
        id: "local",
        issuer: "http://localhost:4000",
        clientId: "c",
        deploymentIds: ["d"],
        authLoginUrl: "http://localhost:4000/auth",
        jwksUrl: "http://localhost:4000/jwks",
      },
    ]);
    resetPlatformsCache();
    const platforms = loadPlatforms();
    expect(platforms.length).toBe(1);
  });
});
