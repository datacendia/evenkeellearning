"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  DICTIONARIES,
  LOCALES,
  Locale,
  LocaleMeta,
  translate,
} from "./dictionary";

const STORAGE_KEY = "evenkeel.locale";
const LEGACY_STORAGE_KEY = "keellearn.locale";

interface I18nValue {
  locale: Locale;
  meta: LocaleMeta;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  locales: LocaleMeta[];
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Hydrate from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // One-time migration from the legacy keellearn.* namespace.
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy && !window.localStorage.getItem(STORAGE_KEY)) {
        window.localStorage.setItem(STORAGE_KEY, legacy);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      const raw = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (raw && raw in DICTIONARIES) {
        setLocaleState(raw);
      } else {
        // Try to autodetect from browser
        const nav = (navigator.language || "en").slice(0, 2).toLowerCase() as Locale;
        if (nav in DICTIONARIES) setLocaleState(nav);
      }
    } catch {}
  }, []);

  // Reflect locale into <html lang> + dir attributes for a11y / RTL
  useEffect(() => {
    if (typeof document === "undefined") return;
    const meta = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.dir;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale]
  );

  const meta = useMemo(
    () => LOCALES.find((l) => l.code === locale) ?? LOCALES[0],
    [locale]
  );

  const value: I18nValue = useMemo(
    () => ({ locale, meta, setLocale, t, locales: LOCALES }),
    [locale, meta, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback during SSR or outside provider
    return {
      locale: DEFAULT_LOCALE,
      meta: LOCALES[0],
      setLocale: () => {},
      t: (k, v) => translate(DEFAULT_LOCALE, k, v),
      locales: LOCALES,
    };
  }
  return ctx;
}

/** Convenience hook returning only the t() function */
export function useT() {
  return useI18n().t;
}
