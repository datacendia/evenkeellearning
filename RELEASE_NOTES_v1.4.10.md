# Release notes — Even Keel Learning v1.4.10

**Tag:** v1.4.10 — DSL escalation hardening
**Date:** 2026-04-27
**Pipeline:** typecheck ✅ · lint:strict ✅ · vitest 269 passed across 25 files
✅ · audit:strict 28 passed / 0 failed / 0 skipped ✅ · repro:verify 0
mismatches across 111 source files ✅ · transparency:verify governance × 7,
controlMap, repro, audit, componentDigest, signature all OK ✅

## What this release is

Three Phase-2-follow-up items called out in `RELEASE_NOTES_v1.4.9.md` "What
is **not** built" land here:

1. **Webhook retry-on-schedule** — the v1.4.8 escalation queue now
   re-attempts `failed` deliveries automatically on a deterministic
   exponential backoff while a Compliance dashboard tab is open. No
   server-side reliable queue: this is browser-only by design and
   documented honestly as such.
2. **WORM (Write-Once-Read-Many) retention** — the v1.4.8 200-entry
   count cap is replaced as the *primary* eviction trigger by 90-day
   time-based pruning. Signed payloads are immutable for the retention
   period; entries leave the store only via expiry or the explicit
   admin `clearEscalations()`.
3. **Provider-adapter scaffold** — `lib/safeguarding/providers/`
   exposes a stable `ProviderAdapter` interface, a real `webhook`
   adapter wrapping the v1.4.8 fetch path, and three honest stubs
   (`email-sendgrid`, `sms-twilio`, `push-fcm`) that return
   `kind: "provider_key_required"` with a documented configHelp string.

The crypto path, the privacy contract, the categorisation-only payload
shape, and the on-device-only persistence model are all unchanged.

## Files changed

### Added
- `lib/safeguarding/retry-scheduler.ts` (new module — 245 lines)
- `lib/safeguarding/providers/types.ts` (interface + outcome union)
- `lib/safeguarding/providers/webhook.ts` (real adapter)
- `lib/safeguarding/providers/email-sendgrid.ts` (stub)
- `lib/safeguarding/providers/sms-twilio.ts` (stub)
- `lib/safeguarding/providers/push-fcm.ts` (stub)
- `lib/safeguarding/providers/index.ts` (registry)
- `tests/unit/retry-scheduler.test.ts` (14 assertions)
- `tests/unit/providers.test.ts` (7 assertions)

### Modified
- `lib/safeguarding/escalation-queue.ts` — exports `RETENTION_DAYS`,
  `isExpired`, `pruneExpiredEscalations`; bumps `ENGINE_VERSION` to
  `evenkeel@1.4.10`. Existing v1.4.8 envelopes remain valid.
- `tests/unit/escalation-queue.test.ts` — +7 WORM assertions
  (boundary, prune selectivity, idempotency, notify contract,
  signed-envelope immutability).
- `package.json` — version 1.4.9 → 1.4.10
- `CHANGELOG.md` — v1.4.10 entry above v1.4.9
- `HONESTY.md` — narrative anchor and §3.2 (DSL escalation entry) updated
- `SAFEGUARDING.md` — §1.8 Phase-1 limitations rewritten

## Test delta

```
v1.4.9:  241 tests across 23 files
v1.4.10: 269 tests across 25 files (+28 / +2 files)
```

All 28 new assertions are in the three new/extended modules:
- `tests/unit/retry-scheduler.test.ts` — 14
- `tests/unit/providers.test.ts` —  7
- `tests/unit/escalation-queue.test.ts` —  7 (WORM addendum)

## Honesty preserved

The list of **not yet built** items in the v1.4.9 release notes is still
accurate, minus the three closed today. Specifically still not built:

- Email / SMS / push *provider bodies*. v1.4.10 ships the scaffold and
  the registry; the bodies remain stubs returning
  `provider_key_required`. Each one needs a paid third-party account, a
  server-side relay so the API key never reaches the learner device, and
  a school billing relationship.
- WebAuthn-passkey-derived signing key for receipts and the
  transparency bundle. The receipts session key and the transparency
  bundle's ephemeral build-time key are unchanged.
- KMS-backed institution key for the transparency bundle.
- Multi-turn crisis analysis and locale-variant crisis lexicons.
- Server-side reliable queue for headless safeguarding ingest. The
  v1.4.10 retry scheduler is browser-only by design.
- COPPA §312.5 verifiable parental consent (currently self-declared
  age band).

These remain on the Phase-2 / Week-3+ roadmap.

## Verification commands (copy-paste)

```bash
npm install
npm run typecheck
npm run lint:strict
npm run test:run
npm run audit:offline
npm run repro:build
npm run transparency:build
npm run audit:strict        # uses the post-build manifest by design
npm run repro:verify
npm run transparency:verify
```

All ten should exit 0.
