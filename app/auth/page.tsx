"use client";

import Link from "next/link";
import { useState } from "react";
import { GraduationCap, FileText, HeartHandshake, Shield, Briefcase, Hammer, Fingerprint, KeyRound } from "lucide-react";
import BrandMark from "@/components/shared/BrandMark";
import LanguageSwitcher from "@/components/shared/LanguageSwitcher";
import { useT } from "@/lib/i18n/I18nProvider";

const ROLES = [
  { id: "student",    nameKey: "role.student",    icon: GraduationCap, href: "/student"    },
  { id: "adult",      nameKey: "role.adult",      icon: Briefcase,     href: "/adult"      },
  { id: "trades",     nameKey: "role.trades",     icon: Hammer,        href: "/trades"     },
  { id: "parent",     nameKey: "role.parent",     icon: HeartHandshake,href: "/parent"     },
  { id: "teacher",    nameKey: "role.teacher",    icon: FileText,      href: "/teacher"    },
  { id: "compliance", nameKey: "role.compliance", icon: Shield,        href: "/compliance" },
];

export default function AuthPage() {
  const t = useT();
  const [step, setStep] = useState<"pick" | "verify">("pick");
  const [chosen, setChosen] = useState<typeof ROLES[number] | null>(null);

  return (
    <main
      style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)" }}
      className="flex items-center justify-center p-6"
    >
      <div className="max-w-[640px] w-full">
        <div className="mb-10 flex items-center justify-between">
          <BrandMark size="lg" tagline={t("brand.signin")} />
          <LanguageSwitcher />
        </div>

        {step === "pick" && (
          <div className="kl-card kl-fade-up">
            <h1 className="font-serif text-3xl mb-2">{t("auth.title")}</h1>
            <p style={{ color: "var(--fg-dim)" }} className="mb-6">
              {t("auth.subtitle")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setChosen(r);
                      setStep("verify");
                    }}
                    className="p-4 rounded-xl text-left transition flex flex-col gap-2"
                    style={{
                      background: "var(--bg-deep)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Icon size={20} style={{ color: "var(--accent)" }} />
                    <span className="font-semibold">{t(r.nameKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === "verify" && chosen && (
          <div className="kl-card kl-fade-up text-center">
            <div className="mb-6 flex justify-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                <KeyRound size={28} />
              </div>
            </div>
            <h2 className="font-serif text-2xl mb-2">
              {t("auth.verifying")} ({t(chosen.nameKey)})
            </h2>
            <p style={{ color: "var(--fg-dim)" }} className="mb-6">
              {t("auth.verifyNote")}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setStep("pick")}
                className="px-4 py-2 rounded-md text-sm"
                style={{ background: "var(--bg-deep)", border: "1px solid var(--border)" }}
              >
                {t("common.cancel")}
              </button>
              <Link
                href={chosen.href}
                className="px-4 py-2 rounded-md text-sm"
                style={{ background: "var(--accent)", color: "var(--paper)" }}
              >
                {t("common.continue")}
              </Link>
            </div>
          </div>
        )}
        <p
          className="text-center font-mono mt-6"
          style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--slate-500)" }}
        >
          <Fingerprint size={11} className="inline mr-1" /> Zero biometric data · zero advertising · GDPR-K aligned
        </p>
      </div>
    </main>
  );
}
