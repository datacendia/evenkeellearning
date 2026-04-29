// Jurisdiction reference table — used by the Most-Restrictive prioritizer.
// See EVENKEEL_BIBLE.md §18 for the public-facing jurisdiction map.

export interface Jurisdiction {
  code: string;
  name: string;
  primaryStatute: string;
  digitalAgeOfConsent: number;
  weight: number; // for the Most-Restrictive priority score
  parentalConsentRequired: boolean;
}

export const JURISDICTIONS: Record<string, Jurisdiction> = {
  EU: { code: "EU", name: "European Union", primaryStatute: "GDPR Art. 8 + AI Act", digitalAgeOfConsent: 16, weight: 30, parentalConsentRequired: true },
  IE: { code: "IE", name: "Ireland", primaryStatute: "Data Protection Act 2018", digitalAgeOfConsent: 16, weight: 25, parentalConsentRequired: true },
  GB: { code: "GB", name: "United Kingdom", primaryStatute: "DPA 2018 + Online Safety Act 2023", digitalAgeOfConsent: 13, weight: 20, parentalConsentRequired: true },
  PE: { code: "PE", name: "Peru", primaryStatute: "Ley 29733", digitalAgeOfConsent: 14, weight: 18, parentalConsentRequired: true },
  US: { code: "US", name: "United States", primaryStatute: "COPPA + KOSA", digitalAgeOfConsent: 13, weight: 15, parentalConsentRequired: true },
  BR: { code: "BR", name: "Brazil", primaryStatute: "LGPD + ECA", digitalAgeOfConsent: 12, weight: 17, parentalConsentRequired: true },
  IN: { code: "IN", name: "India", primaryStatute: "DPDP Act 2023", digitalAgeOfConsent: 18, weight: 19, parentalConsentRequired: true },
};

export const SEVERITY_WEIGHT = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
} as const;

export const LOCAL_OVERRIDE_BONUS = 10;
