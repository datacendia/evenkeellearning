// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/launch.ts
//
// v1.8.0 — LTI 1.3 launch claim validator.
//
// PURPOSE
// ───────
// Once a `id_token` has been signature-verified by `verifyJwt`, this
// module enforces the LTI Core 1.3 + LTI Resource Link claim
// invariants and projects the raw JWT payload into a normalised
// `LtiLaunch` value the rest of the platform can use without parsing
// IMS URIs.
//
// SPEC REFERENCES
// ───────────────
//   • LTI 1.3 Core   — https://www.imsglobal.org/spec/lti/v1p3/
//   • LTI Roles      — https://www.imsglobal.org/spec/lti/v1p3/#role-vocabularies
//
// MESSAGE TYPES
// ─────────────
// LTI defines `LtiResourceLinkRequest` (a launch) and
// `LtiDeepLinkingRequest` (content selection). v1 only validates
// resource-link launches — deep-linking is a separate todo.
// ─────────────────────────────────────────────────────────────────────────────

import type { JwtPayload } from "./jwt";

// ─── IMS claim URIs ───────────────────────────────────────────────────────

export const LTI_VERSION_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/version";
export const LTI_MESSAGE_TYPE_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/message_type";
export const LTI_DEPLOYMENT_ID_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
export const LTI_TARGET_LINK_URI_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/target_link_uri";
export const LTI_RESOURCE_LINK_CLAIM =
  "https://purl.imsglobal.org/spec/lti/claim/resource_link";
export const LTI_ROLES_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/roles";
export const LTI_CONTEXT_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/context";
export const LTI_LIS_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/lis";
export const LTI_CUSTOM_CLAIM = "https://purl.imsglobal.org/spec/lti/claim/custom";

export const SUPPORTED_LTI_VERSION = "1.3.0";
export const RESOURCE_LINK_MESSAGE_TYPE = "LtiResourceLinkRequest";

// ─── Role mapping ─────────────────────────────────────────────────────────

/** Even-Keel-internal role mapped from the LTI roles URI list. */
export type EvenKeelLtiRole = "teacher" | "learner" | "admin" | "unknown";

/**
 * LTI roles vocabulary URIs we care about. The spec is broader — any
 * IMS-published role URI is legal — but the pilot only needs to
 * separate teacher / learner / admin. Unknown roles fall through to
 * "unknown" and are treated as untrusted (no role session issued).
 */
const TEACHER_ROLE_URIS = new Set<string>([
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
  "http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant",
  "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor",
  "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Faculty",
]);
const LEARNER_ROLE_URIS = new Set<string>([
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
  "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student",
]);
const ADMIN_ROLE_URIS = new Set<string>([
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator",
  "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator",
  "http://purl.imsglobal.org/vocab/lis/v2/system/person#Administrator",
]);

/**
 * Reduce a list of LTI role URIs to a single Even Keel role. Order of
 * precedence: admin > teacher > learner > unknown. A user with multiple
 * roles (e.g. an instructor who is also an admin) is treated as the
 * highest-privilege role.
 */
export function mapLtiRoles(roles: ReadonlyArray<string>): EvenKeelLtiRole {
  let sawTeacher = false;
  let sawLearner = false;
  for (const r of roles) {
    if (ADMIN_ROLE_URIS.has(r)) return "admin";
    if (TEACHER_ROLE_URIS.has(r)) sawTeacher = true;
    if (LEARNER_ROLE_URIS.has(r)) sawLearner = true;
  }
  if (sawTeacher) return "teacher";
  if (sawLearner) return "learner";
  return "unknown";
}

// ─── Validation result types ──────────────────────────────────────────────

export type LtiValidationReason =
  | "missing_lti_version"
  | "unsupported_lti_version"
  | "missing_message_type"
  | "unsupported_message_type"
  | "missing_iss"
  | "iss_mismatch"
  | "missing_aud"
  | "aud_mismatch"
  | "missing_deployment_id"
  | "unknown_deployment"
  | "missing_sub"
  | "missing_nonce"
  | "missing_target_link_uri"
  | "invalid_target_link_uri"
  | "missing_resource_link"
  | "missing_roles"
  | "unsafe_redirect";

/**
 * Normalised launch context produced after a successful validation.
 * This is the shape downstream code consumes — no further IMS-URI
 * juggling needed.
 */
export interface LtiLaunch {
  /** Stable identifier of the matched platform registration. */
  platformId: string;
  /** LMS issuer. */
  issuer: string;
  /** Tool's OAuth client_id on this LMS. */
  clientId: string;
  /** Deployment id. */
  deploymentId: string;
  /** Opaque LMS user id (the JWT `sub`). */
  ltiUserSub: string;
  /** Even Keel role projected from LTI roles. */
  role: EvenKeelLtiRole;
  /** Raw role URIs the LMS supplied. */
  ltiRoles: ReadonlyArray<string>;
  /** Where the LMS intended the user to land inside the tool. */
  targetLinkUri: string;
  /** Resource link id (stable per launch context). */
  resourceLinkId: string;
  /** Resource link title, if the LMS supplied one. */
  resourceLinkTitle?: string;
  /** Course / context id, if present. */
  contextId?: string;
  /** Course / context title, if present. */
  contextTitle?: string;
  /** Nonce echoed from the OIDC login initiation. */
  nonce: string;
  /** Custom claims the LMS forwarded to the tool. */
  custom: Record<string, string>;
}

export type LtiLaunchValidation =
  | { ok: true; launch: LtiLaunch }
  | { ok: false; reason: LtiValidationReason; detail?: string };

/**
 * Arguments to `validateLtiLaunch`. The expected values come from the
 * platform registration; the JWT payload comes from `verifyJwt`.
 */
export interface ValidateLtiLaunchArgs {
  payload: JwtPayload;
  expectedIssuer: string;
  expectedClientId: string;
  knownDeploymentIds: ReadonlyArray<string>;
  /** Absolute base origin of this tool (e.g. https://evenkeel.org). */
  toolOrigin: string;
  /** Platform stable id (echoed into the launch result). */
  platformId: string;
}

/**
 * Validate an `id_token` payload as a LTI 1.3 resource-link launch.
 */
export function validateLtiLaunch(
  args: ValidateLtiLaunchArgs,
): LtiLaunchValidation {
  const p = args.payload as Record<string, unknown>;

  if (typeof p[LTI_VERSION_CLAIM] !== "string") {
    return { ok: false, reason: "missing_lti_version" };
  }
  if (p[LTI_VERSION_CLAIM] !== SUPPORTED_LTI_VERSION) {
    return {
      ok: false,
      reason: "unsupported_lti_version",
      detail: String(p[LTI_VERSION_CLAIM]),
    };
  }

  if (typeof p[LTI_MESSAGE_TYPE_CLAIM] !== "string") {
    return { ok: false, reason: "missing_message_type" };
  }
  if (p[LTI_MESSAGE_TYPE_CLAIM] !== RESOURCE_LINK_MESSAGE_TYPE) {
    return {
      ok: false,
      reason: "unsupported_message_type",
      detail: String(p[LTI_MESSAGE_TYPE_CLAIM]),
    };
  }

  if (typeof args.payload.iss !== "string") {
    return { ok: false, reason: "missing_iss" };
  }
  if (args.payload.iss !== args.expectedIssuer) {
    return { ok: false, reason: "iss_mismatch" };
  }

  // aud may be string or array. The expected client_id must appear.
  const audValues = normalizeAud(args.payload.aud);
  if (audValues.length === 0) return { ok: false, reason: "missing_aud" };
  if (!audValues.includes(args.expectedClientId)) {
    return { ok: false, reason: "aud_mismatch" };
  }
  // If aud is an array with multiple values, the spec requires `azp`
  // to match our client id.
  if (audValues.length > 1) {
    if (
      typeof args.payload.azp !== "string" ||
      args.payload.azp !== args.expectedClientId
    ) {
      return { ok: false, reason: "aud_mismatch" };
    }
  }

  const deploymentId = p[LTI_DEPLOYMENT_ID_CLAIM];
  if (typeof deploymentId !== "string" || deploymentId.length === 0) {
    return { ok: false, reason: "missing_deployment_id" };
  }
  if (!args.knownDeploymentIds.includes(deploymentId)) {
    return { ok: false, reason: "unknown_deployment", detail: deploymentId };
  }

  if (typeof args.payload.sub !== "string" || args.payload.sub.length === 0) {
    return { ok: false, reason: "missing_sub" };
  }
  if (
    typeof args.payload.nonce !== "string" ||
    args.payload.nonce.length === 0
  ) {
    return { ok: false, reason: "missing_nonce" };
  }

  const targetLinkUri = p[LTI_TARGET_LINK_URI_CLAIM];
  if (typeof targetLinkUri !== "string" || targetLinkUri.length === 0) {
    return { ok: false, reason: "missing_target_link_uri" };
  }
  if (!isSafeRedirectInsideOrigin(targetLinkUri, args.toolOrigin)) {
    return { ok: false, reason: "unsafe_redirect", detail: targetLinkUri };
  }

  const resourceLink = p[LTI_RESOURCE_LINK_CLAIM];
  if (!resourceLink || typeof resourceLink !== "object") {
    return { ok: false, reason: "missing_resource_link" };
  }
  const rl = resourceLink as Record<string, unknown>;
  if (typeof rl.id !== "string" || rl.id.length === 0) {
    return { ok: false, reason: "missing_resource_link" };
  }

  const rolesRaw = p[LTI_ROLES_CLAIM];
  if (!Array.isArray(rolesRaw)) {
    return { ok: false, reason: "missing_roles" };
  }
  const roles: string[] = rolesRaw.filter(
    (v): v is string => typeof v === "string",
  );

  const context = p[LTI_CONTEXT_CLAIM];
  let contextId: string | undefined;
  let contextTitle: string | undefined;
  if (context && typeof context === "object") {
    const c = context as Record<string, unknown>;
    if (typeof c.id === "string") contextId = c.id;
    if (typeof c.title === "string") contextTitle = c.title;
  }

  const custom: Record<string, string> = {};
  const rawCustom = p[LTI_CUSTOM_CLAIM];
  if (rawCustom && typeof rawCustom === "object") {
    for (const [k, v] of Object.entries(rawCustom as Record<string, unknown>)) {
      if (typeof v === "string") custom[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") {
        custom[k] = String(v);
      }
    }
  }

  return {
    ok: true,
    launch: {
      platformId: args.platformId,
      issuer: args.payload.iss,
      clientId: args.expectedClientId,
      deploymentId,
      ltiUserSub: args.payload.sub,
      role: mapLtiRoles(roles),
      ltiRoles: roles,
      targetLinkUri,
      resourceLinkId: rl.id,
      resourceLinkTitle:
        typeof rl.title === "string" ? rl.title : undefined,
      contextId,
      contextTitle,
      nonce: args.payload.nonce,
      custom,
    },
  };
}

function normalizeAud(aud: unknown): string[] {
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * The `target_link_uri` must point INTO this tool's own origin. We
 * REFUSE to redirect to a third party even if the LMS asks us to —
 * that would turn a launch into an open-redirect gadget.
 */
export function isSafeRedirectInsideOrigin(
  target: string,
  toolOrigin: string,
): boolean {
  let t: URL;
  let o: URL;
  try {
    t = new URL(target);
    o = new URL(toolOrigin);
  } catch {
    return false;
  }
  if (t.protocol !== o.protocol) return false;
  if (t.host !== o.host) return false;
  return true;
}
