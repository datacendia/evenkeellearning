"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/shared/AccessibilityProvider.tsx
//
// Reads the persisted A11ySettings on mount, applies them as
// `data-a11y-*` attributes on <html>, and exposes the live settings + a
// setter via React context. Every surface mounts under this provider via
// the root layout, so any component can read or update settings without
// prop-drilling.
//
// The provider also listens for system-level `prefers-reduced-motion` and
// `prefers-contrast` media-query changes and re-applies attributes so the
// matching CSS rules in globals.css can react. CSS already respects
// `@media (prefers-reduced-motion: reduce)` directly; this provider does
// not override the OS preference, only honours it.
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
  A11ySettings,
  DEFAULT_A11Y_SETTINGS,
  applyA11ySettingsToDocument,
  getA11ySettings,
  resetA11ySettings,
  setA11ySettings,
  updateA11ySetting,
} from "@/lib/a11y/settings";

interface A11yContextValue {
  settings: A11ySettings;
  /** Update a single setting and persist. */
  update: <K extends keyof A11ySettings>(key: K, value: A11ySettings[K]) => void;
  /** Replace the whole settings object and persist. */
  setAll: (next: A11ySettings) => void;
  /** Restore defaults. */
  reset: () => void;
  /** True after the provider has hydrated client-side. */
  hydrated: boolean;
}

const A11yContext = createContext<A11yContextValue | null>(null);

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  // Start from defaults to keep SSR markup stable; hydrate on mount.
  const [settings, setSettings] = useState<A11ySettings>(DEFAULT_A11Y_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = getA11ySettings();
    setSettings(initial);
    applyA11ySettingsToDocument(initial);
    setHydrated(true);
  }, []);

  const update = useCallback(<K extends keyof A11ySettings>(key: K, value: A11ySettings[K]) => {
    const next = updateA11ySetting(key, value);
    setSettings(next);
    applyA11ySettingsToDocument(next);
  }, []);

  const setAll = useCallback((next: A11ySettings) => {
    setA11ySettings(next);
    setSettings(next);
    applyA11ySettingsToDocument(next);
  }, []);

  const reset = useCallback(() => {
    const defaults = resetA11ySettings();
    setSettings(defaults);
    applyA11ySettingsToDocument(defaults);
  }, []);

  const value = useMemo<A11yContextValue>(
    () => ({ settings, update, setAll, reset, hydrated }),
    [settings, update, setAll, reset, hydrated],
  );

  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>;
}

/**
 * Hook for consumers. Returns a stable context value that updates whenever
 * settings change. Throws a clear error if used outside the provider so
 * misconfiguration is caught at render time, not silently.
 */
export function useA11y(): A11yContextValue {
  const ctx = useContext(A11yContext);
  if (!ctx) {
    throw new Error(
      "useA11y must be used within <AccessibilityProvider>. " +
        "It is mounted in app/layout.tsx; if you are testing a component " +
        "in isolation, wrap it in <AccessibilityProvider>.",
    );
  }
  return ctx;
}
