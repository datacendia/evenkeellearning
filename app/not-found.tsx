// ─────────────────────────────────────────────────────────────────────────────
// app/not-found.tsx
//
// Next.js App-Router 404 page. Rendered automatically when a route does not
// match any folder under `app/` and no nearer `not-found.tsx` overrides it.
//
// Visual language matches the landing page (Paper theme) so the brand voice
// is preserved when a deep link breaks. We deliberately do NOT log the
// requested path — that would be the easiest way to leak student URLs into
// console output.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import Link from "next/link";
import { Compass, ArrowLeft } from "lucide-react";
import BrandMark from "@/components/shared/BrandMark";

/** Exhaustive list of public surfaces, used to suggest where the user meant to go. */
const SURFACES = [
  { href: "/",           label: "Landing"    },
  { href: "/student",    label: "Student"    },
  { href: "/teacher",    label: "Teacher"    },
  { href: "/parent",     label: "Parent"     },
  { href: "/compliance", label: "Compliance" },
  { href: "/adult",      label: "Adult"      },
  { href: "/trades",     label: "Trades"     },
  { href: "/auth",       label: "Sign-in"    },
];

export default function NotFound() {
  return (
    <main
      style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)" }}
      className="flex items-center justify-center px-6 py-12"
    >
      <div className="max-w-[640px] w-full text-center">
        <div className="flex justify-center mb-10">
          <BrandMark size="lg" tagline="Off the trail" />
        </div>

        <Compass
          size={42}
          style={{ color: "var(--teal-700)", margin: "0 auto 18px" }}
        />

        <p
          className="font-mono mb-3"
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            color: "var(--slate-500)",
            textTransform: "uppercase",
          }}
        >
          404 · Surface not found
        </p>

        <h1
          className="font-serif"
          style={{
            fontWeight: 350,
            fontSize: "clamp(36px, 5vw, 56px)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            marginBottom: 18,
          }}
        >
          That route is unmapped.
        </h1>

        <p
          className="text-base mb-10"
          style={{ color: "var(--slate-700)", lineHeight: 1.55 }}
        >
          The link you followed does not point to any Even Keel Learning surface. No data
          was logged. Pick a surface below or head back home.
        </p>

        <div className="flex flex-wrap gap-2 justify-center mb-8">
          {SURFACES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="px-3.5 py-1.5 rounded-full text-[12px]"
              style={{
                background: "var(--paper-deep)",
                color: "var(--slate-700)",
                border: "1px solid var(--rule)",
              }}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px]"
          style={{ background: "var(--ink)", color: "var(--paper)" }}
        >
          <ArrowLeft size={14} /> Back to landing
        </Link>
      </div>
    </main>
  );
}
