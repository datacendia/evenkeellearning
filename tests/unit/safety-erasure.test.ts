// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/safety-erasure.test.ts
//
// Pin the GDPR Article 17 erasure contract:
//   1. All learner-data keys in the project namespace are removed.
//   2. Parent-set policy keys are kept.
//   3. Foreign keys (other apps on the same origin in dev) are untouched.
//   4. The returned report accurately enumerates removed / kept keys.
//   5. SSR-safe: returns an empty report instead of throwing.
//   6. The legacy `keellearn.*` namespace is also covered, since old
//      installs may still have those keys around from the rename.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from "vitest";
import {
  eraseLearnerData,
  isParentPolicyKey,
  isProjectKey,
  PARENT_POLICY_KEYS_KEEP,
  PARENT_POLICY_PREFIXES_KEEP,
} from "@/lib/safety/erasure";

describe("safety/erasure — namespace classification", () => {
  it("identifies project keys across both prefixes", () => {
    expect(isProjectKey("evenkeel.bus.log")).toBe(true);
    expect(isProjectKey("evenkeel/safety/v1")).toBe(true);
    expect(isProjectKey("keellearn.kele.scheduler")).toBe(true);
    expect(isProjectKey("keellearn/age-band")).toBe(true);
  });

  it("rejects foreign keys that merely contain the prefix as a substring", () => {
    expect(isProjectKey("evenkeellearning.com")).toBe(false);
    expect(isProjectKey("evenkeel")).toBe(true); // exact match
    expect(isProjectKey("some-other-app.evenkeel")).toBe(false);
    expect(isProjectKey("not-ours")).toBe(false);
  });

  it("flags every entry in PARENT_POLICY_KEYS_KEEP as a keep-key", () => {
    for (const k of PARENT_POLICY_KEYS_KEEP) {
      expect(isParentPolicyKey(k)).toBe(true);
    }
  });

  it("flags any key under a keep-prefix", () => {
    for (const p of PARENT_POLICY_PREFIXES_KEEP) {
      expect(isParentPolicyKey(p + "anything")).toBe(true);
    }
  });
});

describe("safety/erasure — eraseLearnerData", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function seedAllKnownKeys(): void {
    // Learner-data keys (must all be removed).
    window.localStorage.setItem("evenkeel.bus.log", "[]");
    window.localStorage.setItem("evenkeel.eke.errorBank", "{}");
    window.localStorage.setItem("evenkeel.eke.scheduler", "{}");
    window.localStorage.setItem("evenkeel.eke.practiceMode", "{}");
    window.localStorage.setItem("evenkeel.receipts.bank", "[]");
    window.localStorage.setItem("evenkeel.passkey.enrolment.v1", "{}");
    window.localStorage.setItem("evenkeel.safeguarding.queue.v1", "[]");
    window.localStorage.setItem("evenkeel.safeguarding.tabContextId.v1", "tab-1");
    window.localStorage.setItem("evenkeel/age-band", "13-17");
    window.localStorage.setItem("evenkeel/a11y/v1", "{}");
    window.localStorage.setItem("evenkeel/safety/usage/v1", "{}");
    window.localStorage.setItem("evenkeel.student.prefs", "{}");
    // Legacy namespace.
    window.localStorage.setItem("keellearn.bus.log", "[]");
    window.localStorage.setItem("keellearn/age-band", "18-plus");
    window.localStorage.setItem("keellearn.kele.errorBank", "{}");

    // Parent-policy keys (must be kept).
    window.localStorage.setItem("evenkeel/safety/v1", "{}");
    window.localStorage.setItem("evenkeel.safeguarding.webhook.v1", "{}");
    window.localStorage.setItem("evenkeel/role-guard/teacher", "abc");
    window.localStorage.setItem("evenkeel/role-guard/compliance", "def");

    // Foreign keys (must be untouched).
    window.localStorage.setItem("some-other-app.session", "x");
    window.localStorage.setItem("preferences", "y");
  }

  it("removes every learner-data key in both namespaces", () => {
    seedAllKnownKeys();
    const report = eraseLearnerData();

    const expectRemoved = [
      "evenkeel.bus.log",
      "evenkeel.eke.errorBank",
      "evenkeel.eke.scheduler",
      "evenkeel.eke.practiceMode",
      "evenkeel.receipts.bank",
      "evenkeel.passkey.enrolment.v1",
      "evenkeel.safeguarding.queue.v1",
      "evenkeel.safeguarding.tabContextId.v1",
      "evenkeel/age-band",
      "evenkeel/a11y/v1",
      "evenkeel/safety/usage/v1",
      "evenkeel.student.prefs",
      "keellearn.bus.log",
      "keellearn/age-band",
      "keellearn.kele.errorBank",
    ];

    for (const k of expectRemoved) {
      expect(window.localStorage.getItem(k), `expected ${k} removed`).toBeNull();
      expect(report.removed).toContain(k);
    }
  });

  it("keeps parent-set policy keys", () => {
    seedAllKnownKeys();
    const report = eraseLearnerData();

    const expectKept = [
      "evenkeel/safety/v1",
      "evenkeel.safeguarding.webhook.v1",
      "evenkeel/role-guard/teacher",
      "evenkeel/role-guard/compliance",
    ];

    for (const k of expectKept) {
      expect(window.localStorage.getItem(k), `expected ${k} kept`).not.toBeNull();
      expect(report.kept).toContain(k);
    }
  });

  it("never touches foreign keys", () => {
    seedAllKnownKeys();
    eraseLearnerData();
    expect(window.localStorage.getItem("some-other-app.session")).toBe("x");
    expect(window.localStorage.getItem("preferences")).toBe("y");
  });

  it("returns an ISO 8601 timestamp", () => {
    seedAllKnownKeys();
    const report = eraseLearnerData(new Date("2026-01-15T12:34:56.000Z"));
    expect(report.at).toBe("2026-01-15T12:34:56.000Z");
  });

  it("is idempotent — a second call removes nothing because the first call already cleaned up", () => {
    seedAllKnownKeys();
    eraseLearnerData();
    const second = eraseLearnerData();
    expect(second.removed).toHaveLength(0);
    // Parent-policy keys still report as kept on every run.
    expect(second.kept.length).toBeGreaterThan(0);
  });

  it("returns an empty report when no project keys exist", () => {
    window.localStorage.setItem("foreign", "value");
    const report = eraseLearnerData();
    expect(report.removed).toHaveLength(0);
    expect(report.kept).toHaveLength(0);
    expect(window.localStorage.getItem("foreign")).toBe("value");
  });
});
