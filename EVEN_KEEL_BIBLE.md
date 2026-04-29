# Even Keel Learning Bible

> **The single authoritative reference for the Even Keel Learning Sovereign Learning OS.**
> Centered. Verified. Sovereign.

---

**Bible version:** 1.1 · **Codebase version:** 1.5.3 · **Last updated:** 2026-04-28 · **Authors:** Stuart Rainey (Founder/Tech) · Laura Neilson (CEO Education — proposed)
**Naming note:** All identifiers (Even Keel Learning, Eke, PTK, VertoLearn) are working names. See Appendix B for legally-vetted alternatives if a name needs to change.

> **Status of this document:** the Bible is a **product-vision specification**. It describes the system Even Keel Learning intends to be, not necessarily what is in `main` today. For the ground-truth ledger of what is real, mocked, or aspirational at any given commit, read **[`HONESTY.md`](./HONESTY.md)** first. For the safeguarding policy that backs the controls described in Part III, read **[`SAFEGUARDING.md`](./SAFEGUARDING.md)**. For per-version progress, read **[`CHANGELOG.md`](./CHANGELOG.md)**.
>
> The new **[§0 Reality Snapshot](#0-reality-snapshot-v153-2026-04-28)** is the canonical at-a-glance answer to the question *"what does the codebase actually do today versus what does the rest of this document describe?"* — read it before any of the visionary parts.

---

# §0 Reality Snapshot (v1.5.3, 2026-04-28)

**Purpose:** This section answers the question "what does the codebase actually do today versus what the rest of this Bible describes?" It is the ground-truth summary of v1.5.3 reality.

## What Is Shipped Today (v1.5.3)

### Core Verification Engine
- **Move vocabulary parser** (`lib/validation/move-vocabulary.ts`) supports: add/subtract/multiply/divide both sides, square both sides, apply function (log, ln, sin, cos, tan, sqrt). Variable operands (e.g., "add 2x to both sides") are supported.
- **Answer checker** (`lib/validation/answer-checker.ts`) uses math.js for symbolic equation verification.
- **Heavy CAS dispatcher** (`lib/validation/answer-checker-heavy.ts`) escalates to Pyodide + Sympy when math.js returns inconclusive verdicts. Falls back silently on timeout/error.
- **Step validator** (`lib/validation/step-validator.ts`) verifies equation transformations against declared move vocabulary.
- **CRT schema v1.2** is defined but not fully wired to surfaces. Signature fields exist but signing is only implemented in the Compliance Officer dashboard (audit vault), not in student CRTs.

### Content System
- **Content schema** (`lib/content/schema.ts`) supports: problems, worked examples, hints, tiered explanations, and optional `figures` field for authored JSXGraph-renderable figures.
- **Figure validation** at build and load time. First authored figure (graph of y=2x+5) embedded in `maths.linear-eq-1var` pack item 001.
- **Content packs:** One pack exists (`maths.linear-eq-1var`) with 5 items. Pack format is ESM modules with leak-guarded worked examples.

### Surfaces
- **Student surface** (`app/student/page.tsx`): Hardcoded problem (linear equation 2x+5=15), hardcoded skill family, EkeChat with mentor tone, comprehension gate firing bus events, right rail with cognitive effort/goals (decorative). Curriculum and jurisdiction stored in localStorage but not used to filter content.
- **Parent surface** (`app/parent/page.tsx`): Shadow Feed (live event stream), Dinner Table Prompts (conversation starters), Career DNA traits (decorative), Safety Centre toggles (decorative, no backend). Demonstrates translation intent but is largely decorative.
- **Teacher surface** (`app/teacher/page.tsx`): Struggle Map (decorative), BoxInBoxNode for CRT playback (implemented but no real CRT data), Logic Bridge (decorative).
- **Compliance Officer surface** (`app/compliance/page.tsx`): Compliance Pulse, Resolution Tray, Audit Vault with real ECDSA P-256 signing (implemented), Integrity Ledger (live tail). Mock Regulatory Absorb adapter with seed data.
- **CurriculumPicker** (`components/shared/CurriculumPicker.tsx`): Static list of 8 curricula for 7 jurisdictions. No dynamic curriculum update, no filtering, no integration with content system.

### Safety & Compliance
- **Crisis detection:** 17-regex lexicon + emoji+affect rule in `lib/regulatory-absorb/decision-gate.ts`. Shipped and tested.
- **RoleGuard:** Passphrase gate on `/teacher` and `/compliance` surfaces.
- **AgeBandGate:** Self-declaration with guardian-acknowledgement for under-13s on `/student`.
- **Decision Gate:** Pre-response check by Regulatory Absorb on every Eke output (mock adapter).
- **WCAG 2.2 AA accessibility settings:** Dyslexia-friendly typography, focus mode, high contrast, keyboard/screen-reader support (see SAFEGUARDING.md §1.6).
- **Assistive-input exemption:** IPA mimicry detector exempts users of eye-gaze, switch, dictation, sticky-keys, word-prediction tools (SAFEGUARDING.md §1.5).

### Infrastructure
- **Hardware Ghost Protocol:** IndexedDB offline-first storage (schema name `LuminaryOfflineDB`). Sync queue, local traces, local patterns. Burst sync on reconnect. Encryption boundary defined but mock implementation (JSON stringify).
- **Cross-surface event bus:** BroadcastChannel + localStorage for real-time event streaming.
- **Testing:** 53-unit test suite (move-vocab, diagnose-heavy, content-schema-figures, etc.) + Playwright e2e + GitHub Actions CI.

## What Is Missing (Aspirational vs Reality)

### Critical Gaps
- **Auto curriculum update:** NOT implemented. CurriculumPicker is static. No mechanism to fetch, validate, or update curricula from external sources. No integration between curriculum selection and content filtering.
- **Dynamic content filtering:** Student surface does not use selected curriculum/jurisdiction to filter problems. Content is hardcoded.
- **Parent translation:** Parent surface shows decorative Shadow Feed and prompts. No real translation of child's struggle into parent-understandable language. No connection to child's actual CRT data.
- **Student CRT capture:** CRT schema exists but student surface does not capture real cognitive reasoning traces. Events are fired to bus but not persisted to IndexedDB or signed.
- **Teacher audit playback:** BoxInBoxNode exists but no real CRT data to playback. Struggle Map is decorative.
- **Career DNA:** Traits are hardcoded/decorative. No real analysis of CRT data to extract cognitive strengths.
- **Regulatory Absorb V2 HTTP integration:** Mock adapter only. No real Datacendia HTTP service integration.
- **FIDO2/WebAuthn:** RoleGuard passphrase gate instead of real passkey auth.
- **Verifiable parental consent:** AgeBandGate is self-declaration only. No email-OTP/KYC/school roster verification.

### Partial Implementation
- **Eke tiered hints:** Hint levels exist but hints are rule-based, not AI-generated. No real SLM serving.
- **Safety Centre controls:** Toggles exist but are decorative (no backend enforcement of screen time, bedtime, etc.).
- **Hardware Ghost encryption:** Encryption boundary defined but mock implementation (JSON stringify instead of Web Crypto).

## Does It Help Parents Understand Their Child's Learning?

**Partial, but mostly aspirational.**

What works:
- Parent surface demonstrates the intent: Shadow Feed shows events, Dinner Table Prompts suggest conversation starters.
- Safety Centre shows the right controls (screen time, bedtime, crisis notifications) even if not enforced.
- Career DNA section signals the long-term value proposition.

What doesn't work:
- Parent surface is not connected to child's actual data. Shadow Feed shows mock events, not real student CRTs.
- No translation layer that explains "your child struggled with substitution for 3 minutes, here's what that means."
- No real-time insight into what the child is learning right now.
- Curriculum/jurisdiction selection on parent surface doesn't affect anything.

The platform demonstrates the vision but does not yet deliver on the core promise of translating algorithmic struggle into parent-understandable insight.

## Did It Sway From the Original Idea?

**Yes, in implementation but not in vision.**

The original thesis (Sovereign Learning OS with verified CRT, regulatory compliance, parent translation) remains intact in the Bible. However:

- The codebase has focused heavily on **verification infrastructure** (move vocab, answer checker, heavy CAS, figure schema) at the expense of **surface completeness**.
- Parent and student surfaces are decorative shells around a strong verification core.
- The auto curriculum update feature (a key differentiator against generic AI tutors) was never implemented.
- The platform is closer to a "math verification engine with UI scaffolding" than a "Sovereign Learning OS."

This is a natural consequence of building the hardest parts first (verification, safety, compliance) before the easier parts (UI polish, dynamic content). The roadmap in §25 should reflect this reality.

---

## Table of Contents

- [Part I — Vision & Brand](#part-i--vision--brand)
  - [1. The Three Problems](#1-the-three-problems)
  - [2. The Even Keel Learning Thesis](#2-the-evenkeel-thesis)
  - [3. Brand System](#3-brand-system)
  - [4. The Five Audiences](#4-the-five-audiences)
  - [5. Co-Founder Proposal](#5-co-founder-proposal)
  - [6. Pilot Strategy](#6-pilot-strategy)
  - [7. Pricing](#7-pricing)
- [Part II — Architecture & Engineering](#part-ii--architecture--engineering)
  - [8. System Map](#8-system-map)
  - [9. Module Inventory](#9-module-inventory)
  - [10. Canonical Data Models](#10-canonical-data-models)
  - [11. CRT Schema v1.2](#11-crt-schema-v12)
  - [12. Eke AI Contract](#12-eke-ai-contract)
  - [13. Regulatory Absorb V2 Integration Contract](#13-regulatory-absorb-v2-integration-contract)
  - [14. Role Permission Matrix](#14-role-permission-matrix)
  - [15. Hardware Ghost Protocol](#15-hardware-ghost-protocol)
  - [16. Theme System](#16-theme-system)
  - [17. Performance & Privacy Budget](#17-performance--privacy-budget)
- [Part III — Compliance, Safety & Pilot](#part-iii--compliance-safety--pilot)
  - [18. Jurisdiction Map](#18-jurisdiction-map)
  - [19. Compliance Officer Role](#19-compliance-officer-role)
  - [20. "Most Restrictive" Conflict Logic](#20-most-restrictive-conflict-logic)
  - [21. Safety Centre (Parent)](#21-safety-centre-parent)
  - [22. Child Safety Principles](#22-child-safety-principles)
  - [23. Crisis Detection & Escalation](#23-crisis-detection--escalation)
  - [24. Pilot Operations Plan](#24-pilot-operations-plan)
  - [25. Roadmap](#25-roadmap)
- [Appendices](#appendices)
  - [Appendix A — Glossary](#appendix-a--glossary)
  - [Appendix B — Naming Alternatives](#appendix-b--naming-alternatives)
  - [Appendix C — Co-founder Proposal](#appendix-c--co-founder-proposal)
  - [Appendix D — Open Questions](#appendix-d--open-questions)
  - [Appendix E — Signing Algorithm Rationale](#appendix-e--signing-algorithm-rationale)

---

# Part I — Vision & Brand

## 1. The Three Problems

Even Keel Learning exists to solve three compounding crises in modern education:

1. **The Homework Problem.** Generative AI has made finding answers trivial. Children are not learning; they are outsourcing thinking. Teachers cannot tell who did the work.
2. **The Curriculum Problem.** Global curricula are fragmented (UK GCSE, Irish Junior/Leaving Cert, US Common Core, Peruvian Currículo Nacional, Brazilian BNCC, Indian CBSE, etc.). Generic AI tutors don't map to a student's actual exam.
3. **The Pathway Problem.** Students make life-defining choices (university vs. trade, country, debt, vocation) with almost no real evidence about their own cognitive strengths.

These problems compound. AI cheating destroys teacher trust → trust collapse defunds public education → the pathway gap widens for kids without private tutors.

Even Keel Learning is engineered to break this cycle.

---

## 2. The Even Keel Learning Thesis

> **Even Keel Learning is not a homework helper. It is a Sovereign Learning OS that produces verified, portable proof of cognitive growth.**

We do not compete with ChatGPT. We compete with **uncertainty**.

- For **students**, we are the partner that won't give the answer but won't let them fail alone.
- For **teachers**, we are the only AI tool that produces cryptographically signed evidence the student did their own work.
- For **parents**, we are the translator between an algorithm and a child's emotional reality.
- For **principals/compliance officers**, we are the legal shield that proves the platform follows the law in their jurisdiction *today*.
- For **regulators**, we are the first AI education system that ingests the law as code.

The product moat is not a model. It is the **Cognitive Reasoning Trace (CRT)** — a signed, tamper-evident record of how a student thinks — and the **Regulatory Absorb V2** engine that keeps the platform legally compliant in every jurisdiction it enters.

---

## 3. Brand System

### 3.1 The Name: Even Keel Learning

A keel is the structural backbone of a vessel. Without a true keel, no ship sails. Even Keel Learning is the structural backbone of a learner's reasoning.

| Quality | Why it works |
|---|---|
| **Centered** | Every interaction returns the learner to focus |
| **Sovereign** | The student owns their CRT; the school owns its compliance trace |
| **Maritime** | Resonates strongly in Ireland (pilot site), familiar globally |
| **Industrial** | Welcomes apprentices and trades, not just academic kids |
| **Legally clean** | Distinct from "Anvil AI" (Class 042 Live/Registered) and the Phi Theta Kappa "PTK" honor society |
| **Phonetic** | "Keel" is universally pronounceable; in Irish (`cíle cothrom` = "even keel") it carries cultural weight |

**Backups** if Even Keel Learning becomes unavailable: see [Appendix B](#appendix-b-naming-alternatives).

### 3.2 The AI: Eke

The AI assistant is named **Eke**, an acronym for **K**ey **E**vidence **L**ogic **E**ngine.

- For kids: a friendly two-syllable mentor name.
- For teachers: a clear declaration that the AI is logging *evidence of logic*, not generating answers.
- For regulators: an auditable engine, not a black-box chatbot.

Eke has three personality tones, switched automatically by surface:

| Tone | Audience | Voice |
|---|---|---|
| `mentor` | K-12 students | Warm, curious, never sarcastic |
| `peer` | Adult learners | Conversational, direct, respectful of expertise |
| `foreman` | Apprentices/trades | Plain-spoken, shop-floor, hands-on framing |

Eke is **forbidden** from giving direct answers. See [§12 Eke AI Contract](#12-eke-ai-contract).

### 3.3 The Framework: PTK

PTK = **Parents, Teachers, Kids** — the three-way verification triad.

PTK is *internal architecture vocabulary* only. It never appears as user-facing branding (the Phi Theta Kappa honor society owns the public PTK acronym in education). On the Compliance Officer dashboard PTK is referred to as the "Triad Verification Framework."

### 3.4 The Engine: VertoLearn

The verification engine — CRT logging, Interaction Pattern Analysis, mimicry detection, neutrality shield, hardware ghost protocol — is collectively branded **VertoLearn** (`verto` = Latin "I turn / I prove"). It is the technical layer beneath Even Keel Learning's surfaces.

### 3.5 Visual Identity

Even Keel Learning ships **two themes**:

#### Paper theme (warm, learner-facing)
Used for: Student, Parent, Adult Learner, Trades, marketing landing.

| Token | Value |
|---|---|
| `--paper` | `#FAF7F2` |
| `--paper-warm` | `#F4EFE6` |
| `--paper-deep` | `#ECE5D8` |
| `--ink` | `#0E1411` |
| `--teal` | `#0F6E56` (primary) |
| `--teal-700` | `#0A4F3D` |
| `--teal-100` | `#C7E8DA` |
| `--purple` | `#6B46C1` (accent) |
| `--amber` | `#BA7517` (warning) |
| `--rose` | `#C2185B` (alert) |
| `--rule` | `#D9DDD4` |
| Serif | `Fraunces` (headlines) |
| Sans | `Geist` (body) |
| Mono | `Geist Mono` (data, codes) |

#### Sovereign theme (dark, institutional)
Used for: Teacher, Compliance Officer.

| Token | Value |
|---|---|
| `--hub-bg` | `#0A0E12` |
| `--hub-surface` | `#131820` |
| `--hub-surface-alt` | `#1B2129` |
| `--hub-border` | `#232C36` |
| `--hub-text` | `#E5E7EA` |
| `--hub-text-dim` | `#8B95A1` |
| `--hub-accent` | `#5DCAA5` (teal-bright for emphasis) |
| `--hub-warning` | `#F5A623` |
| `--hub-danger` | `#E5524A` |
| `--hub-info` | `#6BA4F0` |

### 3.6 Brand Do / Don't

**Do**
- Use the Fraunces serif for headlines on Paper surfaces.
- Refer to the AI as "Eke" in lower-case Tailwind contexts but `Eke` (camel) in code.
- Use maritime metaphors sparingly: *anchor, course, depth, keel, voyage*.

**Don't**
- Use Disney-style wizard imagery (Merlin/sorcerer/sword-in-stone art).
- Use the standalone word "Anvil" (trademark conflict with Anvil AI, Class 042).
- Use "Zion" or "Sion" (politically sensitive in the Irish pilot context).
- Personify Eke as a face/avatar that mimics a real person (uncanny-valley risk for children).
- Display advertising on any surface, ever.

---

## 4. The Five Audiences

| # | Audience | Surface | Theme | Primary Outcome |
|---|---|---|---|---|
| 1 | **Students (K-12)** | `/student` | Paper | Pass comprehension gates; build CRT; earn mastery badges |
| 2 | **Adult Learners** | `/adult` | Paper (professional variant) | Self-paced certification, exam prep, career change |
| 3 | **Apprentices / Trades** | `/trades` | Paper (industrial variant) | Hands-on competency tracking; voice-first input |
| 4 | **Parents** | `/parent` | Paper | Translation of struggle into conversation; safety controls |
| 5 | **Teachers + Principals (Compliance Officer)** | `/teacher`, `/compliance` | Sovereign | Class-wide friction maps, audit playback, regulatory attestation |

---

## 5. Co-Founder Proposal

Even Keel Learning is offered as a **50/50 co-founder partnership** between Stuart Rainey (Founder, Technology) and Laura Neilson (proposed CEO Education).

| Term | Value |
|---|---|
| Equity split | 50% / 50% |
| Vesting | 4 years, monthly |
| Cliff | 12 months |
| Acceleration | Single-trigger on involuntary termination; double-trigger on acquisition |
| Initial focus | Irish secondary-school pilot (12 weeks, 2 schools) |
| Laura's domain | Pedagogy, curriculum mapping, educator relationships, pilot operations |
| Stuart's domain | Architecture, Eke engine, VertoLearn CRT, Regulatory Absorb integration, infrastructure |

The full proposal is referenced in `evenkeel-cofounder-proposal.docx` (legacy filename `luminary-cofounder-proposal.docx`).

---

## 6. Pilot Strategy

**Beachhead:** 2 Irish secondary schools, Dublin metropolitan area, 12-week pilot.

| Parameter | Value |
|---|---|
| Schools | 2 (mix: 1 fee-paying, 1 ETB / DEIS for diversity) |
| Year groups | Year 9–11 (GCSE-equivalent / Junior Cert) |
| Subjects | Mathematics + English |
| Cohort size | 60–80 students per school |
| Duration | 12 weeks |
| Compliance Officer | Each school's Principal or Designated Safeguarding Lead |
| KPIs | Resilience Delta, Integrity Pulse, Cognitive Friction (see [§24](#24-pilot-operations-plan)) |
| Cost to school | Free during pilot in exchange for case-study rights |

**Why Ireland:**
- GDPR-K (EU) + Irish DPA 2018 produces the strictest legal baseline; passing here means passing globally.
- Strong Department of Education openness to digital pilots post-2022.
- English-language baseline simplifies Eke tone tuning.
- Stuart's network (Dublin) and Laura's pedagogy network create warm intros.

**Secondary expansion:** Peru (Lima) foundation work, leveraging Ley 29733 + Datacendia compliance engine. Then UK (post-OSA), then US (state-by-state COPPA/KOSA mapping).

---

## 7. Pricing

| Tier | Price | Audience | Caps |
|---|---|---|---|
| **Spark** | Free, forever | 1 child per family | 1 subject, basic CRT, no Career DNA export |
| **Family** | $9.99 / month | Up to 4 children | All subjects, full CRT, Career DNA, parent Safety Centre |
| **School** | $12 / student / year | Schools | Teacher Sovereign OS, Struggle Map, Audit Playback |
| **Institutional+** | Custom | School districts, MATs, ETBs | Compliance Officer dashboard, Regulatory Absorb V2, Audit Vault export |
| **Trades** | $18 / apprentice / month | Employers, training boards (SOLAS, City & Guilds) | Hands-on log, voice input, employer dashboard |
| **Adult Learner** | $14.99 / month | Self-paced individuals | Certification tracker, peer-tone Eke |

Principles:
- **No advertising** on any tier.
- **No data resale** under any tier.
- **Free Spark tier is permanent** — accessibility is a license-to-operate value.

---

# Part II — Architecture & Engineering

## 8. System Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                         EVENKEEL SURFACES                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ Student │ │ Teacher │ │ Parent  │ │ Compliance   │ │ Adult /    │ │
│  │ (Paper) │ │(Sov.)   │ │ (Paper) │ │ Officer(Sov.)│ │ Trades     │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └──────┬───────┘ └─────┬──────┘ │
│       │           │           │              │                │        │
└───────┼───────────┼───────────┼──────────────┼────────────────┼────────┘
        │           │           │              │                │
        └───────────┴─────┬─────┴──────────────┴────────────────┘
                          │
                ┌─────────▼──────────┐
                │   Eke AI Engine   │  (mentor / peer / foreman tones)
                │   (lib/eke/*)     │  → tiered hints, never answers
                └─────────┬──────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
┌───────▼────────────┐          ┌───────────▼─────────────┐
│ VertoLearn CRT     │          │ Regulatory Absorb V2     │
│ (lib/vertolearn/)  │          │ (lib/regulatory-absorb/) │
│  • CRT Logger      │          │  • RequirementV2          │
│  • IPA Analyzer    │◄────────►│  • DecisionGate           │
│  • Neutrality      │          │  • Most-Restrictive       │
│    Shield          │          │    Prioritizer            │
│  • Mimicry Det.    │          │  • Mock adapter (v1)      │
└───────┬────────────┘          │  • Datacendia HTTP (v2)   │
        │                       └─────────────┬─────────────┘
        │                                     │
┌───────▼────────────────────────────────────▼─────────────┐
│            Hardware Ghost Protocol (offline-first)        │
│  IndexedDB → encrypted burst → cloud (when online)        │
└────────────────────────────────────────────────────────────┘
```

---

## 9. Module Inventory

```
evenkeel/
├── EVENKEEL_BIBLE.md           ← this file
├── README.md                    ← short intro pointing here
├── package.json                 ← name: "evenkeel"
│
├── app/                         ← Next.js App Router
│   ├── layout.tsx               ← root + ThemeProvider mount
│   ├── globals.css              ← Paper + Sovereign tokens
│   ├── page.tsx                 ← marketing landing + role picker
│   ├── auth/page.tsx            ← Triad Handshake
│   ├── student/page.tsx         ← Paper theme
│   ├── teacher/page.tsx         ← Sovereign theme
│   ├── parent/page.tsx          ← Paper theme
│   ├── compliance/page.tsx      ← Sovereign theme (Principal)
│   ├── adult/page.tsx           ← Paper professional
│   └── trades/page.tsx          ← Paper industrial
│
├── components/
│   ├── shared/                  ← cross-surface
│   │   ├── ThemeProvider.tsx
│   │   ├── EkeChat.tsx
│   │   ├── CurriculumPicker.tsx
│   │   ├── SubjectGrid.tsx
│   │   └── BoxInBoxNode.tsx
│   ├── auth/TriadHandshake.tsx
│   ├── student/                 ← refactored, uses shared
│   ├── teacher/                 ← refactored, includes BoxInBoxNode
│   ├── parent/                  ← + SafetyCentre.tsx
│   ├── compliance/              ← NEW
│   │   ├── ComplianceDashboard.tsx
│   │   ├── CompliancePulse.tsx
│   │   ├── ResolutionTray.tsx
│   │   ├── ConflictDetail.tsx
│   │   ├── AuditVault.tsx
│   │   └── IntegrityLedger.tsx
│   ├── adult/                   ← NEW
│   │   ├── AdultDashboard.tsx
│   │   └── CertificationTracker.tsx
│   ├── trades/                  ← NEW
│   │   ├── TradesDashboard.tsx
│   │   ├── HandsOnLog.tsx
│   │   └── SkillForge.tsx
│   └── charts/LiveEffortChart.tsx
│
└── lib/
    ├── types/index.ts           ← canonical interfaces
    ├── crypto/hash.ts
    ├── zero-knowledge/aggregator.ts
    ├── eke/                    ← NEW (renamed from slmscaffolding)
    │   ├── eke-engine.ts
    │   ├── tiered-hints.ts
    │   └── personality.ts
    ├── vertolearn/              ← CRT, IPA, mimicry, ghost
    │   ├── crt-logger.ts
    │   ├── ipa-analyzer.ts
    │   ├── neutrality-shield.ts
    │   ├── hardware-ghost.ts
    │   └── slmscaffolding.ts    ← thin re-export shim → eke/
    ├── regulatory-absorb/       ← NEW
    │   ├── types.ts
    │   ├── decision-gate.ts
    │   ├── prioritizer.ts
    │   ├── adapter-mock.ts
    │   └── jurisdictions.ts
    └── career/trace-to-trait.ts
```

---

## 10. Canonical Data Models

```ts
// User & roles ----------------------------------------------------------
export type UserRole =
  | "student"
  | "teacher"
  | "parent"
  | "compliance_officer"   // Principal / Designated Safeguarding Lead
  | "adult_learner"
  | "apprentice";

export interface User {
  id: string;
  role: UserRole;
  displayName: string;     // first name only for minors
  gradeBand?: string;      // e.g. "Y9-11" for kids; "Adult" for adults
  jurisdiction: string;    // ISO: IE, GB, US, PE, BR, IN
  publicKey: string;
  credentialId: string;
  createdAt: number;
  lastLogin: number;
}

// CRT ------------------------------------------------------------------
export interface CRTEvent {
  id: string;
  timestamp: number;
  eventType:
    | "start" | "pause" | "deletion" | "pivot"
    | "submission" | "hint_request"
    | "focus_gain" | "focus_loss";
  duration?: number;
  data?: unknown;
  hash: string;
}

export interface CognitiveReasoningTrace {
  studentId: string;
  sessionId: string;
  problemId: string;
  events: CRTEvent[];
  startTime: number;
  endTime?: number;
  totalThinkTime: number;
  deletionCount: number;
  pivotCount: number;
  proofOfWorkHash: string;
  signature?: string;     // ECDSA P-256 / SHA-256, IEEE-P1363 r||s, base64url
}

// Interaction & Career --------------------------------------------------
export interface InteractionPattern { /* see lib/types */ }
export interface CareerDNA          { /* see lib/types */ }
```

---

## 11. CRT Schema v1.2

A canonical, signed, tamper-evident record of one learning session. Stored hashes — never PII content.

```jsonc
{
  "crt_version": "1.2",
  "session_id": "phys_vec_09",
  "student_id_hash": "0xa1b2…",       // never raw ID
  "jurisdiction": "IE",
  "behavioral_signals": {
    "latency_ms": 4120,                // avg keystroke think-time
    "paste_events": false,
    "revision_count": 3,
    "deletion_count": 24,
    "idle_time_s": 45,
    "struggle_duration_s": 142
  },
  "pedagogical_event": {
    "type": "comprehension_gate_cleared",
    "hint_level_used": 0,              // 0-3, 0 = no hint
    "action_taken": "deployed_hint_level_2"
  },
  "neutrality_shield": {
    "flaw_detected": false,
    "frustration_score": 0.18
  },
  "state": "verified_mastery",         // or "unresolved_pending_input"
  "cryptography": {
    "algorithm": "ECDSA-P256-SHA256",
    "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQc…",  // SPKI, base64url
    "contentDigest": "oL5Lp6…",                        // base64url(SHA-256(canonical-payload))
    "signature": "e3b0c44298fc1c149afbf4c8996fb924…", // base64url(r||s)
    "signedAtIso": "2026-04-26T13:42:05.123Z"
  }
}
```

**Field contract:**

| Field | Required | Notes |
|---|---|---|
| `crt_version` | yes | semver |
| `student_id_hash` | yes | SHA-256 of (studentId + per-org salt). Never store raw ID. |
| `behavioral_signals.latency_ms` | yes | input to mimicry detector |
| `behavioral_signals.paste_events` | yes | hard fail if true on a comprehension gate |
| `pedagogical_event.hint_level_used` | yes | 0–3, drives Career DNA resilience scoring |
| `cryptography.algorithm` | yes | `"ECDSA-P256-SHA256"` today (WebCrypto-native, universal browser support, aligned with WebAuthn passkeys). Tracked for migration to a hybrid post-quantum signature in Phase 2 — see §25. |
| `cryptography.signature` | yes (post-MVP) | Raw ECDSA `r\|\|s` bytes (IEEE-P1363), base64url-encoded. Signs `cryptography.contentDigest`, which is `base64url(SHA-256(canonical-payload))`. |
| `cryptography.publicKey` | yes (post-MVP) | SubjectPublicKeyInfo of the signing key, base64url. The verifier needs this; for the v1 demo it is a per-tab session key, not tied to an identity. |

---

## 12. Eke AI Contract

Eke **must**:
- Provide hints in exactly 3 tiers, escalating from "ask back" → "scaffold" → "specific concept reminder".
- Refuse direct answers. Validators reject any hint string that contains a numeric value present in the answer key.
- Track hint usage in the CRT.
- Adapt tone based on surface (mentor / peer / foreman).
- Enforce zero-paste on comprehension gates.

Eke **must not**:
- Generate or display the final answer.
- Personify a real person or a copyrighted character.
- Continue answering once a Decision Gate (see §13) has flagged the input.
- Store raw student input in the CRT — only hashes and behavioral signals.

### 12.1 Tiered Hints

| Tier | Strategy | Example |
|---|---|---|
| 1 | Reverse the question | *"What's the first thing you'd write down here?"* |
| 2 | Reframe / decompose | *"Could you break this into two smaller problems?"* |
| 3 | Concept reminder (no values) | *"This belongs to the family of substitution problems — does that help?"* |

### 12.2 Mimicry Guard

Triggered if all of:
- avg keystroke interval < 50ms
- standard deviation of keystroke cadence < 30ms
- paste events > 0 OR focus loss events > 3

Action: Eke pauses, logs `mimicry_suspected` to CRT, and asks the student to paraphrase their last working step verbally (or in their own typed words). No accusation language is shown to the student.

---

## 13. Regulatory Absorb V2 Integration Contract

Even Keel Learning consumes Regulatory Absorb V2 as an **external service** (or, in v1, a mock in-memory adapter). We document the *interface*, not Datacendia internals.

### 13.1 Types

```ts
export type RegulatorySeverity = "critical" | "high" | "medium" | "low";

export interface RequirementV2 {
  id: string;
  jurisdiction: string;       // "IE" | "EU" | "GB" | "US" | "PE" | "BR" | "IN" | …
  documentRef: string;        // "DPA_2018_S31" | "GDPR_ART8" …
  severity: RegulatorySeverity;
  triggerType: "data_collection" | "age_gate" | "consent" | "retention" | "biometric" | "ai_disclosure" | "advertising";
  constraint: string;         // human-readable rule
  penalty?: string;
}

export type ConflictResolution =
  | "UNRESOLVED"
  | "RESOLVED_PRIORITY"
  | "RESOLVED_MERGED"
  | "RESOLVED_EXCEPTION"
  | "FALSE_POSITIVE";

export interface RegulatoryConflict {
  id: string;
  requirementA: RequirementV2;
  requirementB: RequirementV2;
  conflictType: "DIRECT" | "POTENTIAL" | "SUPERSEDED";
  resolutionStatus: ConflictResolution;
  recommendedResolution?: string;
  resolvedBy?: string;        // compliance officer userId
  resolvedAt?: number;
  signature?: string;
  generatedJustification?: string;
}

export interface AbsorptionResultV2 {
  sourceDocument: string;
  jurisdiction: string;
  requirements: RequirementV2[];
  conflicts: RegulatoryConflict[];
  confidenceScore: number;    // 0..1
  verificationRecommendations: string[];
}
```

### 13.2 Decision Gate API

```ts
checkSafety(input: {
  text: string;
  jurisdiction: string;
  studentAgeBand?: string;
}): SafetyResponse;

interface SafetyResponse {
  allow: boolean;
  blockedBy?: RequirementV2;
  triggerType?: RequirementV2["triggerType"];
  userMessage?: string;       // age-appropriate explanation
}
```

Eke calls `checkSafety()` before every response. Any `allow: false` halts generation and surfaces `userMessage`.

### 13.3 "Most Restrictive" Auto-Prioritize Algorithm

```
score(req) = severityWeight[req.severity]                  // critical=100, high=75, med=50, low=25
           + jurisdictionWeight[req.jurisdiction]          // EU=30, IE=25, GB=20, PE=18, US=15, …
           + (10 if req.jurisdiction == student.jurisdiction)   // local override

resolveConflict(a, b):
    if score(a) > score(b):  prioritise a, suppress b
    if score(b) > score(a):  prioritise b, suppress a
    if tied:                 default to RESOLVED_MERGED (most restrictive subset)
    persist as RESOLVED_PRIORITY with signature + justification
```

### 13.4 Conflict Severity → Action

| Conflict | Action |
|---|---|
| `DIRECT` | Block feature activation. Compliance Officer must sign. |
| `POTENTIAL` | Allow with auto-`RESOLVED_PRIORITY`. Show amber banner to officer. |
| `SUPERSEDED` | Auto-archive older requirement. Log only. |

---

## 14. Role Permission Matrix

| Capability | Student | Teacher | Parent | Compliance Officer | Adult Learner | Apprentice |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View own CRT | ✅ | — | — | — | ✅ | ✅ |
| View child's CRT (high-level) | — | — | ✅ | — | — | — |
| View class CRTs (anonymized) | — | ✅ | — | ✅ | — | — |
| Audit Playback | — | ✅ | — | ✅ | — | — |
| Push Logic Bridge to class | — | ✅ | — | — | — | — |
| Resolve regulatory conflict | — | — | — | ✅ | — | — |
| Sign attestation | — | — | — | ✅ | — | — |
| Export Audit Vault | — | — | — | ✅ | — | — |
| Set screen-time / bedtime | — | — | ✅ | — | — | — |
| Trigger data deletion (GDPR Art 17) | — | — | ✅ | ✅ | ✅ | ✅ |
| Hands-on log (voice/photo) | — | — | — | — | — | ✅ |
| Career DNA export | ✅ | — | ✅ | — | ✅ | ✅ |

---

## 15. Hardware Ghost Protocol

Offline-first by design. If the network drops, the local SLM stub continues to run and Eke's tiered hints remain available.

- **Local store:** IndexedDB via `idb`. The schema name is `LuminaryOfflineDB` (legacy from the previous product name). It is intentionally not renamed because doing so would force a schema migration for any existing local data; see HONESTY.md §4.3.
- **Object stores:** `syncQueue`, `localTraces`, `localPatterns`.
- **Sync interval:** 30s when online.
- **Encryption boundary:** all queued items pass through `encryptData()` (Web Crypto API in production; JSON stringify in v1 mock).
- **Burst behavior:** on `online` event, the queue is flushed in chronological order with retry-up-to-5.

---

## 16. Theme System

Single `app/globals.css` defines both palettes via `[data-theme]` attribute on `<html>`.

- `<ThemeProvider theme="paper">` for student/parent/adult/trades/marketing
- `<ThemeProvider theme="sovereign">` for teacher/compliance

Component authoring rules:
1. Never hard-code hex colors. Always reference CSS variables.
2. Components live in `components/shared/` only if they render correctly under both themes.
3. Surface-specific components (`components/teacher/StruggleMap.tsx`) may assume a single theme.

---

## 17. Performance & Privacy Budget

| Metric | Budget |
|---|---|
| Time-to-interactive (student page) | < 2.5s on mid-tier laptop |
| CRT event log size | < 5KB / session |
| PII fields stored | 0 (only hashes + behavioral signals) |
| 3rd-party network calls | 0 from learner surfaces (Eke is local/edge in production) |
| Cookies | session-only, no advertising |

---

# Part III — Compliance, Safety & Pilot

## 18. Jurisdiction Map

(Excerpt — full mapping lives in `lib/regulatory-absorb/jurisdictions.ts`.)

| Jurisdiction | Statute | Digital Age of Consent | Key Trigger |
|---|---|---|---|
| Ireland | Data Protection Act 2018 + GDPR | 16 | Strict parental consent for under-16; school as controller |
| EU | GDPR (Art. 8) + AI Act | 16 (member state can lower to 13) | "Information society services" definition |
| United Kingdom | DPA 2018 + Online Safety Act 2023 | 13 | Highly-effective age assurance for child users |
| United States | COPPA + KOSA (2024) | 13 | Verifiable parental consent under 13 |
| Peru | Ley 29733 + Reglamento | 14 | Tutor authorization for under-14; data sovereignty rules |
| Brazil | LGPD + ECA | 12 (with parental consent up to 18) | Best-interest-of-child principle |
| India | DPDP Act 2023 | 18 | Verifiable parental consent for ALL minors |

---

## 19. Compliance Officer Role

The Compliance Officer is the school's Principal (or Designated Safeguarding Lead). They are the legal signatory for the platform's behavior in their jurisdiction.

### 19.1 Sovereign View Dashboard

Three primary panels:

1. **Compliance Pulse** — single 0–100 score derived from `(1 - unresolvedCriticalCount / totalRequirements) * 100`.
2. **Resolution Tray** — queue of `UNRESOLVED` conflicts awaiting signature.
3. **Audit Vault** — searchable log of every signed resolution, exportable as PDF (the "Verto Warrant").

Plus an **Integrity Ledger** live tail (events streaming in mono font, reminiscent of an `osquery` console).

### 19.2 Resolution Workflow

1. **Notification.** Banner: *"Critical Regulatory Conflict Detected: Data Retention vs. Right to Erasure."*
2. **Evidence.** Side-by-side `RequirementV2` snippets with `documentRef`.
3. **Recommendation.** Auto-generated by Most-Restrictive logic: *"Recommendation: RESOLVED_PRIORITY. Default to Irish DPA 2018 (local jurisdiction +10 weight)."*
4. **Justification.** Plain-English explanation generated for the audit trail.
5. **One-click attestation.** Compliance Officer clicks **Sign & Authorize**. The conflict is signed with **ECDSA P-256 / SHA-256** via the browser's WebCrypto API (real today — see `lib/crypto/signing.ts`); the signature, public key, content digest, ISO timestamp and algorithm label are all recorded on the conflict and moved to the Audit Vault, where they can be re-verified in-page. ECDSA P-256 was chosen for universal `SubtleCrypto` support and alignment with WebAuthn passkeys; a hybrid post-quantum upgrade is on the Phase 2 roadmap (§25).

### 19.3 Pre-Vetting (Laura's role)

Laura (or any user with role `compliance_admin` — a future extension) may **pre-vet** resolutions. Pre-vetted items appear in the Officer's tray with a "Recommended by Education Lead" tag, requiring only second-signature.

---

## 20. "Most Restrictive" Conflict Logic

### Worked example: GDPR-K vs. UK Online Safety Act on data retention

| Requirement | Jurisdiction | Severity | Score |
|---|---|---|---|
| A: GDPR-K Art. 5(e) — minimize retention | EU | high | 75 + 30 = **105** |
| B: UK OSA — retain abuse-detection signals 6mo | GB | medium | 50 + 20 = **70** |

If the student is in **Ireland** (`jurisdiction = IE`), neither A nor B gets the local-override +10. A wins with score 105 → `RESOLVED_PRIORITY` for GDPR-K.

If the student is in **the UK** (`jurisdiction = GB`), B gets +10 = 80; A still wins with 105. GDPR-K still applies (because Ireland is in the EU and the student is in the UK).

If both rules tie, fall back to `RESOLVED_MERGED` (apply the strictest subset — in retention conflicts, this means the *shorter* retention period wins).

---

## 21. Safety Centre (Parent)

A dedicated tab on the Parent dashboard.

| Control | Description |
|---|---|
| **Screen time** | Per-day cap; auto-pause Eke |
| **Bedtime mode** | Hard shutdown 21:00–07:00 (configurable) |
| **Crisis notifications** | Push + email + SMS when crisis-detection engine fires |
| **Right to Erasure** | One-click full deletion (GDPR Art. 17) — wipes local IndexedDB and cloud queues |
| **Data export** | Download all of the child's CRTs as signed JSON |
| **Tone preference** | Set Eke to mentor/peer (defaults by age) |

---

## 22. Child Safety Principles

Non-negotiable. Apply on every tier including free.

1. **No biometrics.** Ever. No camera-based engagement detection, no facial sentiment, no voice-print ID.
2. **No advertising.** No banner ads, no sponsored content, no affiliate links. Period.
3. **PII minimization.** A student profile holds: first name, grade band, jurisdiction. Nothing else.
4. **No DM-style chat with strangers.** Eke is the only conversational entity available to a student; Eke is bound by the contract in §12.
5. **Age-gated access.** Spark/Family tiers gate by parent-attested grade band; School tier inherits the school's age verification.
6. **Crisis-first content moderation.** See §23.

The operational implementation of these principles, the test files that pin minimum coverage, and the residual gaps are documented in **[`SAFEGUARDING.md`](./SAFEGUARDING.md)**. As of v1.3.0 the shipped code includes: a 17-pattern crisis lexicon (§23 v1), the `RoleGuard` passphrase gate on `/teacher` and `/compliance`, the self-declared `AgeBandGate` on `/student` (with guardian-acknowledgement for under-13s), an **assistive-input exemption** in the IPA mimicry detector so users of eye-gaze, switch, dictation, sticky-keys, or word-prediction tools are never falsely flagged as AI-mimicking (`SAFEGUARDING.md` §1.5), and a **WCAG 2.2 AA accessibility settings layer** with dyslexia-friendly typography, focus mode, high contrast, and full keyboard / screen-reader support (`SAFEGUARDING.md` §1.6). Verifiable parental consent (COPPA §312.5) and WebAuthn passkey auth are tracked as Phase 2.

---

## 23. Crisis Detection & Escalation

Even Keel Learning ships a **crisis classifier** that monitors student input for signals of:
- self-harm ideation
- safeguarding concerns (abuse disclosure)
- acute distress

### 23.1 v1 — Rules-based (shipped)

The v1 classifier is a **17-regex lexicon plus an emoji+negative-affect rule** living in `lib/regulatory-absorb/decision-gate.ts`. It covers direct verbs, obfuscated forms (`k*ll`, `kys`), indirect distress idioms ("don't want to wake up", "nobody would miss me"), and emoji pairings (🔪💊🩸🪢🔫 alongside hopeless/empty/numb/dark). False-positive prevention is unit-tested: academic uses ("the theme of suicide in Shakespeare") and recipe context (kitchen-knife emoji in a recipe) explicitly do **not** block. Coverage and tests are documented in **[`SAFEGUARDING.md`](./SAFEGUARDING.md) §1**.

### 23.2 v2 — ML-augmented (Phase 2)

Locale-specific lexicons + a small classifier + multi-turn analysis. Tracked in §25.

### 23.3 Escalation flow (the "Red Phone")

When triggered:
1. Eke immediately switches to a **safe response template** with country-specific helpline (e.g., Childline Ireland 1800 66 66 66). **Shipped.**
2. The event is escalated **directly** to the Compliance Officer (Principal) via push + SMS, **bypassing** the teacher dashboard. **Phase 2** — today the event publishes to the local data bus; the out-of-band notification consumer is not built (see SAFEGUARDING.md §1).
3. The parent is notified per their Safety Centre preferences. **Phase 2** for the same reason.
4. The CRT is flagged but the *content* is not stored — only the classification + timestamp. **Shipped** by virtue of the Decision Gate short-circuit firing before the engine sees the input.

---

## 24. Pilot Operations Plan

12-week Dublin pilot. Two schools. Maths + English. 60–80 students per school.

| Week | Milestone |
|---|---|
| 1 | Triad onboarding (Principal as Compliance Officer signs initial absorption result) |
| 2 | Student first-use; baseline CRT captured |
| 3–4 | Teacher daily-use; first 7:00 AM Briefings delivered |
| 5 | Mid-pilot KPI snapshot: Resilience Delta, Integrity Pulse |
| 6 | First Logic Bridge intervention by a teacher |
| 7–8 | Parent activation: Safety Centre walk-throughs |
| 9 | First Career DNA export per student |
| 10 | Audit Vault export — Compliance Officer signs full pilot attestation |
| 11 | Case-study interviews + qualitative survey |
| 12 | Pilot wrap-up; renewal/expansion proposal |

**Primary KPIs:**

| KPI | Definition | Target |
|---|---|---|
| Resilience Delta | Avg recovery-from-friction time, baseline vs. week 12 | ≥ +10% improvement |
| Integrity Pulse | % of submissions with mimicry score < 0.3 | ≥ 95% |
| Cognitive Friction | Class-wide weekly average of `frustration_score` | Trending down |
| Hint Tier Distribution | % of sessions where Tier-3 was reached | < 25% (means scaffolding is working) |
| Compliance Conflicts Resolved | Count of `UNRESOLVED → RESOLVED_*` per Officer | 100% within 48h |

---

## 25. Roadmap

### Phase 1 — MVP (shipped, v1.0.0)
- Five surfaces, both themes, Eke stubbed with rule-based hints ✅
- Mock Regulatory Absorb V2 adapter ✅
- IndexedDB Hardware Ghost ✅
- Triad Handshake (mock FIDO2) ✅

### Phase 1.5 — Enterprise audit framework + safeguarding (shipped, v1.1.0 / v1.2.0)
- Real ECDSA P-256 signing wired into Compliance Audit Vault ✅
- Cross-surface event bus (BroadcastChannel + localStorage) ✅
- 56-assertion vitest suite + Playwright e2e + GitHub Actions CI ✅
- Audit manifest emitter with SOC 2 / ISO 27001 control tags ✅
- Expanded crisis lexicon (17 regex patterns + emoji+affect rule) ✅
- `RoleGuard` passphrase gate on `/teacher`, `/compliance` ✅
- `AgeBandGate` self-declaration with guardian-ack for under-13 ✅
- `SAFEGUARDING.md` policy, `SECURITY.md` updates, `HONESTY.md` ledger ✅

### Phase 1.3 — Higher-maths capability stack (shipped, v1.5.3)
- **Move vocabulary v2:** Extended parser to support square both sides, apply function (log, ln, sin, cos, tan, sqrt), variable operands ✅
- **Heavy CAS dispatcher:** Pyodide + Sympy escalation when math.js returns inconclusive verdicts ✅
- **Authored figures:** JSXGraph-renderable figures integrated into content schema with validation ✅
- First authored figure embedded in `maths.linear-eq-1var` pack ✅
- 53-unit test suite covering move vocab, heavy CAS, and figures ✅

### Phase 1.4 — Surface completion (NOT STARTED)
**Critical blocker: The platform cannot be pilot-ready until surfaces are connected to real data.**

- **Student surface:**
  - Wire CRT capture to IndexedDB (persist events, sign with session key)
  - Dynamic problem selection based on curriculum/jurisdiction
  - Real comprehension gates with hint tier tracking
  - Connect EkeChat to tiered hints engine (currently rule-based stub)
- **Parent surface:**
  - Connect Shadow Feed to child's real CRT events
  - Implement translation layer: "your child struggled with substitution for 3 minutes, here's what that means"
  - Wire Safety Centre toggles to actual enforcement (screen time cap, bedtime mode)
  - Connect Career DNA to actual CRT analysis (not decorative traits)
- **Teacher surface:**
  - Wire Struggle Map to real class CRT data
  - Implement Logic Bridge (push hint/video to class subset)
  - Connect BoxInBoxNode to real CRT playback data
- **Curriculum system:**
  - Implement auto curriculum update (fetch, validate, update from external sources)
  - Wire CurriculumPicker to content filtering
  - Add curriculum metadata to content packs
  - Support multiple curricula per jurisdiction

### Phase 2 — Pilot ready (Q+1, DEPENDS ON PHASE 1.4)
- Real FIDO2 / WebAuthn (`@simplewebauthn`) — replaces RoleGuard passphrase
- Verifiable parental consent (email-OTP / KYC / school roster) — replaces self-declared AgeBandGate
- Real SLM serving (on-device via WebGPU; fallback to edge LLM)
- Datacendia Regulatory Absorb V2 HTTP integration (replaces `adapter-mock.ts`)
- Out-of-band DSL notification queue for crisis events
- Crisis classifier ML model + locale-specific lexicons
- Persistent KMS-backed signing key per institution
- **Hybrid post-quantum signing** — retain ECDSA P-256 and add ML-DSA-65 (Dilithium) alongside it via the same `SignedEnvelope` shape. Old envelopes remain verifiable; new envelopes carry both signatures. This skips Ed25519 as an interim algorithmic step (see [Appendix E](#appendix-e--signing-algorithm-rationale)).

### Phase 3 — Scale (Q+2 / +3)
- Mobile (React Native)
- District/MAT-level Compliance Officer aggregation
- Career DNA → University/Employer pathway API
- Peruvian foundation pilot (Ley 29733)
- Trades pilot with SOLAS / City & Guilds

### Phase 4 — Sovereign
- Open-source the CRT schema as an industry standard
- Cross-platform attestation (other EdTech can verify CRTs)
- Regulator-direct API (governments query the Audit Vault)

---

# Appendices

## Appendix A — Glossary

| Term | Definition |
|---|---|
| **CRT** | Cognitive Reasoning Trace — the signed JSON record of a learning session |
| **IPA** | Interaction Pattern Analysis — keystroke cadence + mimicry signals |
| **Eke** | Key Evidence Logic Engine — Even Keel Learning's AI assistant |
| **PTK** | Parents/Teachers/Kids — internal triad framework name |
| **Sovereign OS** | The Teacher + Compliance Officer dark-mode dashboard layer |
| **Box-in-Box** | UI pattern where a node card expands to reveal a nested CRT JSON viewer |
| **Decision Gate** | Pre-response check by Regulatory Absorb on every Eke output |
| **Verto Warrant** | PDF export of the Audit Vault, hand-deliverable to inspectors |
| **Hardware Ghost** | Offline-first local storage + sync protocol |
| **Neutrality Shield** | Frustration-based detector for flawed assignments |
| **Productive Friction** | Even Keel Learning's name for healthy struggle (the goal) |
| **Logic Bridge** | One-click teacher intervention pushing a hint/video to a class subset |

## Appendix B — Naming Alternatives

If Even Keel Learning or Eke must change (trademark conflict, market test, co-founder preference):

| Backup Platform | Rationale |
|---|---|
| **TraceLearn** / **TraceOS** | Most literal — names the CRT itself |
| **ArcLearn** | High energy, welding/trades resonance, "arc of growth" |
| **VerisLearn** | Latin *verus* = truth; clean academic tone |
| **SpireLearn** | Vertical aspiration, academic resonance |
| **BeamLearn** | Structural strength + light/clarity |
| **PlumbOS** | Trades-friendly = "true & vertical" |

| Backup AI | Rationale |
|---|---|
| **ALe** | Same vibe as Eke, different mouth-feel |
| **Verto** | If we promote the engine name to the assistant's name |
| **Trace** | Direct: *"Ask Trace."* |

## Appendix C — Co-founder Proposal

See `evenkeel-cofounder-proposal.docx` (legacy filename `luminary-cofounder-proposal.docx`).

## Appendix D — Open Questions

1. Eke pronunciation — formalize as "KAY-lee" (Céilí resonance) or "KELL-eh" (cleaner globally)?
2. Compliance Officer — single sign-off or dual sign-off (Principal + Education Lead) for `DIRECT` conflicts?
3. Trades pilot — single trade showcase (welding) or multi-trade selector at launch?
4. Free-tier fair-use — one child per household by ID, or one child per device?
5. Bible governance — who owns version control? Proposed: changes to Part II require Stuart's sign-off; Part I and III require Laura's sign-off; Part III §18 (Jurisdictions) requires both.

---

## Appendix E — Signing Algorithm Rationale

Why Even Keel Learning ships **ECDSA P-256 / SHA-256** today, not Ed25519:

1. **Universal `SubtleCrypto` support.** ECDSA P-256 is implemented in every browser version we care to support. Ed25519 in `SubtleCrypto` only landed in Chrome 137, Safari 17, and Firefox 130; older school-issued laptops and managed Chromebooks would silently fail.
2. **WebAuthn alignment.** Passkeys (the Phase 2 replacement for `RoleGuard`) almost universally return ECDSA P-256 (`COSE alg = -7`). Ed25519 (`-8`) is optional and many authenticators do not expose it. Aligning CRT-signing with passkey-signing means one algorithm across the platform.
3. **HSM and PIV portability.** Every HSM, every YubiKey 4/5, and every government PIV smart card supports ECDSA P-256. Ed25519 hardware support is newer and patchy.
4. **No security delta in our usage.** ECDSA's historical footguns (RNG-reuse attacks like Sony PS3, 2013 Android Bitcoin wallets) are implementation bugs in third-party libraries, not flaws in the algorithm. WebCrypto is a vetted browser-native implementation backed by the OS entropy source and is the same code path that secures every HTTPS handshake. Both algorithms target ~128-bit security and are unbroken.
5. **Standards posture.** ECDSA P-256 is FIPS 186-4 / 186-5, eIDAS, BSI, and ANSSI approved. Ed25519 is FIPS 186-5 (added 2023), eIDAS approved. Neither carries a regulatory advantage in any Even Keel Learning jurisdiction.
6. **The real upgrade is post-quantum, not Ed25519.** Both ECDSA and Ed25519 fall to Shor's algorithm. Phase 2 therefore skips Ed25519 and goes directly to a hybrid scheme (ECDSA-P256 + ML-DSA-65), preserving the audit trail of envelopes already signed with ECDSA.

This decision is recorded so future contributors don't re-litigate it on aesthetics. **The contract that matters is the `SignedEnvelope` shape** (algorithm label, public key, content digest, signature, signed-at timestamp), which is algorithm-agnostic. The inner algorithm can be rotated forward without breaking verifiers as long as they reject envelopes whose `algorithm` they don't recognise.

---

*End of Even Keel Learning Bible v1.0.*
