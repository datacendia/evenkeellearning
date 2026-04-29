"use client";

import Link from "next/link";
import { ArrowRight, Shield, FileText, GraduationCap, Briefcase, Hammer, HeartHandshake, Sparkles } from "lucide-react";
import BrandMark from "@/components/shared/BrandMark";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useT } from "@/lib/i18n/I18nProvider";

const AUDIENCES = [
  { id: "student",    nameKey: "role.student",    descKey: "landing.aud.student.desc",    num: "01", icon: GraduationCap, href: "/student"    },
  { id: "adult",      nameKey: "role.adult",      descKey: "landing.aud.adult.desc",      num: "02", icon: Briefcase,     href: "/adult"      },
  { id: "trades",     nameKey: "role.tradesLong", descKey: "landing.aud.trades.desc",     num: "03", icon: Hammer,        href: "/trades"     },
  { id: "parent",     nameKey: "role.parent",     descKey: "landing.aud.parent.desc",     num: "04", icon: HeartHandshake,href: "/parent"     },
  { id: "teacher",    nameKey: "role.teacher",    descKey: "landing.aud.teacher.desc",    num: "05", icon: FileText,      href: "/teacher"    },
  { id: "compliance", nameKey: "role.compliance", descKey: "landing.aud.compliance.desc", num: "06", icon: Shield,        href: "/compliance" },
];

export default function Home() {
  const t = useT();
  const STATS = [
    { num: "30+",  label: t("landing.stat.jurisdictions") },
    { num: "0",    label: t("landing.stat.biometrics") },
    { num: "100%", label: t("landing.stat.crt") },
    { num: "12wk", label: t("landing.stat.pilot") },
  ];
  return (
    <main style={{ background: "var(--paper)", color: "var(--ink)", minHeight: "100vh" }}>
      {/* nav */}
      <header
        className="sticky top-0 z-50 backdrop-blur-md"
        style={{
          background: "rgba(250, 247, 242, 0.92)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div className="max-w-[1280px] mx-auto px-8 py-3.5 flex items-center gap-8">
          <BrandMark size="md" tagline={t("brand.tagline")} />
          <nav className="ml-auto flex gap-1 flex-wrap items-center">
            {AUDIENCES.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="px-3.5 py-2 rounded-full text-[13px] transition"
                style={{ color: "var(--slate-700)" }}
              >
                {t(a.nameKey)}
              </Link>
            ))}
            <LanguageSwitcher />
            <Link
              href="/auth"
              className="px-4 py-2 rounded-full text-[13px] ml-2"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              {t("brand.signin")}
            </Link>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden px-8" style={{ padding: "80px 32px 100px" }}>
        <div
          className="absolute pointer-events-none"
          style={{
            top: -100,
            right: -100,
            width: 500,
            height: 500,
            borderRadius: "50%",
            background: "var(--teal-100)",
            filter: "blur(60px)",
            opacity: 0.4,
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: -80,
            left: "10%",
            width: 380,
            height: 380,
            borderRadius: "50%",
            background: "var(--purple-50)",
            filter: "blur(60px)",
            opacity: 0.45,
          }}
        />
        <div className="max-w-[1100px] mx-auto relative z-10">
          <span
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-mono uppercase tracking-wider mb-7"
            style={{
              background: "var(--paper-deep)",
              color: "var(--slate-700)",
            }}
          >
            <span className="kl-pulse-dot" />
            <Sparkles size={12} /> {t("landing.pilotBadge")}
          </span>
          <h1
            className="font-serif"
            style={{
              fontWeight: 350,
              fontSize: "clamp(48px, 7vw, 84px)",
              lineHeight: 0.96,
              letterSpacing: "-0.035em",
              maxWidth: 920,
              marginBottom: 24,
              fontVariationSettings: "'opsz' 144, 'SOFT' 30",
            }}
          >
            {t("landing.headlinePre")}{" "}
            <em style={{ color: "var(--teal-700)", fontStyle: "italic", fontWeight: 400 }}>
              {t("landing.headlineEm")}
            </em>{" "}
            {t("landing.headlinePost")}
          </h1>
          <p
            className="text-lg"
            style={{ color: "var(--slate-700)", maxWidth: 720, lineHeight: 1.55, marginBottom: 48 }}
          >
            {t("landing.subhead")}
          </p>
          <div
            className="grid grid-cols-2 md:grid-cols-4 mb-16"
            style={{
              gap: 1,
              background: "var(--rule)",
              border: "1px solid var(--rule)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {STATS.map((s) => (
              <div key={s.label} style={{ background: "var(--paper)", padding: "22px 22px" }}>
                <div className="font-serif" style={{ fontSize: 34, fontWeight: 400, letterSpacing: "-0.02em" }}>
                  {s.num}
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--slate-500)",
                    marginTop: 4,
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* audience grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {AUDIENCES.map((a) => {
              const Icon = a.icon;
              return (
                <Link
                  key={a.id}
                  href={a.href}
                  className="kl-card group transition-all"
                  style={{
                    cursor: "pointer",
                    position: "relative",
                  }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <span
                      className="font-mono"
                      style={{ fontSize: 11, color: "var(--slate-500)", letterSpacing: "0.04em" }}
                    >
                      {a.num}
                    </span>
                    <Icon size={18} style={{ color: "var(--teal)" }} />
                  </div>
                  <h3
                    className="font-serif"
                    style={{ fontSize: 22, fontWeight: 400, letterSpacing: "-0.015em", marginBottom: 6 }}
                  >
                    {t(a.nameKey)}
                  </h3>
                  <p style={{ fontSize: 14, color: "var(--slate-700)", lineHeight: 1.5, marginBottom: 16 }}>
                    {t(a.descKey)}
                  </p>
                  <span
                    className="inline-flex items-center gap-1.5 text-[13px]"
                    style={{ color: "var(--teal)", fontWeight: 500 }}
                  >
                    {t("landing.openSurface")} <ArrowRight size={14} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer
        className="px-8 py-10 mt-12"
        style={{ borderTop: "1px solid var(--rule)" }}
      >
        <div className="max-w-[1280px] mx-auto flex flex-wrap gap-6 items-center justify-between">
          <div
            className="font-mono"
            style={{ fontSize: 11, color: "var(--slate-500)", letterSpacing: "0.04em" }}
          >
            Even Keel Learning © 2026 · {t("footer.tagline")}
          </div>
          <div className="flex gap-6 text-[12px]" style={{ color: "var(--slate-700)" }}>
            <span>{t("footer.noBio")}</span>
            <span>{t("footer.noAds")}</span>
            <span>GDPR-K · COPPA · DPDP · Ley 29733</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
