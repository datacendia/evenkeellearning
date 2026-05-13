// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-launch.test.ts
//
// v1.8.0 — Tests for the LTI 1.3 launch claim validator.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  isSafeRedirectInsideOrigin,
  LTI_CONTEXT_CLAIM,
  LTI_CUSTOM_CLAIM,
  LTI_DEPLOYMENT_ID_CLAIM,
  LTI_MESSAGE_TYPE_CLAIM,
  LTI_RESOURCE_LINK_CLAIM,
  LTI_ROLES_CLAIM,
  LTI_TARGET_LINK_URI_CLAIM,
  LTI_VERSION_CLAIM,
  RESOURCE_LINK_MESSAGE_TYPE,
  SUPPORTED_LTI_VERSION,
  mapLtiRoles,
  validateLtiLaunch,
} from "../../lib/lti/launch";

function basePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://canvas.instructure.com",
    sub: "lms-user-42",
    aud: "client-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    nonce: "nonce-abc",
    [LTI_VERSION_CLAIM]: SUPPORTED_LTI_VERSION,
    [LTI_MESSAGE_TYPE_CLAIM]: RESOURCE_LINK_MESSAGE_TYPE,
    [LTI_DEPLOYMENT_ID_CLAIM]: "dep-1",
    [LTI_TARGET_LINK_URI_CLAIM]: "https://app.example/learner",
    [LTI_RESOURCE_LINK_CLAIM]: { id: "rl-1", title: "Quadratics pack" },
    [LTI_ROLES_CLAIM]: [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
    ],
    [LTI_CONTEXT_CLAIM]: { id: "ctx-1", title: "Year 11 Maths" },
    [LTI_CUSTOM_CLAIM]: { teacherId: "T-7", level: 11 },
    ...over,
  };
}

const baseArgs = {
  expectedIssuer: "https://canvas.instructure.com",
  expectedClientId: "client-1",
  knownDeploymentIds: ["dep-1", "dep-2"],
  toolOrigin: "https://app.example",
  platformId: "dev-canvas",
};

describe("lti/launch — happy path", () => {
  it("accepts a well-formed resource-link launch and normalises it", () => {
    const r = validateLtiLaunch({ ...baseArgs, payload: basePayload() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.launch.platformId).toBe("dev-canvas");
      expect(r.launch.issuer).toBe("https://canvas.instructure.com");
      expect(r.launch.deploymentId).toBe("dep-1");
      expect(r.launch.ltiUserSub).toBe("lms-user-42");
      expect(r.launch.role).toBe("learner");
      expect(r.launch.targetLinkUri).toBe("https://app.example/learner");
      expect(r.launch.resourceLinkId).toBe("rl-1");
      expect(r.launch.resourceLinkTitle).toBe("Quadratics pack");
      expect(r.launch.contextId).toBe("ctx-1");
      expect(r.launch.custom.teacherId).toBe("T-7");
      // Numbers in custom are stringified.
      expect(r.launch.custom.level).toBe("11");
    }
  });
});

describe("lti/launch — claim presence / validity", () => {
  it("rejects when LTI version is missing", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ [LTI_VERSION_CLAIM]: undefined }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_lti_version");
  });

  it("rejects an unsupported LTI version", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ [LTI_VERSION_CLAIM]: "1.2.0" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_lti_version");
  });

  it("rejects an unsupported message type", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({
        [LTI_MESSAGE_TYPE_CLAIM]: "LtiDeepLinkingRequest",
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_message_type");
  });

  it("rejects an iss mismatch", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ iss: "https://attacker.example" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("iss_mismatch");
  });

  it("rejects an aud mismatch", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ aud: "other-client" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("aud_mismatch");
  });

  it("accepts a multi-aud token when azp matches our client_id", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({
        aud: ["client-1", "other-client"],
        azp: "client-1",
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a multi-aud token when azp does NOT match our client_id", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({
        aud: ["client-1", "other-client"],
        azp: "other-client",
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("aud_mismatch");
  });

  it("rejects an unknown deployment id", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ [LTI_DEPLOYMENT_ID_CLAIM]: "dep-rogue" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_deployment");
  });

  it("rejects when sub is missing", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ sub: undefined }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_sub");
  });

  it("rejects when nonce is missing", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ nonce: undefined }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_nonce");
  });

  it("rejects when target_link_uri is missing", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ [LTI_TARGET_LINK_URI_CLAIM]: undefined }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_target_link_uri");
  });

  it("rejects a target_link_uri that points off-origin", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({
        [LTI_TARGET_LINK_URI_CLAIM]: "https://attacker.example/steal",
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsafe_redirect");
  });

  it("rejects when resource_link is missing", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ [LTI_RESOURCE_LINK_CLAIM]: undefined }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_resource_link");
  });

  it("rejects when roles claim is not an array", () => {
    const r = validateLtiLaunch({
      ...baseArgs,
      payload: basePayload({ [LTI_ROLES_CLAIM]: "Instructor" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_roles");
  });
});

describe("lti/launch — role mapping", () => {
  it("maps a single Instructor role to teacher", () => {
    expect(
      mapLtiRoles([
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
      ]),
    ).toBe("teacher");
  });

  it("maps a single Learner role to learner", () => {
    expect(
      mapLtiRoles([
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
      ]),
    ).toBe("learner");
  });

  it("prefers admin when both admin and teacher are present", () => {
    expect(
      mapLtiRoles([
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator",
      ]),
    ).toBe("admin");
  });

  it("prefers teacher when both teacher and learner are present", () => {
    expect(
      mapLtiRoles([
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
      ]),
    ).toBe("teacher");
  });

  it("returns unknown for an unrecognised role URI", () => {
    expect(mapLtiRoles(["http://example/roles#Observer"])).toBe("unknown");
  });

  it("returns unknown for an empty role list", () => {
    expect(mapLtiRoles([])).toBe("unknown");
  });
});

describe("lti/launch — isSafeRedirectInsideOrigin", () => {
  it("accepts a URL on the same host + protocol", () => {
    expect(
      isSafeRedirectInsideOrigin("https://app.example/x", "https://app.example"),
    ).toBe(true);
  });

  it("accepts a URL on the same host + protocol + port", () => {
    expect(
      isSafeRedirectInsideOrigin(
        "https://app.example:443/x",
        "https://app.example",
      ),
    ).toBe(true);
  });

  it("rejects a different host", () => {
    expect(
      isSafeRedirectInsideOrigin(
        "https://other.example/x",
        "https://app.example",
      ),
    ).toBe(false);
  });

  it("rejects a different protocol", () => {
    expect(
      isSafeRedirectInsideOrigin(
        "http://app.example/x",
        "https://app.example",
      ),
    ).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isSafeRedirectInsideOrigin("not a url", "https://app.example")).toBe(
      false,
    );
  });
});
