"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface Props {
  variant?: "chip" | "ghost";
}

export default function LanguageSwitcher({ variant = "chip" }: Props) {
  const { locale, setLocale, locales, meta, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const triggerStyle =
    variant === "ghost"
      ? { background: "transparent", color: "var(--fg)" }
      : { background: "var(--bg-deep)", color: "var(--fg)", border: "1px solid var(--border)" };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full px-3 py-1.5 text-xs flex items-center gap-1.5 transition"
        style={triggerStyle}
        aria-label={t("common.language")}
        title={t("common.language")}
      >
        <Globe size={13} />
        <span style={{ fontWeight: 500 }}>{meta.label}</span>
      </button>
      {open && (
        <div
          className="kl-fade-up"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 180,
            background: "var(--bg-alt)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 6,
            zIndex: 60,
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          }}
        >
          <p
            className="font-mono px-2.5 py-1.5"
            style={{
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--fg-faint)",
            }}
          >
            {t("common.language")}
          </p>
          <div className="space-y-0.5">
            {locales.map((l) => {
              const active = l.code === locale;
              return (
                <button
                  key={l.code}
                  onClick={() => {
                    setLocale(l.code);
                    setOpen(false);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-sm transition text-left"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--fg)",
                  }}
                >
                  <span className="flex flex-col leading-tight">
                    <span style={{ fontWeight: active ? 600 : 400 }}>{l.label}</span>
                    <span
                      className="font-mono"
                      style={{ fontSize: 9, color: "var(--fg-faint)", letterSpacing: "0.04em" }}
                    >
                      {l.english.toLowerCase()}
                    </span>
                  </span>
                  {active && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
