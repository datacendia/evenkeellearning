// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/age-band.ts
//
// Self-declared age band for the learner surface. The band controls which
// Eke tone greets the student and which content-safety profile is applied
// in the Decision Gate (stricter for under-13s).
//
// This is NOT age verification. It is a self-declaration step, stored in
// localStorage. COPPA §312.5 "verifiable parental consent" is Phase 2 — see
// SAFEGUARDING.md §3.
// ─────────────────────────────────────────────────────────────────────────────

export type AgeBand = "under-13" | "13-17" | "18-plus";

const STORAGE_KEY = "evenkeel/age-band";
const LEGACY_STORAGE_KEY = "keellearn/age-band";

export function getAgeBand(): AgeBand | null {
  if (typeof window === "undefined") return null;
  try {
    // One-time migration from the legacy keellearn/* namespace.
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy && !window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "under-13" || v === "13-17" || v === "18-plus") return v;
    return null;
  } catch {
    return null;
  }
}

export function setAgeBand(band: AgeBand): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, band);
  } catch {
    /* localStorage may be disabled */
  }
}

export function clearAgeBand(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Does this age band require additional safeguards (parental-consent
 * language, shorter sessions, stricter Eke tone)?
 */
export function requiresGuardianSafeguards(band: AgeBand | null): boolean {
  return band === "under-13";
}
