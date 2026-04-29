"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import BrandMark from "./BrandMark";
import ThemeProvider, { Theme } from "./ThemeProvider";
import LanguageSwitcher from "./LanguageSwitcher";
import AccessibilitySettingsPanel from "./AccessibilitySettingsPanel";
import { useT } from "@/lib/i18n/I18nProvider";

interface NavItem {
  id: string;
  label: string;
}

interface Props {
  theme: Theme;
  surfaceLabel: string;
  surfaceUser?: string;
  navItems?: NavItem[];
  activeId?: string;
  onNavChange?: (id: string) => void;
  rightSlot?: ReactNode;
  children: ReactNode;
}

export default function SurfaceShell({
  theme,
  surfaceLabel,
  surfaceUser,
  navItems = [],
  activeId,
  onNavChange,
  rightSlot,
  children,
}: Props) {
  const t = useT();
  return (
    <ThemeProvider theme={theme}>
      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
        <header
          role="banner"
          className="sticky top-0 z-40 backdrop-blur-md"
          style={{
            background:
              theme === "sovereign"
                ? "rgba(10, 14, 18, 0.88)"
                : "rgba(250, 247, 242, 0.92)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-6">
            <Link
              href="/"
              aria-label="Back to Even Keel Learning home"
              className="kl-tap-target inline-flex items-center justify-center text-sm"
              style={{ color: "var(--fg-faint)" }}
            >
              <ArrowLeft size={14} aria-hidden="true" />
            </Link>
            <BrandMark size="sm" tagline={surfaceLabel} />
            <div className="ml-auto flex items-center gap-3" data-focus-hide="true">
              {surfaceUser && (
                <span
                  className="font-mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--fg-faint)",
                  }}
                >
                  {surfaceUser}
                </span>
              )}
              {rightSlot}
              <LanguageSwitcher variant="ghost" />
              <AccessibilitySettingsPanel />
              <span className="kl-badge" aria-live="polite">
                <span className="kl-pulse-dot" aria-hidden="true" /> {t("shell.live")}
              </span>
            </div>
          </div>
          {navItems.length > 0 && (
            <nav
              role="navigation"
              aria-label="Surface sections"
              className="max-w-[1400px] mx-auto px-6 flex gap-1 overflow-x-auto"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {navItems.map((n) => {
                const active = n.id === activeId;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onNavChange?.(n.id)}
                    aria-current={active ? "page" : undefined}
                    className="px-4 py-3 text-[13px] transition relative whitespace-nowrap"
                    style={{
                      color: active ? "var(--fg)" : "var(--fg-faint)",
                      fontWeight: active ? 600 : 400,
                      minHeight: 44,
                    }}
                  >
                    {n.label}
                    {active && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          left: 16,
                          right: 16,
                          bottom: 0,
                          height: 2,
                          background: "var(--accent)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          )}
        </header>

        <main
          id="kl-main"
          role="main"
          tabIndex={-1}
          className="max-w-[1400px] mx-auto px-6 py-8 kl-fade-up"
        >
          {children}
        </main>
      </div>
    </ThemeProvider>
  );
}
