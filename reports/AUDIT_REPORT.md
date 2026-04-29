# Even Keel Learning — Audit Report

**Generated from:** `evidence/test-manifest-enterprise-complete-20260426205249.json`  
**Run at:** 2026-04-26T20:52:49.229-0500  
**Executed by:** Stu on DESKTOP-A3P0U3U (win32 10.0.26200 x64)  
**Pass rate:** **100.00%** — 16 passed / 0 failed

## Summary

| Category            | Count |
|---------------------|-------|
| Build / static checks | 9 |
| HTTP smoke tests      | 0 |
| Inline assertions     | 6 |
| **Total passed**      | **16** |
| **Total failed**      | **0** |

## Control coverage

| Control | Tests passed | Tests failed |
|---------|--------------|--------------|
| `A.5.2` | 1 | 0 |
| `A.5.34` | 3 | 0 |
| `A.5.5` | 1 | 0 |
| `A.8.24` | 1 | 0 |
| `A.8.27` | 1 | 0 |
| `A.8.28` | 1 | 0 |
| `A.8.29` | 1 | 0 |
| `A.8.32` | 2 | 0 |
| `CC1.2` | 3 | 0 |
| `CC2.2` | 1 | 0 |
| `CC2.3` | 1 | 0 |
| `CC4.1` | 1 | 0 |
| `CC6.1` | 1 | 0 |
| `CC6.6` | 1 | 0 |
| `CC6.8` | 2 | 0 |
| `CC8.1` | 2 | 0 |
| `COPPA-§312.5` | 3 | 0 |
| `GDPR-Art.32` | 1 | 0 |
| `GDPR-Art.5(1)(b)` | 1 | 0 |
| `GDPR-Art.9` | 1 | 0 |

## Test ledger

| Test ID | Type | Category | Name | Status | Endpoint |
|---------|------|----------|------|--------|----------|
| `build-155b7f94` | build | build | TypeScript Compilation (tsc --noEmit) | ✅ pass | `N/A` |
| `build-7e2229bc` | build | build | Dependency Lock Integrity | ✅ pass | `N/A` |
| `build-f112fbef` | build | governance | Required governance files present | ✅ pass | `N/A` |
| `build-18907ca5` | build | security | RFC 9116 security.txt present | ✅ pass | `N/A` |
| `build-d57b978e` | build | privacy | No biometric API call anywhere in src | ✅ pass | `N/A` |
| `build-7fa3bb3b` | build | privacy | No advertising / tracking scripts present | ✅ pass | `N/A` |
| `build-6a9d596c` | build | security | No dangerouslySetInnerHTML in source | ✅ pass | `N/A` |
| `build-da08267f` | build | code-quality | ESLint (no warnings) | ✅ pass | `N/A` |
| `test-2ecd968b` | test | unit-tests | Vitest unit suite | ✅ pass | `N/A` |
| `build-b3de5e6b` | build | documentation-integrity | Proposal truth-pack section markers balanced | ✅ pass | `N/A` |
| `inline-6cbf629e` | inline | inline-assertion | Project name is 'even-keel-learning' | ✅ pass | `N/A` |
| `inline-cc2bbc96` | inline | inline-assertion | Version follows SemVer | ✅ pass | `N/A` |
| `inline-105ea83b` | inline | inline-assertion | HONESTY.md mentions data-bus | ✅ pass | `N/A` |
| `inline-2b2831d4` | inline | inline-assertion | WebCrypto signing module present | ✅ pass | `N/A` |
| `inline-5550e2eb` | inline | inline-assertion | Decision Gate present | ✅ pass | `N/A` |
| `inline-962880f4` | inline | inline-assertion | i18n dictionary covers 9 locales | ✅ pass | `N/A` |

## Failed tests

_None — all checks passed._

## Raw manifest

See [`evidence/test-manifest-enterprise-complete-20260426205249.json`](../evidence/test-manifest-enterprise-complete-20260426205249.json) for the full machine-readable record.
