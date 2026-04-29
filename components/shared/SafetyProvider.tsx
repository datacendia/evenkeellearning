"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/SafetyProvider.tsx
//
// Reads the persisted SafetySettings on mount and exposes the live
// settings + setters via React context. Mirrors the shape of
// AccessibilityProvider so the two sibling contexts stay idiomatic.
//
// Scope: state only. Enforcement (bedtime window, daily cap) lives in
// `SafetyGate`. This file does not know about /student or EkeChat — any
// surface can consume the context.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SAFETY_SETTINGS,
  bumpDailyUsage,
  getDailyUsage,
  getSafetySettings,
  resetSafetySettings,
  setSafetySettings,
  updateSafetySetting,
  type DailyUsage,
  type SafetySettings,
} from "@/lib/safety/settings";
import { subscribeCrisisNotifications } from "@/lib/safety/notifications";

interface SafetyContextValue {
  settings: SafetySettings;
  update: <K extends keyof SafetySettings>(key: K, value: SafetySettings[K]) => void;
  setAll: (next: SafetySettings) => void;
  reset: () => void;
  hydrated: boolean;
  /**
   * Today's accumulated foreground-minutes. Owned by the provider so there
   * is exactly one ticker per tab regardless of how many SafetyGate
   * instances mount. Consumers should treat this as read-only state.
   */
  usage: DailyUsage;
}

const SafetyContext = createContext<SafetyContextValue | null>(null);

export function SafetyProvider({ children }: { children: ReactNode }) {
  // Start from defaults to keep SSR markup stable; hydrate on mount.
  const [settings, setSettings] = useState<SafetySettings>(DEFAULT_SAFETY_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [usage, setUsage] = useState<DailyUsage>({ date: "", minutesUsed: 0 });

  useEffect(() => {
    setSettings(getSafetySettings());
    setUsage(getDailyUsage());
    setHydrated(true);
  }, []);

  // Single foreground-minutes ticker for the whole tab. Lives here (and not
  // in SafetyGate) so multiple gate instances — e.g. a parent preview iframe
  // alongside the real /student tree — can never double-count. Ticks only
  // while the document is visible, so background tabs don't burn the cap.
  useEffect(() => {
    if (!hydrated) return;
    const id = window.setInterval(() => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      setUsage(bumpDailyUsage(1));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [hydrated]);

  // Cross-tab usage sync. If another tab bumps the counter, mirror it here
  // so this tab's gate predicates evaluate against the live total instead
  // of a stale per-tab snapshot.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== "evenkeel/safety/usage/v1") return;
      setUsage(getDailyUsage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Out-of-band crisis-notification channel. The subscription lives on the
  // provider so a single browser Notification fires per tab regardless of
  // how many surfaces are mounted. The subscriber re-checks settings +
  // permission per event, so toggling the channel off takes effect on the
  // next event without a refresh.
  useEffect(() => {
    return subscribeCrisisNotifications();
  }, []);

  const update = useCallback(
    <K extends keyof SafetySettings>(key: K, value: SafetySettings[K]) => {
      const next = updateSafetySetting(key, value);
      setSettings(next);
    },
    [],
  );

  const setAll = useCallback((next: SafetySettings) => {
    setSafetySettings(next);
    setSettings(next);
  }, []);

  const reset = useCallback(() => {
    setSettings(resetSafetySettings());
  }, []);

  const value = useMemo<SafetyContextValue>(
    () => ({ settings, update, setAll, reset, hydrated, usage }),
    [settings, update, setAll, reset, hydrated, usage],
  );

  return <SafetyContext.Provider value={value}>{children}</SafetyContext.Provider>;
}

export function useSafety(): SafetyContextValue {
  const ctx = useContext(SafetyContext);
  if (!ctx) {
    throw new Error(
      "useSafety must be used within <SafetyProvider>. " +
        "It is mounted in app/layout.tsx; if you are testing a component " +
        "in isolation, wrap it in <SafetyProvider>.",
    );
  }
  return ctx;
}
