"use client";

import Link from "next/link";

interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  href?: string;
  showWordmark?: boolean;
  tagline?: string;
}

export default function BrandMark({
  size = "md",
  href = "/",
  showWordmark = true,
  tagline,
}: BrandMarkProps) {
  const dim = size === "sm" ? 26 : size === "lg" ? 40 : 32;
  const fontSize = size === "sm" ? 18 : size === "lg" ? 28 : 22;

  const inner = (
    <span className="inline-flex items-center gap-3">
      <span
        className="kl-mark"
        style={{ width: dim, height: dim, fontSize: dim * 0.55 }}
      >
        K
      </span>
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className="font-serif"
            style={{
              fontSize,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: "var(--fg)",
            }}
          >
            Even Keel Learning
          </span>
          {tagline && (
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--accent)",
                marginTop: 4,
              }}
            >
              {tagline}
            </span>
          )}
        </span>
      )}
    </span>
  );

  return href ? (
    <Link href={href} className="no-underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}
