"use client";

import { useEffect, ReactNode } from "react";

export type Theme = "paper" | "sovereign";

interface ThemeProviderProps {
  theme: Theme;
  children: ReactNode;
}

export default function ThemeProvider({ theme, children }: ThemeProviderProps) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    return () => {
      // restore default when leaving
      document.documentElement.setAttribute("data-theme", "paper");
    };
  }, [theme]);

  return <>{children}</>;
}
