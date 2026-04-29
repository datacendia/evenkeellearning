import { describe, it, expect, beforeEach } from "vitest";
import { publish, subscribe, recentEvents, clearHistory } from "@/lib/data-bus";

describe("data-bus", () => {
  beforeEach(() => clearHistory());

  it("delivers events to local subscribers", () => {
    const seen: unknown[] = [];
    const off = subscribe((e) => seen.push(e));
    publish("system.ping", { reason: "test" }, "test");
    expect(seen).toHaveLength(1);
    off();
  });

  it("retains recent events in the ring buffer", () => {
    publish("student.gate.cleared", { subject: "maths" }, "test");
    const recent = recentEvents();
    expect(recent.at(-1)?.type).toBe("student.gate.cleared");
  });

  it("unsubscribe stops further deliveries", () => {
    const seen: unknown[] = [];
    const off = subscribe((e) => seen.push(e));
    off();
    publish("system.ping", { reason: "after-off" }, "test");
    expect(seen).toHaveLength(0);
  });

  it("publish returns a hydrated event with id and ts", () => {
    const e = publish("system.ping", { reason: "shape" }, "test");
    expect(e.id).toMatch(/.+/);
    expect(typeof e.ts).toBe("number");
    expect(e.source).toBe("test");
  });

  it("a misbehaving listener does not poison the channel", () => {
    const seen: unknown[] = [];
    subscribe(() => {
      throw new Error("boom");
    });
    subscribe((e) => seen.push(e));
    publish("system.ping", { reason: "tolerance" }, "test");
    expect(seen).toHaveLength(1);
  });
});
