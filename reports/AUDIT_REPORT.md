# Even Keel Learning — Audit Report

**Generated from:** `evidence/test-manifest-enterprise-complete-20260429074009.json`  
**Run at:** 2026-04-29T07:40:09.173-0500  
**Executed by:** Stuart Rainey on STUARTRAINEY (win32 10.0.19045 x64)  
**Pass rate:** **100.00%** — 18 passed / 0 failed

## Summary

| Category            | Count |
|---------------------|-------|
| Build / static checks | 9 |
| HTTP smoke tests      | 0 |
| Inline assertions     | 8 |
| **Total passed**      | **18** |
| **Total failed**      | **0** |

## Control coverage

| Control | Tests passed | Tests failed |
|---------|--------------|--------------|
| `A.5.2` | 1 | 0 |
| `A.5.34` | 5 | 0 |
| `A.5.5` | 1 | 0 |
| `A.8.24` | 1 | 0 |
| `A.8.27` | 1 | 0 |
| `A.8.28` | 1 | 0 |
| `A.8.29` | 1 | 0 |
| `A.8.32` | 2 | 0 |
| `CC1.2` | 3 | 0 |
| `CC2.2` | 3 | 0 |
| `CC2.3` | 1 | 0 |
| `CC4.1` | 1 | 0 |
| `CC6.1` | 1 | 0 |
| `CC6.6` | 1 | 0 |
| `CC6.8` | 2 | 0 |
| `CC8.1` | 2 | 0 |
| `COPPA-§312.5` | 3 | 0 |
| `GDPR-Art.25` | 2 | 0 |
| `GDPR-Art.32` | 1 | 0 |
| `GDPR-Art.5(1)(b)` | 1 | 0 |
| `GDPR-Art.9` | 1 | 0 |

## Test ledger

| Test ID | Type | Category | Name | Status | Endpoint |
|---------|------|----------|------|--------|----------|
| `build-b5fe6da5` | build | build | TypeScript Compilation (tsc --noEmit) | ✅ pass | `N/A` |
| `build-1bbb858e` | build | build | Dependency Lock Integrity | ✅ pass | `N/A` |
| `build-4b0e83ec` | build | governance | Required governance files present | ✅ pass | `N/A` |
| `build-f65687ac` | build | security | RFC 9116 security.txt present | ✅ pass | `N/A` |
| `build-5dd8c875` | build | privacy | No biometric API call anywhere in src | ✅ pass | `N/A` |
| `build-836615ef` | build | privacy | No advertising / tracking scripts present | ✅ pass | `N/A` |
| `build-c9610568` | build | security | No dangerouslySetInnerHTML in source | ✅ pass | `N/A` |
| `build-b4188ba9` | build | code-quality | ESLint (no warnings) | ✅ pass | `N/A` |
| `test-5f470d90` | test | unit-tests | Vitest unit suite | ✅ pass | `N/A` |
| `build-a5ffc381` | build | documentation-integrity | Proposal truth-pack section markers balanced | ✅ pass | `N/A` |
| `inline-a8bb7e87` | inline | inline-assertion | Project name is 'even-keel-learning' | ✅ pass | `N/A` |
| `inline-eae0bd63` | inline | inline-assertion | Version follows SemVer | ✅ pass | `N/A` |
| `inline-99a5862e` | inline | inline-assertion | HONESTY.md mentions data-bus | ✅ pass | `N/A` |
| `inline-f90ae700` | inline | inline-assertion | WebCrypto signing module present | ✅ pass | `N/A` |
| `inline-f9b86691` | inline | inline-assertion | Decision Gate present | ✅ pass | `N/A` |
| `inline-86fab8cd` | inline | inline-assertion | i18n dictionary covers 9 locales | ✅ pass | `N/A` |
| `inline-224f3266` | inline | inline-assertion | Transparency bundle present and verifies (build-time signed) | ✅ pass | `N/A` |
| `inline-22ec9c29` | inline | inline-assertion | KCSIE 2025 / Prevent / DfE F&M control map: every cited evidence path exists | ✅ pass | `N/A` |

## Failed tests

_None — all checks passed._

## Raw manifest

See [`evidence/test-manifest-enterprise-complete-20260429074009.json`](../evidence/test-manifest-enterprise-complete-20260429074009.json) for the full machine-readable record.
