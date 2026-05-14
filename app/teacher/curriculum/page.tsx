"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/teacher/curriculum/page.tsx
//
// v1.8.0 — Curriculum coverage dashboard (Phase A, p15-curriculum).
//
// Shows, per framework, how many spec-points the platform's authored
// content packs currently cover. Loads two static assets:
//
//   /curriculum/registry.json    compiled by scripts/build-curriculum-registry.mjs
//   /content/manifest.json       compiled by scripts/build-content-manifest.mjs
//
// then computes coverage entirely in the browser via lib/curriculum/coverage.
//
// Surface scope
// ─────────────
// Read-only. Honest about the seed registry being partial — when a framework
// shows 100% covered, that's because we've only seeded codes the packs use,
// not because the framework is small. The header note calls this out.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import SurfaceShell from "@/components/shared/SurfaceShell";
import RoleGuard from "@/components/shared/RoleGuard";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Library,
  Loader2,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import {
  computeCoverage,
  type CoverageReport,
  type FrameworkCoverage,
} from "@/lib/curriculum/coverage";
import type {
  AuthoredSpecPointRef,
  CurriculumRegistry,
} from "@/lib/curriculum/registry";

interface ManifestItem {
  id: string;
  curriculum?: { specPoints?: Array<{ framework: string; code: string }> };
}
interface ManifestPack {
  pack: string;
  items: ManifestItem[];
}
interface Manifest {
  packs: ManifestPack[];
}

function CurriculumPageInner() {
  const [registry, setRegistry] = useState<CurriculumRegistry | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeFramework, setActiveFramework] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/curriculum/registry.json").then((r) => r.json()),
      fetch("/content/manifest.json")
        .then((r) => r.json())
        .catch(() => ({ packs: [] })),
    ])
      .then(([reg, man]) => {
        if (cancelled) return;
        setRegistry(reg);
        setManifest(man);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const report: CoverageReport | null = useMemo(() => {
    if (!registry || !manifest) return null;
    const refs: Array<AuthoredSpecPointRef & { source: string }> = [];
    for (const pack of manifest.packs ?? []) {
      for (const item of pack.items ?? []) {
        for (const sp of item.curriculum?.specPoints ?? []) {
          refs.push({ framework: sp.framework, code: sp.code, source: `${pack.pack}/${item.id}` });
        }
      }
    }
    return computeCoverage(registry, refs);
  }, [registry, manifest]);

  const active: FrameworkCoverage | null = useMemo(() => {
    if (!report || !activeFramework) return null;
    return report.frameworks.find((f) => f.framework === activeFramework) ?? null;
  }, [report, activeFramework]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Failed to load curriculum registry: {loadError}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-slate-600">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading curriculum registry…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Library className="h-7 w-7 text-emerald-700" />
          <h1 className="text-2xl font-semibold">Curriculum coverage</h1>
        </div>
        <p className="text-sm text-slate-600">
          Per-framework count of spec-points covered by ≥1 authored content
          item. Generated from{" "}
          <code className="rounded bg-slate-100 px-1">/curriculum/registry.json</code>{" "}
          and{" "}
          <code className="rounded bg-slate-100 px-1">/content/manifest.json</code>{" "}
          entirely in your browser.
        </p>
        <p className="text-xs text-amber-800">
          <strong>Honest caveat:</strong> the registry is a partial seed of each
          framework — codes the packs reference plus a few extras to demonstrate
          uncovered cells. A framework showing 100% does NOT mean its
          curriculum has only N spec-points.
        </p>
      </header>

      {report.unknownRefs.length > 0 && (
        <section className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 font-semibold">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {report.unknownRefs.length} authored spec-point reference(s) are
            unknown to the registry
          </div>
          <ul className="ml-5 list-disc space-y-0.5 text-xs">
            {report.unknownRefs.slice(0, 8).map((u, i) => (
              <li key={`${u.framework}-${u.code}-${i}`}>
                <span className="font-mono">{u.framework} / {u.code}</span>{" "}
                <span className="text-amber-700">— from {u.source}</span>
              </li>
            ))}
            {report.unknownRefs.length > 8 && (
              <li>… and {report.unknownRefs.length - 8} more</li>
            )}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-slate-300 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-300 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Framework</th>
              <th className="px-4 py-2">Awarding body</th>
              <th className="px-4 py-2 text-right">Covered</th>
              <th className="px-4 py-2">Coverage</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {report.frameworks.map((f) => (
              <tr
                key={f.framework}
                className="border-b border-slate-200 last:border-b-0 hover:bg-slate-50"
              >
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-900">{f.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    {f.framework}
                  </div>
                </td>
                <td className="px-4 py-2 text-slate-700">{f.awardingBody}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {f.coveredSpecPoints} / {f.totalSpecPoints}
                </td>
                <td className="px-4 py-2">
                  <CoverageBar ratio={f.coverageRatio} />
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveFramework((cur) =>
                        cur === f.framework ? null : f.framework,
                      )
                    }
                    className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {activeFramework === f.framework ? "Hide" : "Inspect"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {active && <FrameworkDetail framework={active} />}
    </div>
  );
}

function CoverageBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const color =
    pct >= 75
      ? "bg-emerald-600"
      : pct >= 40
      ? "bg-amber-500"
      : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded bg-slate-200">
        <div
          className={`h-full ${color}`}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <span className="font-mono text-xs text-slate-600">{pct}%</span>
    </div>
  );
}

function FrameworkDetail({ framework }: { framework: FrameworkCoverage }) {
  return (
    <section className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-emerald-700" />
        <h2 className="text-base font-semibold">{framework.name}</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1">Code</th>
            <th className="py-1">Topic</th>
            <th className="py-1">Spec-point</th>
            <th className="py-1 text-right">Items</th>
            <th className="py-1 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {framework.rows.map((r) => (
            <tr key={r.code} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-3 font-mono text-xs text-slate-800">
                {r.code}
              </td>
              <td className="py-1 pr-3 text-xs text-slate-600">
                {r.topic ?? ""}
              </td>
              <td className="py-1 pr-3 text-xs text-slate-700">{r.label}</td>
              <td className="py-1 pr-3 text-right font-mono text-xs">
                {r.authoredCount}
              </td>
              <td className="py-1 text-center">
                {r.covered ? (
                  <CheckCircle2
                    className="inline h-4 w-4 text-emerald-600"
                    aria-label="covered"
                  />
                ) : (
                  <Circle
                    className="inline h-4 w-4 text-slate-300"
                    aria-label="not covered"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">
        <ChevronRight className="mr-0.5 inline h-3 w-3" />
        Each spec-point row counts how many authored items in{" "}
        <code className="rounded bg-slate-100 px-1">/content/manifest.json</code>{" "}
        carry it.
      </p>
    </section>
  );
}

export default function CurriculumPage() {
  return (
    <SurfaceShell theme="paper" surfaceLabel="Curriculum coverage">
      <RoleGuard role="teacher" roleLabel="Teacher" demoHint="mentor-alpha-42">
        <CurriculumPageInner />
      </RoleGuard>
    </SurfaceShell>
  );
}
