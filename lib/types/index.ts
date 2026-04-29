// ─────────────────────────────────────────────────────────────────────────────
// lib/types/index.ts
//
// Canonical TypeScript shapes shared by every layer of the platform.
//
// Anything exported from here is treated as the *contract* between the
// surfaces (`app/`), the engines (`lib/eke`, `lib/vertolearn`,
// `lib/regulatory-absorb`, `lib/career`) and any future server-side
// implementation. Changes here should be considered API-breaking and audited
// against EVENKEEL_BIBLE.md §10 ("Schemas").
// ─────────────────────────────────────────────────────────────────────────────

export interface CRTEvent {
  id: string;
  timestamp: number;
  eventType: "start" | "pause" | "deletion" | "pivot" | "submission" | "hint_request" | "focus_gain" | "focus_loss";
  duration?: number;
  data?: any;
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
}

export interface InteractionPattern {
  studentId: string;
  sessionId: string;
  averageThinkTime: number;
  keystrokeCadence: number[];
  pasteAttempts: number;
  /**
   * 0..1 score from the IPA heuristic. Higher = more likely AI-mimicked.
   * Field name is `mimicryProbability` (was previously misspelled
   * `mimcryProbability`; renamed 2026-04-26).
   */
  mimicryProbability: number;
  isSuspicious: boolean;
  /**
   * `true` when the user declared they use assistive input technology
   * (eye-gaze, switch, dictation, word-prediction, sticky-keys). Causes
   * the IPA cadence components to be suppressed so the user is not
   * misclassified as AI-mimicking. Recorded on every pattern emitted
   * after v1.3.0 for audit explainability. See SAFEGUARDING.md §1.5.
   */
  assistiveInputDeclared?: boolean;
}

export type UserRole =
  | "student"
  | "teacher"
  | "parent"
  | "compliance_officer"
  | "adult_learner"
  | "apprentice";

export interface User {
  id: string;
  role: UserRole;
  displayName: string;
  email?: string;
  gradeBand?: string;
  jurisdiction: string; // ISO: IE, GB, US, PE, BR, IN, EU
  publicKey: string;
  credentialId: string;
  createdAt: number;
  lastLogin: number;
}

export interface TriadVerification {
  studentId: string;
  teacherId: string;
  parentId: string;
  verificationToken: string;
  status: "pending" | "verified" | "expired";
  createdAt: number;
  expiresAt: number;
}

export interface CareerDNATrait {
  trait: "analytical" | "resilience" | "creative_entropy" | "collaboration" | "adaptability";
  score: number;
  trend: "improving" | "stable" | "declining";
  evidence: string[];
}

export interface CareerDNA {
  studentId: string;
  traits: CareerDNATrait[];
  universityMatches: UniversityPathway[];
  vocationalMatches: VocationalPathway[];
  lastUpdated: number;
}

export interface UniversityPathway {
  institution: string;
  matchScore: number;
  recommendedPrograms: string[];
  crtCorrelation: number;
}

export interface VocationalPathway {
  company: string;
  apprenticeship: string;
  matchScore: number;
  requiredSkills: string[];
  crtCorrelation: number;
}

export interface SocraticHint {
  tier: 1 | 2 | 3;
  content: string;
  isRevealed: boolean;
  timestamp: number;
}

export interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  subject: string;
  hints: SocraticHint[];
  hasFlaws: boolean;
  flawDetected?: boolean;
}

export interface ClassStruggleMap {
  classId: string;
  timestamp: number;
  students: {
    studentId: string;
    status: "blocked" | "struggling" | "mastered";
    currentProblem: string;
    frictionLevel: number;
  }[];
  classWideFriction: {
    problemId: string;
    blockedCount: number;
    strugglingCount: number;
  }[];
}

export interface DinnerTablePrompt {
  studentId: string;
  prompt: string;
  context: string;
  generatedAt: number;
}
