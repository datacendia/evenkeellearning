"use client";

import { useState, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  initials: string;
  title: string;
  meta: string;
  status: "verified" | "friction" | "anomaly";
  children: ReactNode;
}

const STATUS = {
  verified: { label: "Verified Mastery", color: "var(--accent)" },
  friction: { label: "Active Friction", color: "var(--hub-warning, var(--amber))" },
  anomaly:  { label: "Mimicry Anomaly", color: "var(--hub-danger, var(--red))" },
} as const;

export default function BoxInBoxNode({
  initials,
  title,
  meta,
  status,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const s = STATUS[status];

  return (
    <div
      className={`kl-node ${open ? "open" : ""}`}
      onClick={() => setOpen(!open)}
    >
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-md flex items-center justify-center font-serif font-bold text-sm"
            style={{
              background: "var(--bg-deep)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
            }}
          >
            {initials}
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
              {title}
            </h3>
            <p
              className="font-mono mt-1"
              style={{ fontSize: 10, color: "var(--fg-faint)" }}
            >
              {meta}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right hidden md:block">
            <p
              className="font-mono"
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--fg-faint)",
                marginBottom: 4,
              }}
            >
              Status
            </p>
            <span
              className="kl-badge"
              style={{ background: "transparent", color: s.color, borderColor: s.color }}
            >
              {s.label}
            </span>
          </div>
          <ChevronDown
            size={18}
            className="kl-chevron"
            style={{ color: "var(--fg-faint)" }}
          />
        </div>
      </div>

      <div className="kl-node-detail">
        <div className="kl-node-detail-inner">
          <div
            className="p-5"
            style={{
              background: "var(--bg)",
              borderTop: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
