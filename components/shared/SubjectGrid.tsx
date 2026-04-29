"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";

interface Subject {
  id: string;
  label: string;
  icon: string;
  group: string;
}

// Global curriculum coverage — UK GCSE/A-Level, Irish Junior/Leaving Cert,
// US Common Core/AP, Peruvian Currículo Nacional, Brazilian BNCC, Indian CBSE,
// IB, Australian ACARA, Canadian provincial, French Baccalauréat, German Abitur.
const SUBJECTS: Subject[] = [
  // Core
  { id: "maths",          label: "Maths",            icon: "∑",   group: "Core" },
  { id: "further-maths",  label: "Further Maths",    icon: "∫",   group: "Core" },
  { id: "statistics",     label: "Statistics",       icon: "σ",   group: "Core" },
  { id: "english-lang",   label: "English Language", icon: "✎",   group: "Core" },
  { id: "english-lit",    label: "English Lit.",     icon: "“ ”", group: "Core" },

  // Sciences
  { id: "science",        label: "Combined Sci.",    icon: "⚛",   group: "Sciences" },
  { id: "physics",        label: "Physics",          icon: "⚡",   group: "Sciences" },
  { id: "chemistry",      label: "Chemistry",        icon: "⚗",   group: "Sciences" },
  { id: "biology",        label: "Biology",          icon: "🧬",  group: "Sciences" },
  { id: "earth-sci",      label: "Earth Science",    icon: "🌍",  group: "Sciences" },
  { id: "environment",    label: "Environment Sci.", icon: "🌱",  group: "Sciences" },
  { id: "astronomy",      label: "Astronomy",        icon: "✦",   group: "Sciences" },

  // Humanities
  { id: "history",        label: "History",          icon: "⚯",   group: "Humanities" },
  { id: "geography",      label: "Geography",        icon: "◐",   group: "Humanities" },
  { id: "civics",         label: "Civics",           icon: "⚖",   group: "Humanities" },
  { id: "philosophy",     label: "Philosophy",       icon: "Φ",   group: "Humanities" },
  { id: "religion",       label: "Religion / RE",    icon: "✧",   group: "Humanities" },
  { id: "psychology",     label: "Psychology",       icon: "Ψ",   group: "Humanities" },
  { id: "sociology",      label: "Sociology",        icon: "◍",   group: "Humanities" },
  { id: "anthropology",   label: "Anthropology",     icon: "⌬",   group: "Humanities" },

  // Languages
  { id: "irish",          label: "Gaeilge (Irish)",  icon: "Ⓘ",   group: "Languages" },
  { id: "french",         label: "Français",         icon: "Fr",  group: "Languages" },
  { id: "spanish",        label: "Español",          icon: "Es",  group: "Languages" },
  { id: "german",         label: "Deutsch",          icon: "De",  group: "Languages" },
  { id: "italian",        label: "Italiano",         icon: "It",  group: "Languages" },
  { id: "portuguese",     label: "Português",        icon: "Pt",  group: "Languages" },
  { id: "mandarin",       label: "中文 Mandarin",     icon: "中",   group: "Languages" },
  { id: "japanese",       label: "日本語",            icon: "日",   group: "Languages" },
  { id: "korean",         label: "한국어",            icon: "한",   group: "Languages" },
  { id: "arabic",         label: "العربية",           icon: "ع",   group: "Languages" },
  { id: "hindi",          label: "हिन्दी",             icon: "हि",  group: "Languages" },
  { id: "russian",        label: "Русский",          icon: "Ру",  group: "Languages" },
  { id: "latin",          label: "Latin",            icon: "Lat", group: "Languages" },
  { id: "ancient-greek",  label: "Ancient Greek",    icon: "Ωα",  group: "Languages" },
  { id: "quechua",        label: "Quechua",          icon: "Qu",  group: "Languages" },

  // Business & Economics
  { id: "economics",      label: "Economics",        icon: "€",   group: "Business" },
  { id: "business",       label: "Business",         icon: "$",   group: "Business" },
  { id: "accounting",     label: "Accounting",       icon: "≣",   group: "Business" },
  { id: "finance",        label: "Finance",          icon: "₿",   group: "Business" },
  { id: "law",            label: "Law",              icon: "§",   group: "Business" },
  { id: "politics",       label: "Politics",         icon: "⚑",   group: "Business" },
  { id: "global-perspectives", label: "Global Persp.", icon: "◉", group: "Business" },

  // STEM / Tech
  { id: "cs",             label: "Computer Sci.",    icon: "{ }", group: "Tech" },
  { id: "ict",            label: "ICT",              icon: "⌨",   group: "Tech" },
  { id: "data-science",   label: "Data Science",     icon: "📊",  group: "Tech" },
  { id: "robotics",       label: "Robotics",         icon: "⚙",   group: "Tech" },
  { id: "engineering",    label: "Engineering",      icon: "⚒",   group: "Tech" },
  { id: "design-tech",    label: "Design & Tech.",   icon: "▱",   group: "Tech" },
  { id: "electronics",    label: "Electronics",      icon: "⌁",   group: "Tech" },

  // Arts
  { id: "art",            label: "Art & Design",     icon: "◔",   group: "Arts" },
  { id: "music",          label: "Music",            icon: "♪",   group: "Arts" },
  { id: "drama",          label: "Drama",            icon: "◑",   group: "Arts" },
  { id: "dance",          label: "Dance",            icon: "❀",   group: "Arts" },
  { id: "media",          label: "Media Studies",    icon: "▶",   group: "Arts" },
  { id: "film",           label: "Film",             icon: "🎬",  group: "Arts" },
  { id: "photography",    label: "Photography",      icon: "📷",  group: "Arts" },

  // Health & Life
  { id: "pe",             label: "PE / Sport Sci.",  icon: "▲",   group: "Life" },
  { id: "health",         label: "Health",           icon: "✚",   group: "Life" },
  { id: "food-tech",      label: "Food & Nutrition", icon: "🍴",  group: "Life" },
  { id: "home-ec",        label: "Home Economics",   icon: "⌂",   group: "Life" },
  { id: "agriculture",    label: "Agriculture",      icon: "✿",   group: "Life" },

  // Vocational / Trades
  { id: "construction",   label: "Construction",     icon: "▤",   group: "Vocational" },
  { id: "automotive",     label: "Automotive",       icon: "⛟",   group: "Vocational" },
  { id: "welding",        label: "Welding",          icon: "⚡",   group: "Vocational" },
  { id: "electrical",     label: "Electrical",       icon: "⌁",   group: "Vocational" },
  { id: "plumbing",       label: "Plumbing",         icon: "💧",  group: "Vocational" },
  { id: "hospitality",    label: "Hospitality",      icon: "☕",   group: "Vocational" },
  { id: "childcare",      label: "Childcare",        icon: "♥",   group: "Vocational" },
];

const GROUPS = ["Core", "Sciences", "Humanities", "Languages", "Business", "Tech", "Arts", "Life", "Vocational"];

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export default function SubjectGrid({ value, onChange }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SUBJECTS;
    return SUBJECTS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.group.toLowerCase().includes(q)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map: Record<string, Subject[]> = {};
    for (const s of filtered) {
      (map[s.group] ||= []).push(s);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--fg-faint)",
          }}
        >
          Subject
        </p>
        <p
          className="font-mono"
          style={{
            fontSize: 9,
            letterSpacing: "0.06em",
            color: "var(--fg-faint)",
          }}
        >
          {SUBJECTS.length} global
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("common.searchSubjects")}
        className="w-full text-xs rounded-md px-2.5 py-1.5 mb-3 outline-none"
        style={{
          background: "var(--bg)",
          color: "var(--fg)",
          border: "1px solid var(--border)",
          fontFamily: "var(--sans)",
        }}
      />

      <div
        className="space-y-3 pr-1"
        style={{ maxHeight: 360, overflowY: "auto" }}
      >
        {GROUPS.filter((g) => grouped[g]?.length).map((g) => (
          <div key={g}>
            <p
              className="font-mono mb-1.5"
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
              }}
            >
              {g}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {grouped[g].map((s) => {
                const active = s.id === value;
                return (
                  <button
                    key={s.id}
                    onClick={() => onChange(s.id)}
                    className="px-2 py-1.5 rounded-md text-[11px] flex items-center gap-1.5 transition text-left"
                    title={s.label}
                    style={{
                      background: active ? "var(--accent-soft)" : "var(--bg)",
                      color: active ? "var(--accent)" : "var(--fg)",
                      border: "1px solid",
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <span style={{ opacity: 0.7, minWidth: 14 }}>{s.icon}</span>
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: "var(--fg-faint)" }}>
            No subjects match &ldquo;{query}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
