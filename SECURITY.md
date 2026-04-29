# Security Policy

> Even Keel Learning is a learning platform that handles minors' cognitive data.
> We treat security findings with the seriousness that demands.

## Companion documents

- **[`SAFEGUARDING.md`](./SAFEGUARDING.md)** — child-safety policy: crisis
  detection, role guard, age-band gate, incident response. Read this if you
  are a school IT lead or a Designated Safeguarding Lead.
- **[`HONESTY.md`](./HONESTY.md)** — what is real vs mocked vs aspirational.
- **[`reports/PLATFORM_AUDIT.md`](./reports/PLATFORM_AUDIT.md)** — narrative
  audit and risk register.
- **[`reports/COMPLIANCE_CONTROL_MAP.md`](./reports/COMPLIANCE_CONTROL_MAP.md)** —
  control → file → test mapping (SOC 2, ISO 27001, GDPR, COPPA).

## Supported versions

| Version | Supported           |
| ------- | ------------------- |
| 1.0.x   | :white_check_mark:  |
| < 1.0   | :x:                 |

## Reporting a vulnerability

**Do NOT** open a public GitHub issue, disclose publicly before a fix, or
exploit beyond what is necessary to demonstrate the issue.

**Do** email `security@evenkeel.example` (replace with your address).
Please include:

- A description of the vulnerability and its impact
- Reproduction steps (the smallest case that demonstrates the flaw)
- Affected version, environment, browser
- Any suggested mitigations

We will acknowledge receipt within **48 hours** and provide an initial
assessment within **5 business days**.

### Severity SLA

| Severity | Definition                                                                                       | Response time | Examples                                                   |
| -------- | ------------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------------- |
| Critical | Compromises learner safety, leaks PII, breaks the no-direct-answer guarantee, or bypasses a gate | **24 hours**  | Auth bypass, RCE, leakage of CRT contents                  |
| High     | Allows privilege escalation or impersonation                                                     | **48 hours**  | XSS in chat surface, signature forgery, CSRF in compliance |
| Medium   | Information disclosure or DOS without learner-data exposure                                      | **7 days**    | CSRF on non-learner endpoint, stack-trace leakage          |
| Low      | Hardening, configuration, deprecation                                                            | **30 days**   | Outdated dependency, missing security header               |

## Security architecture

### Application

| Control                  | Status                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Authentication           | Demo only today (no WebAuthn implementation). Production requires platform passkeys; tracked in `EVENKEEL_BIBLE.md` §11. |
| Authorisation            | No server today. Production: role-based, jurisdiction-scoped.                                                       |
| Encryption in transit    | HTTPS at hosting layer (out of repo scope).                                                                         |
| Encryption at rest       | IndexedDB only on-device; no server-side data.                                                                      |
| Input validation         | `lib/validators.ts` — runtime guards on every external boundary.                                                    |
| Output encoding          | React JSX auto-escapes; no `dangerouslySetInnerHTML` anywhere — verifiable by `grep`.                               |
| Cryptographic signing    | Real ECDSA P-256 via `lib/crypto/signing.ts` (WebCrypto, in-browser).                                               |
| Content hashing          | SHA-256 via `crypto-js` for the CRT proof-of-work (`lib/crypto/hash.ts`).                                           |
| Decision Gate            | Crisis + PII pre-filter on every learner message (`lib/regulatory-absorb/decision-gate.ts`).                        |
| Zero-paste in chat       | Default-on; `e.preventDefault()` on `onPaste` in `EkeChat`.                                                        |
| No biometrics            | Architecturally enforced — no `mediaDevices` or `userVerification` calls anywhere.                                  |
| No advertising           | No ad-network scripts present.                                                                                      |
| No tracking              | No analytics library imported.                                                                                      |

### Infrastructure (target)

These are the intended controls for production deployment; out of scope for
the prototype itself.

- Secrets via environment, never committed
- Private VPC, security groups, WAF
- Real-time alerting on the audit bus
- Quarterly third-party penetration test
- SOC 2 Type II readiness, ISO 27001 readiness, GDPR Article 32 alignment, COPPA §312 alignment

### Development

- Dependency scanning via `npm audit` (run by `scripts/audit.mjs`)
- All commits reviewed before merge
- CI gates: typecheck, lint, test, audit-manifest emission
- Secret scanning at the host platform
- No `console.log` of learner content (verified by lint rule when configured)

## Compliance control mapping

Even Keel Learning maps platform controls to standard frameworks. The audit-manifest
JSON in `evidence/` carries the same mapping per test, so each artifact
shows which control it evidences.

| Framework        | Coverage                                              |
| ---------------- | ----------------------------------------------------- |
| **SOC 2 Type II** | CC1.2, CC4.1, CC6.1, CC6.8, CC7.1, CC7.2, CC8.1       |
| **ISO 27001:2022** | A.5.2, A.5.34, A.8.27, A.8.32, A.12.1.2              |
| **GDPR**         | Art. 5(1)(c) data minimisation, Art. 25 by-design, Art. 32 security |
| **COPPA**        | 16 CFR §312.5 (parental consent contract is a Phase-2 deliverable) |
| **CCPA/CPRA**    | §1798.100 (right to know), §1798.105 (deletion)       |

## Disclosure timeline

1. Vulnerability reported privately
2. Acknowledged within 48h
3. Triaged within 5 business days
4. Patch developed, tested, validated against the audit manifest
5. Fixed version released
6. Public disclosure 30 days post-fix (negotiable for critical issues)
7. CVE requested where applicable

## Safe harbour

We will not pursue legal action against good-faith security researchers
who:

- Comply with this policy
- Avoid privacy violations and degradation of service
- Stop testing as soon as a vulnerability is identified
- Do not access more data than necessary to demonstrate the issue
- Allow a reasonable time to remediate before disclosure

## Child-safety reports

If your finding affects a child's safety (e.g., bypass of the Decision Gate
crisis filter, unauthorised access to a privileged surface that exposes
student data, a way to leak a child's IP/identity), please mark the email
subject **`[CHILD-SAFETY]`** so it is triaged ahead of the standard SLA.

See [`SAFEGUARDING.md`](./SAFEGUARDING.md) for the policy these findings
relate to and the test files that pin our minimum coverage.

## Contact

- Security: `security@evenkeel.example`
- Child-safety: same address, prefix subject with `[CHILD-SAFETY]`
- General: `hello@evenkeel.example`
- Vulnerability disclosure metadata: `/.well-known/security.txt` (RFC 9116)
