"use client";

import { useT } from "@/lib/i18n/I18nProvider";

interface Curriculum {
  id: string;
  label: string;
  jurisdiction: string;
}

const CURRICULA: Curriculum[] = [
  { id: "ie-jc", label: "IE — Junior Cert", jurisdiction: "IE" },
  { id: "ie-lc", label: "IE — Leaving Cert", jurisdiction: "IE" },
  { id: "uk-gcse", label: "UK — GCSE", jurisdiction: "GB" },
  { id: "uk-alevel", label: "UK — A-Level", jurisdiction: "GB" },
  { id: "us-common", label: "US — Common Core", jurisdiction: "US" },
  { id: "pe-cn", label: "PE — Currículo Nacional", jurisdiction: "PE" },
  { id: "br-bncc", label: "BR — BNCC", jurisdiction: "BR" },
  { id: "in-cbse", label: "IN — CBSE", jurisdiction: "IN" },
];

interface Props {
  value: string;
  onChange: (id: string, jurisdiction: string) => void;
}

export default function CurriculumPicker({ value, onChange }: Props) {
  const t = useT();
  return (
    <div>
      <p
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--fg-faint)",
          marginBottom: 10,
        }}
      >
        {t("common.curriculum")}
      </p>
      <div className="flex flex-col gap-1.5">
        {CURRICULA.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              onClick={() => onChange(c.id, c.jurisdiction)}
              className="text-left px-3 py-2 rounded-lg text-sm transition"
              style={{
                background: active ? "var(--accent)" : "var(--bg-deep)",
                color: active ? "var(--paper)" : "var(--fg)",
                border: "1px solid",
                borderColor: active ? "var(--accent)" : "transparent",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
