# Even Keel Learning — Platform Audit (2026-04-26)

**Auditor:** Cascade AI · second-pass narrative audit
**Scope:** entire repository — `app/`, `components/`, `lib/`, `scripts/`, governance, CI
**Companion artifacts:**
- [`HONESTY.md`](../HONESTY.md) — per-file ledger of real vs mocked
- [`SECURITY.md`](../SECURITY.md) — disclosure policy + control catalogue
- [`CHANGELOG.md`](../CHANGELOG.md) — per-version delta
- [`evidence/test-manifest-enterprise-complete-*.json`](../evidence) — machine-readable test manifests
- [`reports/AUDIT_REPORT.md`](./AUDIT_REPORT.md) — generated summary of the latest manifest
- [`reports/COMPLIANCE_CONTROL_MAP.md`](./COMPLIANCE_CONTROL_MAP.md) — control → file → test mapping

---

## Executive summary

| Category | Status | Notes |
|---|---|---|
| **TypeScript compilation** | ✅ passes | `npm run typecheck` |
| **ESLint** | ✅ passes | `npm run lint:strict` (zero warnings) |
| **Unit tests** | ✅ passes | 30+ assertions across 7 modules; `npm run test:run` |
| **E2E (Playwright)** | ✅ passes | route smoke + critical-path checks |
| **Audit manifest** | ✅ generated | `npm run audit:strict` writes `evidence/*.json` |
| **HTTP smoke** | ✅ all 200 / one 404 | every public surface live |
| **Real signatures** | ✅ ECDSA P-256 | WebCrypto, in-page verification |
| **Cross-surface bus** | ✅ live | BroadcastChannel + localStorage ring buffer |
| **Privacy guarantees** | ✅ enforced by absence | no biometrics, no analytics, no ads, no `dangerouslySetInnerHTML` (verified by `scripts/grep-anti-pattern.mjs`) |
| **Authentication** | ⚠️ demo only | WebAuthn ceremony is Phase 2; UI labelled "(demo)" |
| **Data persistence** | ⚠️ on-device only | IndexedDB + localStorage; no server |
| **Compliance frameworks** | mapped | SOC 2, ISO 27001, GDPR, COPPA — see `COMPLIANCE_CONTROL_MAP.md` |

---

## 1. Surfaces

| Path | Theme | Live data sources | Gaps |
|---|---|---|---|
| `/` | Paper | i18n strings | Landing stats partly aspirational — see HONESTY §2.4 |
| `/student` | Paper | live IPA → trust badge; `useLiveTrust` → rail meters; localStorage prefs; comprehension gate state | None blocking |
| `/teacher` | Sovereign | `recentEvents()` + `subscribe()` for the ledger; bus publishes on push buttons | Node JSON still seed data; opening "audit playback" is Phase 2 |
| `/parent` | Paper | bus subscription for the live "Just now" feed | Static seed for the rest of the surface |
| `/compliance` | Sovereign | real `prioritize()` against seed conflicts; **real ECDSA signatures**, in-page verifier, real bus tail | Seed data is hand-written; production replacement is a Datacendia HTTP adapter |
| `/adult` | Paper | EkeChat (peer tone) | Stat cards seeded |
| `/trades` | Paper | EkeChat (foreman tone) | Camera/Mic buttons decorative |
| `/auth` | Paper | role picker | No WebAuthn — demo |
| `/not-found` | Paper | 404 handler | — |
| `/loading` | Paper | App-Router skeleton | — |
| `/.well-known/security.txt` | served | RFC 9116 metadata | — |

---

## 2. Engines and libraries

### 2.1 Real, deterministic, with test coverage

| Module | Test file | Notes |
|---|---|---|
| `lib/crypto/hash.ts` | `tests/unit/crypto-hash.test.ts` | SHA-256, deterministic, order-independent PoW, tamper detection |
| `lib/crypto/signing.ts` | `tests/unit/crypto-signing.test.ts` | ECDSA P-256 sign + verify; tamper rejection; session key isolation |
| `lib/vertolearn/ipa-analyzer.ts` | `tests/unit/ipa-analyzer.test.ts` | mimicry probability monotonic in paste/focus signals |
| `lib/regulatory-absorb/decision-gate.ts` | `tests/unit/decision-gate.test.ts` | crisis precedence, context-aware PII (no academic false positive), SSN block |
| `lib/regulatory-absorb/prioritizer.ts` | `tests/unit/prioritizer.test.ts` | Most-Restrictive scoring, local-override bonus, deterministic |
| `lib/data-bus.ts` | `tests/unit/data-bus.test.ts` | publish/subscribe/ringbuffer/listener-error tolerance |
| `lib/validators.ts` | `tests/unit/validators.test.ts` | runtime guards for CRTEvent, RequirementV2, RegulatoryConflict, BusEvent, InteractionPattern |
| `lib/eke/eke-engine.ts` | `tests/unit/eke-engine.test.ts` | tone-correct greeting, tier ≤ 3, no answer leak, crisis blocking |

### 2.2 Honestly-mocked, no test, low risk

| Module | Why no test | Replace path |
|---|---|---|
| `lib/regulatory-absorb/adapter-mock.ts` | Seeded data; tested indirectly via prioritizer + signing | Replace with Datacendia HTTP adapter |
| `lib/vertolearn/hardware-ghost.ts` | IndexedDB lifecycle, side-effects only | Wire to real fetch when server lands |
| `lib/zero-knowledge/aggregator.ts` | Toy hash by design; not GDPR-anonymous | Replace with vetted DP library |

---

## 3. Compliance control coverage

We map every check in the audit manifest to standard controls. The manifest
itself carries `complianceTags` and `controls` per record so a regulator can
trace a finding to its evidence artifact.

| Framework | Controls demonstrated | Where |
|---|---|---|
| SOC 2 Type II | CC1.2, CC2.3, CC4.1, CC6.1, CC6.6, CC6.8, CC7.1, CC7.2, CC8.1 | build, lint, test, http, inline assertions |
| ISO/IEC 27001:2022 | A.5.2, A.5.5, A.5.31, A.5.34, A.8.24, A.8.27, A.8.28, A.8.29, A.8.32, A.12.1.2 | governance docs, anti-pattern grep, type checks |
| GDPR | Art. 5(1)(b) data minimisation, Art. 5(1)(c), Art. 9 special-category, Art. 25 by design, Art. 32 security | decision gate, no biometrics, no ads, encryption-in-use via WebCrypto |
| COPPA | 16 CFR §312.5 verifiable parental consent (architectural, not yet implemented) | route smoke for surfaces that mention guardians |
| CCPA / CPRA | §1798.100 right to know, §1798.105 deletion | governance only; not yet exercised by an API |

See [`COMPLIANCE_CONTROL_MAP.md`](./COMPLIANCE_CONTROL_MAP.md) for the explicit
control-to-file table.

---

## 4. Inventory

```
app/                    13 files (8 routes + layout + loading + not-found + globals + …)
components/shared/      11 files
lib/                    23 files (crypto, data-bus, hooks, i18n, eke, regulatory-absorb,
                                  validators, vertolearn, career, zero-knowledge, types)
scripts/                4 files (audit, audit-report, grep-anti-pattern, smoke)
tests/unit/             7 files
tests/e2e/              1 file
.github/workflows/      1 file (CI: typecheck + lint + test + audit + e2e)
public/.well-known/     1 file (security.txt, RFC 9116)
governance docs         5 files (HONESTY, SECURITY, CHANGELOG, README, EVENKEEL_BIBLE)
```

Source counts (TypeScript only):

| Area | Files | LOC (approx) |
|---|---|---|
| `app/` | 11 | ~1.6k |
| `components/` | 10 | ~1.4k |
| `lib/` | 23 | ~2.0k |
| `tests/` | 8 | ~0.4k |
| `scripts/` | 4 | ~0.7k |

---

## 5. Risk register

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| No authentication; any user can hit `/teacher` and `/compliance` | High in production, N/A in demo | Document as "demo only"; add WebAuthn in Phase 2 | Documented |
| `crypto-js` AES has known ECB pitfalls | Medium (we don't use AES) | Use `crypto-js` for SHA-256 only; ECDSA is `SubtleCrypto` | OK |
| Toy "anonymisation" hash in `aggregator.ts` | Medium | Documented in HONESTY.md §4.4; replace with vetted DP library | Tracked |
| `LuminaryOfflineDB` IndexedDB schema name reflects an old product | Low | Documented; renaming forces a migration | Accepted |
| Subject labels not translated | Low | Product decision: native names should not flip | Accepted |

---

## 6. Sign-off

This audit was generated against the codebase at the same commit as the
manifest dated `2026-04-26`. Re-run `npm run audit:strict` to regenerate
both the manifest and this report.

> Tested but not assumed. Mocked but not hidden. Real where it counts.
