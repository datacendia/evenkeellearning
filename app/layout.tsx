import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { AccessibilityProvider } from "@/components/shared/AccessibilityProvider";

export const metadata: Metadata = {
  title: "Even Keel Learning — Sovereign Learning OS",
  description:
    "Centered, verified, sovereign. Even Keel Learning is the AI-resilient learning platform with the Eke Socratic engine, Cognitive Reasoning Trace, and Regulatory Absorb V2 compliance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" data-theme="paper" suppressHydrationWarning>
      <body className="antialiased">
        {/* Skip link — first focusable element so keyboard / screen-reader
            users can jump past the surface chrome straight to the main
            region. SurfaceShell renders <main id="kl-main"> as the target. */}
        <a
          href="#kl-main"
          className="kl-skip-link"
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "8px 12px",
            background: "var(--accent)",
            color: "var(--paper, #FAF7F2)",
            borderRadius: 6,
            zIndex: 200,
          }}
        >
          Skip to main content
        </a>
        <AccessibilityProvider>
          <I18nProvider>{children}</I18nProvider>
        </AccessibilityProvider>
      </body>
    </html>
  );
}
