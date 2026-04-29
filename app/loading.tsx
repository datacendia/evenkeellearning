// ─────────────────────────────────────────────────────────────────────────────
// app/loading.tsx
//
// Root-level loading skeleton. Next.js App Router automatically renders this
// during route transitions and during server-side data resolution for any
// route that does not declare its own `loading.tsx`.
//
// Design intent: convey "the room is being prepared" rather than "we are
// fetching." We render a soft, breathing brand mark and three placeholder
// cards. No spinner, no progress bar — those imply work that is happening
// remotely; here, transitions are local.
// ─────────────────────────────────────────────────────────────────────────────

import BrandMark from "@/components/shared/BrandMark";

export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      style={{
        minHeight: "100vh",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
      className="px-6 py-12"
    >
      <div className="max-w-[1280px] mx-auto">
        {/* Header lockup — the only element we render at full opacity. */}
        <div className="flex items-center gap-3 mb-12 opacity-90">
          <BrandMark size="md" tagline="Preparing the room…" />
        </div>

        {/* Three placeholder cards — the "card" pattern is shared across surfaces,
            so this is a believable layout for any route the user is heading to. */}
        <div className="grid md:grid-cols-3 gap-5">
          <Skeleton lines={6} />
          <Skeleton lines={4} />
          <Skeleton lines={5} />
        </div>
      </div>
    </main>
  );
}

/** Single shimmering placeholder card with `lines` text rows. */
function Skeleton({ lines }: { lines: number }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--paper-deep, var(--bg-alt))",
        border: "1px solid var(--rule, var(--border))",
        minHeight: 200,
      }}
    >
      <Bar w="40%" />
      <div style={{ height: 18 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <Bar w={`${60 + ((i * 17) % 35)}%`} />
        </div>
      ))}
    </div>
  );
}

/** A single horizontal pulsing bar at the given width. */
function Bar({ w }: { w: string }) {
  return (
    <div
      className="kl-shimmer"
      style={{
        height: 9,
        width: w,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, var(--rule, var(--border)) 0%, var(--paper, var(--bg)) 50%, var(--rule, var(--border)) 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}
