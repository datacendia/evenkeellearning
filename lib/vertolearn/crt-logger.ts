// ─────────────────────────────────────────────────────────────────────────────
// lib/vertolearn/crt-logger.ts
//
// Cognitive Reasoning Trace logger. The "black box" of a learning session:
// every pause, deletion, pivot, hint request and submission gets a
// timestamped, hashed event entry. At session end, `finalize()` produces a
// proof-of-work hash over the sorted event stream that is suitable for
// display, audit and (with `lib/crypto/signing.ts`) signing.
//
// HONESTY
// ───────
// The proof-of-work is a SHA-256 over the event array, not a digital
// signature. It proves *integrity* (events have not been tampered with) but
// not *authorship* (it does not bind to a key). Pair it with `signPayload`
// from `lib/crypto/signing.ts` to add authorship.
//
// This module is currently exported and tested but not yet called from the
// student page; see HONESTY.md §4.2.
// ─────────────────────────────────────────────────────────────────────────────

import { CRTEvent, CognitiveReasoningTrace } from "../types";
import { generateHash, generateProofOfWork } from "../crypto/hash";

export class CRTLogger {
  private events: CRTEvent[] = [];
  private sessionId: string;
  private studentId: string;
  private problemId: string;
  private startTime: number;

  constructor(studentId: string, problemId: string) {
    this.studentId = studentId;
    this.problemId = problemId;
    this.sessionId = generateHash({ studentId, problemId, timestamp: Date.now() });
    this.startTime = Date.now();
    this.logEvent("start", { problemId });
  }

  logEvent(eventType: CRTEvent["eventType"], data?: any, duration?: number): void {
    const event: CRTEvent = {
      id: generateHash({ sessionId: this.sessionId, timestamp: Date.now(), eventType }),
      timestamp: Date.now(),
      eventType,
      duration,
      data,
      hash: generateHash({ eventType, data, duration, timestamp: Date.now() }),
    };
    this.events.push(event);
  }

  logPause(duration: number): void {
    this.logEvent("pause", undefined, duration);
  }

  logDeletion(characterCount: number): void {
    this.logEvent("deletion", { characterCount });
  }

  logPivot(fromApproach: string, toApproach: string): void {
    this.logEvent("pivot", { fromApproach, toApproach });
  }

  logHintRequest(tier: number): void {
    this.logEvent("hint_request", { tier });
  }

  logSubmission(answer: string): void {
    this.logEvent("submission", { answerHash: generateHash(answer) });
  }

  logFocusGain(): void {
    this.logEvent("focus_gain");
  }

  logFocusLoss(): void {
    this.logEvent("focus_loss");
  }

  finalizeTrace(): CognitiveReasoningTrace {
    const endTime = Date.now();
    const totalThinkTime = this.calculateTotalThinkTime();
    const deletionCount = this.events.filter(e => e.eventType === "deletion").length;
    const pivotCount = this.events.filter(e => e.eventType === "pivot").length;
    const proofOfWorkHash = generateProofOfWork(this.events);

    return {
      studentId: this.studentId,
      sessionId: this.sessionId,
      problemId: this.problemId,
      events: this.events,
      startTime: this.startTime,
      endTime,
      totalThinkTime,
      deletionCount,
      pivotCount,
      proofOfWorkHash,
    };
  }

  private calculateTotalThinkTime(): number {
    return this.events
      .filter(e => e.eventType === "pause" && e.duration)
      .reduce((sum, e) => sum + (e.duration || 0), 0);
  }

  getEventCount(): number {
    return this.events.length;
  }

  getCurrentTrace(): Omit<CognitiveReasoningTrace, "endTime" | "totalThinkTime" | "deletionCount" | "pivotCount" | "proofOfWorkHash"> {
    return {
      studentId: this.studentId,
      sessionId: this.sessionId,
      problemId: this.problemId,
      events: this.events,
      startTime: this.startTime,
    };
  }
}

export function createCRTLogger(studentId: string, problemId: string): CRTLogger {
  return new CRTLogger(studentId, problemId);
}
