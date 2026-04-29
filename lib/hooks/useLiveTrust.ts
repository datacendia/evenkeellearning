// ─────────────────────────────────────────────────────────────────────────────
// lib/hooks/useLiveTrust.ts
//
// React hook that exposes a derived "live trust profile" from the same data
// bus that EkeChat publishes onto. The student rail meters (Focus,
// Resilience) read this, so they stay synchronised with the live trust
// badge inside the chat instead of showing fictional fixed values.
//
// IMPLEMENTATION
// ──────────────
// We can't share the IPA analyser instance across components without lifting
// state, but we *can* derive a believable trust profile from the bus events
// the chat already emits:
//
//   • Focus:      starts at 100, drops on `student.paste.blocked` (-15)
//                  and slowly recovers on every `student.submit` (+8).
//   • Resilience: starts at 50, climbs on `student.gate.cleared` (+15) and
//                  on every `student.submit` with trust ≥ 70 (+4); falls on
//                  `student.hint.requested` for tier ≥ 3 (-3).
//
// All numbers clamped to [0,100]. The formulas are documented in
// HONESTY.md §4 and reflected in the audit manifest under control CC4.1
// (Monitoring Activities).
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import { subscribe, BusEvent } from "@/lib/data-bus";

export interface LiveTrustProfile {
  focus: number;
  resilience: number;
  /** Number of bus events processed since mount; useful for tests/UI. */
  eventsSeen: number;
}

const DEFAULTS: LiveTrustProfile = { focus: 100, resilience: 50, eventsSeen: 0 };

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Returns a live trust profile that updates as the learner uses Eke in
 * any tab on this device. Safe to call from any client component.
 */
export function useLiveTrust(initial: Partial<LiveTrustProfile> = {}): LiveTrustProfile {
  const [profile, setProfile] = useState<LiveTrustProfile>({
    ...DEFAULTS,
    ...initial,
  });

  useEffect(() => {
    const off = subscribe((e: BusEvent) => {
      setProfile((prev) => {
        let { focus, resilience } = prev;
        const eventsSeen = prev.eventsSeen + 1;
        switch (e.type) {
          case "student.paste.blocked":
            focus = clamp(focus - 15);
            break;
          case "student.submit": {
            const trust = (e.payload as { trust?: number }).trust ?? 100;
            focus = clamp(focus + 8);
            if (trust >= 70) resilience = clamp(resilience + 4);
            break;
          }
          case "student.gate.cleared":
            resilience = clamp(resilience + 15);
            focus = clamp(focus + 5);
            break;
          case "student.hint.requested": {
            const tier = (e.payload as { tier?: number | null }).tier ?? 0;
            if (tier && tier >= 3) resilience = clamp(resilience - 3);
            break;
          }
          default:
            break;
        }
        return { focus, resilience, eventsSeen };
      });
    });
    return off;
  }, []);

  return profile;
}
