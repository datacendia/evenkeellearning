// ─────────────────────────────────────────────────────────────────────────────
// lib/validators.ts
//
// Runtime validators for the platform's most important shapes. These are the
// belt-and-braces companion to the TypeScript types: TS catches bugs at build
// time, these catch bugs at run time when data crosses an untrusted boundary
// (deserialised JSON, network response, postMessage payload, IndexedDB row).
//
// We deliberately do not pull in `zod` to keep the bundle lean. Each
// validator returns a `Result<T>`; on failure, `errors` is non-empty.
//
// Audit mapping
// ─────────────
// Inputs validated here support:
//   • SOC 2 CC6.1 (Logical & Physical Access) — input sanitisation
//   • SOC 2 CC7.1 (System Operations) — boundary validation
//   • ISO 27001 A.8.27 (Secure system architecture) — defence in depth
//   • ISO 27001 A.5.34 (Privacy and PII) — typed PII boundary
//
// Every consumer of an external shape SHOULD wrap the parse with
// `validate*` and propagate the error path rather than blindly using `as`.
// ─────────────────────────────────────────────────────────────────────────────

import type { CRTEvent, InteractionPattern } from "./types";
import type { BusEvent, BusEventType } from "./data-bus";
import type {
  RequirementV2,
  RegulatorySeverity,
  TriggerType,
  RegulatoryConflict,
  ConflictType,
  ConflictResolution,
} from "./regulatory-absorb/types";

/** Result of a validation: either `{ok:true, value}` or `{ok:false, errors}`. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

// ─── Tiny combinators ────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isFiniteOrPositiveInt = (v: unknown): v is number =>
  isNum(v) && Number.isInteger(v) && v >= 0;
const isOneOf = <T extends readonly string[]>(values: T) => (v: unknown): v is T[number] =>
  isStr(v) && (values as readonly string[]).includes(v);

// ─── Regulatory enums ────────────────────────────────────────────────────────

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const TRIGGERS = [
  "data_collection",
  "age_gate",
  "consent",
  "retention",
  "biometric",
  "ai_disclosure",
  "advertising",
  "crisis_response",
] as const;
const CONFLICT_TYPES = ["DIRECT", "POTENTIAL", "SUPERSEDED"] as const;
const CONFLICT_RESOLUTIONS = [
  "UNRESOLVED",
  "RESOLVED_PRIORITY",
  "RESOLVED_MERGED",
  "RESOLVED_EXCEPTION",
  "FALSE_POSITIVE",
] as const;

const isSeverity = isOneOf(SEVERITIES) as (v: unknown) => v is RegulatorySeverity;
const isTrigger = isOneOf(TRIGGERS) as (v: unknown) => v is TriggerType;
const isConflictType = isOneOf(CONFLICT_TYPES) as (v: unknown) => v is ConflictType;
const isResolution = isOneOf(CONFLICT_RESOLUTIONS) as (v: unknown) => v is ConflictResolution;

// ─── CRTEvent ────────────────────────────────────────────────────────────────

const CRT_EVENT_TYPES = [
  "start",
  "pause",
  "deletion",
  "pivot",
  "submission",
  "hint_request",
  "focus_gain",
  "focus_loss",
] as const;

export function validateCRTEvent(input: unknown): Result<CRTEvent> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["not an object"] };
  if (!isStr(input.id)) errors.push("id must be a non-empty string");
  if (!isFiniteOrPositiveInt(input.timestamp)) errors.push("timestamp must be a finite non-negative integer");
  if (!isOneOf(CRT_EVENT_TYPES)(input.eventType)) errors.push(`eventType must be one of ${CRT_EVENT_TYPES.join("|")}`);
  if (!isStr(input.hash)) errors.push("hash must be a non-empty string");
  if (input.duration !== undefined && !isNum(input.duration)) errors.push("duration must be a finite number when present");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as unknown as CRTEvent };
}

// ─── InteractionPattern ──────────────────────────────────────────────────────

export function validateInteractionPattern(input: unknown): Result<InteractionPattern> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["not an object"] };
  if (!isStr(input.studentId)) errors.push("studentId must be a non-empty string");
  if (!isStr(input.sessionId)) errors.push("sessionId must be a non-empty string");
  if (!isNum(input.averageThinkTime) || input.averageThinkTime < 0) errors.push("averageThinkTime must be ≥ 0");
  if (!Array.isArray(input.keystrokeCadence)) errors.push("keystrokeCadence must be an array");
  if (!isFiniteOrPositiveInt(input.pasteAttempts)) errors.push("pasteAttempts must be a non-negative integer");
  const p = (input as Record<string, unknown>).mimicryProbability;
  if (!isNum(p) || p < 0 || p > 1) errors.push("mimicryProbability must be in [0,1]");
  if (typeof input.isSuspicious !== "boolean") errors.push("isSuspicious must be boolean");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as unknown as InteractionPattern };
}

// ─── RequirementV2 / Conflict ────────────────────────────────────────────────

export function validateRequirementV2(input: unknown): Result<RequirementV2> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["not an object"] };
  if (!isStr(input.id)) errors.push("id must be a non-empty string");
  if (!isStr(input.jurisdiction)) errors.push("jurisdiction must be a non-empty string");
  if (!isStr(input.documentRef)) errors.push("documentRef must be a non-empty string");
  if (!isSeverity(input.severity)) errors.push(`severity must be one of ${SEVERITIES.join("|")}`);
  if (!isTrigger(input.triggerType)) errors.push(`triggerType must be one of ${TRIGGERS.join("|")}`);
  if (!isStr(input.constraint)) errors.push("constraint must be a non-empty string");
  if (input.status !== undefined && !["active", "suppressed", "archived"].includes(String(input.status))) {
    errors.push("status must be active|suppressed|archived when present");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as unknown as RequirementV2 };
}

export function validateRegulatoryConflict(input: unknown): Result<RegulatoryConflict> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["not an object"] };
  if (!isStr(input.id)) errors.push("id must be a non-empty string");
  const a = validateRequirementV2(input.requirementA);
  const b = validateRequirementV2(input.requirementB);
  if (!a.ok) errors.push(...a.errors.map((e) => `requirementA: ${e}`));
  if (!b.ok) errors.push(...b.errors.map((e) => `requirementB: ${e}`));
  if (!isConflictType(input.conflictType)) errors.push(`conflictType must be one of ${CONFLICT_TYPES.join("|")}`);
  if (!isResolution(input.resolutionStatus)) errors.push(`resolutionStatus must be one of ${CONFLICT_RESOLUTIONS.join("|")}`);
  if (!isFiniteOrPositiveInt(input.detectedAt)) errors.push("detectedAt must be a non-negative integer");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as unknown as RegulatoryConflict };
}

// ─── BusEvent ────────────────────────────────────────────────────────────────

const BUS_EVENT_TYPES: BusEventType[] = [
  "student.problem.started",
  "student.gate.cleared",
  "student.hint.requested",
  "student.paste.blocked",
  "student.submit",
  "student.crt.signed",
  "teacher.logic_bridge.pushed",
  "teacher.honors.pushed",
  "compliance.conflict.resolved",
  "system.ping",
];

export function validateBusEvent(input: unknown): Result<BusEvent> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["not an object"] };
  if (!BUS_EVENT_TYPES.includes(input.type as BusEventType)) errors.push(`type must be a known BusEventType`);
  if (!isObj(input.payload)) errors.push("payload must be an object");
  if (!isFiniteOrPositiveInt(input.ts)) errors.push("ts must be a non-negative integer");
  if (!isStr(input.id)) errors.push("id must be a non-empty string");
  if (!isStr(input.source)) errors.push("source must be a non-empty string");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: input as unknown as BusEvent };
}

// ─── Helper: throw on failure (for tests / strict callers) ───────────────────

/**
 * Asserts the result is OK; throws an `Error` with all error paths joined
 * otherwise. Useful in tests and in places where the caller has decided
 * that an invalid input is not recoverable.
 */
export function assertOk<T>(result: Result<T>, label = "validation"): T {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.errors.join("; ")}`);
  }
  return result.value;
}
