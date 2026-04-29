import { validateFigureSpec as validateFigureSpecForSchema } from "../geometry/figure-spec";

// ─────────────────────────────────────────────────────────────────────────────
// lib/content/schema.ts
//
// v1.5.0 — The rich content schema introduced as part of the platinum-grade
// authoring pipeline (LLM-drafted, teacher-reviewed, signed-manifest delivery).
//
// DESIGN
// ──────
// Content is **data**, not code. Packs live in `content/packs/*.json` and are
// loaded at runtime from a signed manifest (`content/manifest.json`). At
// learner time the engine still runs deterministic Socratic logic — there is
// no model in the loop. The LLM only operates at *authoring* time, off-stage,
// to draft items that a qualified teacher must then approve before they
// reach the manifest.
//
// HONESTY
// ───────
// • This file defines the *shape* of approved content. It does not generate,
//   modify, or transmit any content at runtime.
// • The schema is a strict superset of v1.4.5's `ParallelProblem`: every
//   existing parallel is expressible here without information loss. The
//   v1.4.5 corpus in `lib/eke/parallel-problems.ts` continues to work
//   unchanged; the new registry merely *also* exposes richer surfaces
//   (explanation, misconceptions, prerequisites, spec points) on top of it.
// • All free-text fields are pre-authored strings. Nothing is templated
//   from learner input. Nothing is concatenated with the answer key.
// • Every approved item carries a reviewer fingerprint (`approval`) and a
//   draft provenance block (`draft`). At manifest verification time the
//   reviewer fingerprint must match a public key on the trusted-reviewers
//   list, otherwise the pack is rejected.
//
// SCHEMA VERSION
// ──────────────
// `schemaVersion` is part of every pack and every item. It is checked at
// load time. A pack with an unknown schemaVersion is loaded read-only and
// flagged in the transparency bundle so the gap is visible.
// ─────────────────────────────────────────────────────────────────────────────

/** Bumped any time the schema changes in a non-additive way. */
export const CONTENT_SCHEMA_VERSION = "1.0.0" as const;

/** Curriculum jurisdiction codes accepted by the schema. Mirrors `app/student`'s picker. */
export type Jurisdiction = "IE" | "UK-EN" | "UK-NI" | "UK-SC" | "UK-WL" | "US" | "INTL";

/** Difficulty band, deliberately coarse (5 buckets) to discourage over-precision. */
export type Difficulty = "foundation" | "core" | "stretch" | "challenge" | "olympiad";

/** Answer-checker categories that misconceptions can key off. Mirrors `lib/validation/answer-checker.ts`. */
export type MisconceptionTrigger =
  | "off_by_one"
  | "sign_flipped"
  | "doubled"
  | "halved"
  | "wrong"
  // Free-form bucket for non-numeric subjects (English, RE, MFL).
  // The runtime never auto-fires these; they surface only when a teacher
  // tags a hint with a matching trigger ID.
  | string;

/** A single Socratic hint in the deterministic 3-tier ladder. */
export interface SchemaHint {
  /** 1 = reverse the question, 2 = decompose, 3 = concept reminder, 4 = parallel. */
  tier: 1 | 2 | 3 | 4;
  /** Pre-authored hint text. Never contains the answer; the leak guard re-checks. */
  text: string;
  /** Optional tag for a misconception this hint specifically addresses. */
  addresses?: MisconceptionTrigger;
}

/** A misconception entry. Surfaced *after* a wrong attempt that matches `trigger`. */
export interface SchemaMisconception {
  /** Stable id within the item. */
  id: string;
  /** Which answer-checker category fires this. */
  trigger: MisconceptionTrigger;
  /** Plain-English explanation of *why* this mistake happens (the core teaching value). */
  explanation: string;
  /** Optional next-step nudge — what to try instead. Never the answer. */
  nudge?: string;
}

/** A fully-worked parallel problem with the same skill shape but different numbers. */
export interface SchemaWorkedExample {
  id: string;
  problem: string;
  workedSolution: string;
  /** The parallel's own answer (used by the leak guard, never displayed). */
  expectedAnswer: number | string;
}

/** Spec-point reference (curriculum alignment). Free-form to span every awarding body. */
export interface SchemaSpecPoint {
  /** Awarding body or curriculum (e.g. "AQA-GCSE-9-1-Maths", "DES-JC-Maths-2024", "Edexcel-iGCSE-English-Lang"). */
  framework: string;
  /** Spec-point code as published by the awarding body (e.g. "N6", "AO2", "S1.2.3"). */
  code: string;
  /** Short human-readable label. */
  label: string;
}

/** Provenance of the LLM draft, captured at authoring time and frozen at approval. */
export interface SchemaDraftProvenance {
  /** Model identifier as reported by the provider (e.g. "claude-sonnet-4-5"). */
  model: string;
  /** SHA-256 of the prompt used to draft the item, base64url. */
  promptHashB64url: string;
  /** Provider name (e.g. "anthropic", "openai", "local-mock"). */
  provider: string;
  /** ISO-8601 timestamp at draft time. */
  draftedAtIso: string;
  /** Schema version of the *drafter*, separate from content schema. */
  drafterVersion: string;
}

/** Reviewer approval block. Required for an item to land in a signed manifest. */
export interface SchemaApproval {
  /** Reviewer's public key fingerprint (SPKI base64url, truncated to 16 chars for display). */
  reviewerFingerprint: string;
  /** Reviewer's display name as shown in the audit log (e.g. "Laura M., English Lead"). */
  reviewerName: string;
  /** ISO-8601 timestamp at approval click. */
  approvedAtIso: string;
  /** Signature over the canonicalised item payload (ECDSA-P256-SHA256). */
  signatureB64url: string;
  /** SPKI public key, base64url. Manifest verifier checks this against trusted-reviewers list. */
  publicKeyB64url: string;
  /** Free-text reviewer note (optional). Surfaced in the transparency bundle. */
  note?: string;
}

/**
 * The core unit of approved content. One item = one problem with everything
 * a deterministic engine needs to teach it: hints, explanation,
 * misconceptions, parallels, and spec alignment.
 */
export interface SchemaContentItem {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  /** Stable opaque id. Convention: "<jurisdiction>-<subject>-<family>-NNN". */
  id: string;
  /** Skill-family key. Matches the existing `EkeContext.skillFamily` field. */
  skillFamily: string;
  /** Subject tile this item belongs to (matches `SubjectGrid` value). */
  subject: string;
  /** Jurisdictions where this item is curriculum-appropriate. */
  jurisdictions: readonly Jurisdiction[];
  /** Difficulty band. */
  difficulty: Difficulty;
  /** Skill-family ids the learner should typically have completed first. */
  prerequisites: readonly string[];
  /** Spec-point references across awarding bodies (zero or more). */
  specPoints: readonly SchemaSpecPoint[];

  /** The learner-facing problem statement (one or more lines). */
  problem: string;
  /**
   * Expected answer. `number` for numeric items (mirrors `EkeContext.problemAnswer`).
   * `string` reserved for future non-numeric checking (English short-answer, MFL spelling).
   * The runtime answer-checker is numeric-only today; string answers are accepted by
   * the schema but currently treated as `no_attempt` by the engine. Disclosed in HONESTY.md.
   */
  expectedAnswer: number | string;

  /** The 3-tier deterministic Socratic hint ladder. */
  hints: readonly SchemaHint[];

  /**
   * Plain-English walkthrough shown *after* the learner clears the comprehension
   * gate, OR on explicit "show me how" after N wrong attempts (configurable
   * per surface; never as a substitute for thinking).
   */
  explanation: string;

  /** Keyed misconceptions, each tied to an answer-checker category. */
  misconceptions: readonly SchemaMisconception[];

  /** One or more fully-worked parallels. Drives tier-4 hint. */
  workedExamples: readonly SchemaWorkedExample[];

  /**
   * Optional geometric / function-graph figures rendered alongside the
   * problem. Each figure is a pure-data spec (see
   * `lib/geometry/figure-spec.ts`) — no embedded code. The build
   * script runs `validateFigureSpec` on every entry and rejects the
   * item if any is malformed; the registry re-validates on load as
   * defence in depth.
   *
   * `figures` is JSON-compatible; leaving it undefined is equivalent
   * to the empty array. Added in schema v1 without a bump because
   * an absent field deserialises to the same value for existing packs.
   */
  figures?: readonly import("../geometry/figure-spec").FigureSpec[];

  /** LLM draft provenance. Frozen at approval. */
  draft: SchemaDraftProvenance;
  /** Reviewer approval. Required for the item to reach a signed manifest. */
  approval: SchemaApproval;
}

/** A pack groups items in one skill family for distribution. */
export interface SchemaContentPack {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  /** Stable pack id. Convention: "<subject>.<skillFamily>". */
  id: string;
  /** Pack title shown in the transparency bundle. */
  title: string;
  /** Subject tile. */
  subject: string;
  /** Single skill family per pack (so verification is trivial). */
  skillFamily: string;
  /** Approved items. */
  items: readonly SchemaContentItem[];
  /** Pack-level metadata. */
  metadata: {
    /** Pack version (semver). Bumped any time `items` changes. */
    version: string;
    /** ISO-8601 timestamp of the pack build. */
    builtAtIso: string;
    /** Free-form description shown in the review UI. */
    description: string;
  };
}

/** A single entry in the signed content manifest. */
export interface SchemaManifestEntry {
  /** Pack id. */
  packId: string;
  /** Path on disk relative to the manifest. */
  path: string;
  /** SHA-256 of the canonicalised pack JSON, base64url. */
  contentHashB64url: string;
  /** Pack version. */
  version: string;
  /** Subject + family for indexing without loading the pack. */
  subject: string;
  skillFamily: string;
  /** Item count for quick UI display. */
  itemCount: number;
}

/** The signed manifest itself. */
export interface SchemaContentManifest {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  /** Manifest version (semver). */
  version: string;
  /** ISO-8601 build timestamp. */
  builtAtIso: string;
  /** Trusted reviewer public keys. Items whose `approval.publicKeyB64url` is not
   * in this list are rejected at load time. */
  trustedReviewers: readonly {
    fingerprint: string;
    name: string;
    publicKeyB64url: string;
  }[];
  /** Pack entries. */
  entries: readonly SchemaManifestEntry[];
}

// ─── Validation helpers (pure, no I/O) ───────────────────────────────────────

/**
 * Asserts the structural shape of a `SchemaContentItem`. Used by the manifest
 * builder, the content loader, and the review UI before approval. Returns a
 * list of human-readable errors; an empty list means the item is well-formed.
 *
 * This is intentionally conservative — it does NOT call out to a model, run
 * the leak guard (that lives in `lib/eke/tiered-hints.ts`), or talk to the
 * filesystem. It only verifies shape.
 */
export function validateContentItem(item: unknown): readonly string[] {
  const errs: string[] = [];
  const o = item as Partial<SchemaContentItem> | null;
  if (!o || typeof o !== "object") return ["item is not an object"];

  if (o.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    errs.push(`schemaVersion must be "${CONTENT_SCHEMA_VERSION}"`);
  }
  if (!o.id || typeof o.id !== "string") errs.push("id is required");
  if (!o.skillFamily || typeof o.skillFamily !== "string") errs.push("skillFamily is required");
  if (!o.subject || typeof o.subject !== "string") errs.push("subject is required");
  if (!Array.isArray(o.jurisdictions) || o.jurisdictions.length === 0) {
    errs.push("jurisdictions must be a non-empty array");
  }
  if (!o.difficulty) errs.push("difficulty is required");
  if (!Array.isArray(o.prerequisites)) errs.push("prerequisites must be an array");
  if (!Array.isArray(o.specPoints)) errs.push("specPoints must be an array");
  if (!o.problem || typeof o.problem !== "string") errs.push("problem is required");
  if (o.expectedAnswer === undefined || o.expectedAnswer === null) {
    errs.push("expectedAnswer is required");
  }

  if (!Array.isArray(o.hints) || o.hints.length < 3) {
    errs.push("hints must contain at least 3 entries (tiers 1, 2, 3)");
  } else {
    const tiers = new Set(o.hints.map((h) => h.tier));
    for (const t of [1, 2, 3] as const) {
      if (!tiers.has(t)) errs.push(`hints must include tier ${t}`);
    }
    for (const h of o.hints) {
      if (!h.text || typeof h.text !== "string") errs.push("every hint needs text");
    }
  }

  if (!o.explanation || typeof o.explanation !== "string" || o.explanation.length < 20) {
    errs.push("explanation must be a substantive plain-English walkthrough (≥20 chars)");
  }

  if (!Array.isArray(o.misconceptions)) errs.push("misconceptions must be an array");
  if (!Array.isArray(o.workedExamples) || o.workedExamples.length === 0) {
    errs.push("workedExamples must contain at least one parallel");
  } else {
    const ids = new Set<string>();
    for (const w of o.workedExamples) {
      if (!w.id || !w.problem || !w.workedSolution) {
        errs.push("every workedExample needs id, problem, and workedSolution");
      }
      if (w.id && ids.has(w.id)) errs.push(`duplicate workedExample id: ${w.id}`);
      if (w.id) ids.add(w.id);
    }
  }

  // Optional figures — validate each via the geometry validator if present.
  // `validateFigureSpec` is a pure, dependency-free function; the import
  // is cheap and keeps this module ESM-clean.
  if (o.figures !== undefined) {
    if (!Array.isArray(o.figures)) {
      errs.push("figures must be an array when present");
    } else {
      for (let i = 0; i < o.figures.length; i++) {
        const result = validateFigureSpecForSchema(o.figures[i]);
        for (const issue of result.issues) {
          if (issue.severity === "error") {
            errs.push(`figures[${i}] ${issue.path}: ${issue.message}`);
          }
        }
      }
    }
  }

  if (!o.draft || typeof o.draft !== "object") errs.push("draft provenance is required");
  if (!o.approval || typeof o.approval !== "object") errs.push("approval block is required");
  else {
    if (!o.approval.reviewerFingerprint) errs.push("approval.reviewerFingerprint is required");
    if (!o.approval.signatureB64url) errs.push("approval.signatureB64url is required");
    if (!o.approval.publicKeyB64url) errs.push("approval.publicKeyB64url is required");
  }

  return errs;
}

/** Asserts the structural shape of a `SchemaContentPack`. */
export function validateContentPack(pack: unknown): readonly string[] {
  const errs: string[] = [];
  const o = pack as Partial<SchemaContentPack> | null;
  if (!o || typeof o !== "object") return ["pack is not an object"];

  if (o.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    errs.push(`pack.schemaVersion must be "${CONTENT_SCHEMA_VERSION}"`);
  }
  if (!o.id || typeof o.id !== "string") errs.push("pack.id is required");
  if (!o.subject) errs.push("pack.subject is required");
  if (!o.skillFamily) errs.push("pack.skillFamily is required");
  if (!Array.isArray(o.items)) errs.push("pack.items must be an array");
  else {
    o.items.forEach((it, i) => {
      validateContentItem(it).forEach((e) => errs.push(`items[${i}]: ${e}`));
      if (it.skillFamily !== o.skillFamily) {
        errs.push(`items[${i}].skillFamily must equal pack.skillFamily`);
      }
    });
  }
  if (!o.metadata || !o.metadata.version || !o.metadata.builtAtIso) {
    errs.push("pack.metadata.version and pack.metadata.builtAtIso are required");
  }

  return errs;
}

/**
 * Canonicalises a content item or pack for hashing/signing. Sorts object
 * keys recursively so two semantically-equal objects produce the same
 * digest regardless of source ordering. Mirrors the convention used by
 * `lib/crypto/signing.ts:contentDigest`.
 */
export function canonicaliseForHash(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return v;
}
