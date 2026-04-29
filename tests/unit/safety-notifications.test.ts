// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/safety-notifications.test.ts
//
// The browser-Notification crisis channel is mostly side-effect (the
// `Notification` constructor is platform-supplied and unavailable in
// happy-dom by default). The pure pieces we CAN pin without faking the
// platform are:
//
//   1. `formatCrisisNotification` — the body must contain category +
//      jurisdiction + (optional) age band, and MUST NOT include any
//      free-form text the caller might pass in.
//   2. `getNotificationPermission` is SSR-/jsdom-safe and returns
//      `"unsupported"` when no `Notification` global exists.
//   3. `requestNotificationPermission` does not throw when the platform
//      lacks the Notification API.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  formatCrisisNotification,
  getNotificationPermission,
  requestNotificationPermission,
} from "@/lib/safety/notifications";

describe("safety/notifications — formatCrisisNotification", () => {
  it("includes category + jurisdiction, omits age band when absent", () => {
    const { title, body } = formatCrisisNotification({
      crisisPatternCategory: "temporal_escalation",
      jurisdiction: "ie",
    });
    expect(title).toMatch(/Even Keel/);
    expect(body).toContain("temporal_escalation");
    expect(body).toContain("ie");
    expect(body).not.toContain("age");
  });

  it("includes the age band when present", () => {
    const { body } = formatCrisisNotification({
      crisisPatternCategory: "self_harm_signal",
      jurisdiction: "uk",
      studentAgeBand: "13-17",
    });
    expect(body).toContain("self_harm_signal");
    expect(body).toContain("uk");
    expect(body).toContain("13-17");
  });

  it("never echoes a free-form text field that callers might add", () => {
    // The function only reads the three known fields. Any extra fields a
    // misbehaving caller passes are ignored — this is the privacy contract.
    // Cast through `unknown` simulates a misbehaving call site without
    // tripping a structural-typing accept.
    const misbehaving = {
      crisisPatternCategory: "isolation_signal",
      jurisdiction: "ie",
      text: "raw learner sentence that must not appear",
      learnerName: "Alex",
    } as unknown as Parameters<typeof formatCrisisNotification>[0];
    const { body } = formatCrisisNotification(misbehaving);
    expect(body).not.toContain("raw learner sentence");
    expect(body).not.toContain("Alex");
  });

  it("falls back to safe placeholders for missing fields", () => {
    const { body } = formatCrisisNotification({});
    expect(body).toContain("unknown");
    expect(body.length).toBeGreaterThan(0);
  });
});

describe("safety/notifications — permission helpers (no platform Notification)", () => {
  it("getNotificationPermission returns 'unsupported' when Notification is absent", () => {
    // happy-dom does not expose Notification by default. The function
    // should report `"unsupported"` rather than throwing.
    expect(getNotificationPermission()).toBe("unsupported");
  });

  it("requestNotificationPermission resolves without throwing when unsupported", async () => {
    const p = await requestNotificationPermission();
    expect(p).toBe("unsupported");
  });
});
