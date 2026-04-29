# Even Keel Learning — Compliance Control Map

A control-by-control index from regulatory framework → repository artifact →
manifest test id. The same controls are written into every record of
`evidence/test-manifest-enterprise-complete-*.json`, so an auditor can move
between this document and the manifests freely.

## SOC 2 Type II — Trust Services Criteria

| Control | Description (paraphrased) | Where it lives in the repo | Manifest tag |
|---|---|---|---|
| **CC1.2** | Board / governance commitment to integrity | `EVENKEEL_BIBLE.md`, `HONESTY.md`, `SECURITY.md` | `build:governance` |
| **CC2.3** | Information about the system's security policies is communicated | `SECURITY.md`, `/.well-known/security.txt` | `build:security` |
| **CC4.1** | Monitoring activities | `lib/data-bus.ts`, `useLiveTrust`, `Ledger` views, vitest unit suite | `test:unit-tests` |
| **CC6.1** | Logical access — input validation, auth boundary | `lib/validators.ts`, `lib/crypto/signing.ts` | `inline:CC6.1` |
| **CC6.6** | Restricted reading of system data — XSS prevention | `scripts/grep-anti-pattern.mjs` (no `dangerouslySetInnerHTML`) | `build:security` |
| **CC6.8** | Change-detection / build integrity | `npx tsc --noEmit`, `package-lock.json`, `scripts/audit.mjs` | `build:CC6.8` |
| **CC7.1** | System operations — alerts | `app/teacher Ledger`, `app/compliance Ledger`, route 404 handler | `http:errors` |
| **CC7.2** | System monitoring — health checks | route smoke (every public surface 200) | `http:health` |
| **CC8.1** | Change management | `CHANGELOG.md`, version bump in `package.json`, ESLint clean | `build:code-quality` |

## ISO/IEC 27001:2022 — Annex A controls

| Control | Description | Where | Manifest tag |
|---|---|---|---|
| **A.5.2** | Information security roles & responsibilities | `SECURITY.md` | `build:governance` |
| **A.5.5** | Contact with authorities | `SECURITY.md` + `/.well-known/security.txt` | `build:security` |
| **A.5.31** | Legal, statutory, regulatory & contractual requirements | `lib/regulatory-absorb/*` | `http:compliance` |
| **A.5.34** | Privacy & PII protection | `lib/regulatory-absorb/decision-gate.ts`, `lib/i18n/*` (jurisdictional posture) | `inline:A.5.34` |
| **A.8.24** | Use of cryptography | `lib/crypto/hash.ts`, `lib/crypto/signing.ts` | `inline:A.8.24` |
| **A.8.27** | Secure system architecture & engineering | `HONESTY.md` per-file ledger; `lib/validators.ts` | `build:security` |
| **A.8.28** | Secure coding | `.eslintrc.json`, `tsconfig.json` strict | `build:code-quality` |
| **A.8.29** | Security testing | `vitest.config.ts`, `tests/unit/*.test.ts`, `playwright.config.ts` | `test:unit-tests` |
| **A.8.32** | Change management | `CHANGELOG.md`, CI workflow gate | `build:CC6.8` |
| **A.12.1.2** | Change-management for the deployed app | `next build`, deployment-mode check | `build:deployment` |

## GDPR — selected articles

| Article | Description | Where |
|---|---|---|
| **Art. 5(1)(b)** | Purpose limitation; no advertising | `scripts/grep-anti-pattern.mjs` excludes ad networks |
| **Art. 5(1)(c)** | Data minimisation | Eke stores no PII; IPA stores only timestamps |
| **Art. 5(1)(e)** | Storage limitation | IndexedDB queue + ring buffer of bounded size |
| **Art. 9** | Special-category (biometric) data | Biometrics architecturally absent — verified by anti-pattern grep |
| **Art. 25** | Data protection by design | `EkeChat` zero-paste default; Decision Gate before every reply |
| **Art. 32** | Security of processing | Decision Gate, ECDSA-signed audit envelopes, anti-pattern grep, lint rules |

## COPPA — 16 CFR §312

| § | Description | Where |
|---|---|---|
| **§312.5** | Verifiable parental consent | Architectural posture only; the parent surface is informational. The full consent ceremony is a Phase 2 deliverable tracked in `EVENKEEL_BIBLE.md` §11. |
| **§312.7** | Anti-conditioning of participation on disclosure | Comprehension Gate never asks for PII; Decision Gate blocks credential-shaped input |
| **§312.10** | Data retention | IndexedDB only; cloud retention will adopt Hardware Ghost burst model |

## CCPA / CPRA — selected sections

| § | Description | Where |
|---|---|---|
| **1798.100** | Right to know | No data leaves the device today; export endpoint is Phase 2 |
| **1798.105** | Right to delete | `lib/data-bus.clearHistory()` and `localStorage.clear()` on the client |

---

**How to read this map together with the manifest:**
the manifest's `controls` field for any test (e.g. `"CC6.8,A.8.32"`) lines
up exactly with the rows in the tables above. A failing test therefore
points to a degraded control rather than to a vague concept.
