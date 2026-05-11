import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  issuerAllowed,
  destinationAllowed,
  validateDestinationShape,
  createRateLimiter,
  precheck,
  parseList,
  DEFAULT_POLICY,
  type DispatchPolicyConfig,
} from "../src/policy";
import { isEnvelopeLike, verifyEnvelope, type SignedEnvelopeLike } from "../src/envelope";

describe("policy", () => {
  describe("parseList", () => {
    it("parses comma-separated list", () => {
      const result = parseList("did:example:123,did:web:example.com");
      expect(result).toEqual(["did:example:123", "did:web:example.com"]);
    });

    it("trims whitespace", () => {
      const result = parseList("did:example:123, did:web:example.com, did:key:xyz");
      expect(result).toEqual(["did:example:123", "did:web:example.com", "did:key:xyz"]);
    });

    it("filters empty strings", () => {
      const result = parseList("did:example:123,,did:web:example.com");
      expect(result).toEqual(["did:example:123", "did:web:example.com"]);
    });

    it("returns empty array for undefined", () => {
      const result = parseList(undefined);
      expect(result).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      const result = parseList("");
      expect(result).toEqual([]);
    });
  });

  describe("issuerAllowed", () => {
    it("accepts issuer matching prefix in allowlist", () => {
      const allowlist = ["did:example:123", "did:web:example.com"];
      const result = issuerAllowed("did:example:123456", allowlist);
      expect(result).toBe(true);
    });

    it("accepts exact match", () => {
      const allowlist = ["did:example:123"];
      const result = issuerAllowed("did:example:123", allowlist);
      expect(result).toBe(true);
    });

    it("rejects issuer not in allowlist", () => {
      const allowlist = ["did:example:123", "did:web:example.com"];
      const result = issuerAllowed("did:example:456", allowlist);
      expect(result).toBe(false);
    });

    it("rejects when allowlist is empty", () => {
      const result = issuerAllowed("did:example:456", []);
      expect(result).toBe(false);
    });

    it("requires issuer to be at least as long as prefix", () => {
      const allowlist = ["did:example:123456"];
      const result = issuerAllowed("did:example:123", allowlist);
      expect(result).toBe(false);
    });
  });

  describe("destinationAllowed", () => {
    it("accepts exact match", () => {
      const allowlist = ["https://api.example.com", "https://school.org/webhook"];
      const result = destinationAllowed("https://api.example.com", allowlist);
      expect(result).toBe(true);
    });

    it("rejects when not exact match", () => {
      const allowlist = ["https://api.example.com"];
      const result = destinationAllowed("https://api.example.com/dispatch", allowlist);
      expect(result).toBe(false);
    });

    it("rejects destination not in allowlist", () => {
      const allowlist = ["https://api.example.com", "https://school.org/webhook"];
      const result = destinationAllowed("https://evil.com/hook", allowlist);
      expect(result).toBe(false);
    });

    it("rejects when allowlist is empty", () => {
      const result = destinationAllowed("https://evil.com/hook", []);
      expect(result).toBe(false);
    });
  });

  describe("validateDestinationShape", () => {
    it("accepts valid HTTPS URL", () => {
      const result = validateDestinationShape("https://api.example.com/hook");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url.href).toBe("https://api.example.com/hook");
      }
    });

    it("rejects HTTP URL", () => {
      const result = validateDestinationShape("http://api.example.com/hook");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_must_be_https");
      }
    });

    it("rejects invalid URL", () => {
      const result = validateDestinationShape("not-a-url");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_not_a_url");
      }
    });

    it("rejects URL with userinfo", () => {
      const result = validateDestinationShape("https://user:pass@api.example.com/hook");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_must_not_have_userinfo");
      }
    });

    it("rejects URL with username only", () => {
      const result = validateDestinationShape("https://user@api.example.com/hook");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_must_not_have_userinfo");
      }
    });
  });

  describe("createRateLimiter", () => {
    it("allows requests within limit", () => {
      const limiter = createRateLimiter(60000, 5); // 5 requests per 60s
      const key = "issuer1";

      for (let i = 0; i < 5; i++) {
        const result = limiter.check(key);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    it("blocks requests exceeding limit", () => {
      const limiter = createRateLimiter(60000, 3); // 3 requests per 60s
      const key = "issuer1";

      // First 3 should pass
      for (let i = 0; i < 3; i++) {
        expect(limiter.check(key).allowed).toBe(true);
      }

      // 4th should be blocked
      const result = limiter.check(key);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("tracks per-key independently", () => {
      const limiter = createRateLimiter(60000, 2);
      const key1 = "issuer1";
      const key2 = "issuer2";

      expect(limiter.check(key1).allowed).toBe(true);
      expect(limiter.check(key1).allowed).toBe(true);
      expect(limiter.check(key1).allowed).toBe(false); // key1 blocked

      expect(limiter.check(key2).allowed).toBe(true); // key2 still allowed
      expect(limiter.check(key2).allowed).toBe(true);
    });

    it("expires old entries after window", () => {
      const nowFn = vi.fn();
      nowFn.mockReturnValue(1000);
      const limiter = createRateLimiter(60000, 2, nowFn);
      const key = "issuer1";

      expect(limiter.check(key).allowed).toBe(true);
      expect(limiter.check(key).allowed).toBe(true);
      expect(limiter.check(key).allowed).toBe(false);

      // Advance time past window
      nowFn.mockReturnValue(70000);

      // Should be allowed again
      const result = limiter.check(key);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });
  });

  describe("precheck", () => {
    const basePolicy: DispatchPolicyConfig = {
      ...DEFAULT_POLICY,
      issuerAllowlist: ["did:example:123"],
      destinationAllowlist: ["https://api.example.com/hook"],
    };

    it("passes all checks", () => {
      const result = precheck(
        {
          issuerPubKey: "did:example:123456",
          destination: "https://api.example.com/hook",
          bodyByteLength: 1000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.destinationUrl.href).toBe("https://api.example.com/hook");
      }
    });

    it("fails body too large", () => {
      const result = precheck(
        {
          issuerPubKey: "did:example:123456",
          destination: "https://api.example.com/hook",
          bodyByteLength: 100000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("body_too_large");
      }
    });

    it("fails missing issuer pubkey", () => {
      const result = precheck(
        {
          issuerPubKey: "",
          destination: "https://api.example.com/hook",
          bodyByteLength: 1000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("missing_issuer_pubkey");
      }
    });

    it("fails issuer not allowed", () => {
      const result = precheck(
        {
          issuerPubKey: "did:example:9999999999",
          destination: "https://api.example.com/hook",
          bodyByteLength: 1000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("issuer_not_allowed");
      }
    });

    it("fails destination not a URL", () => {
      const result = precheck(
        {
          issuerPubKey: "did:example:123456",
          destination: "not-a-url",
          bodyByteLength: 1000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_not_a_url");
      }
    });

    it("fails destination not HTTPS", () => {
      const result = precheck(
        {
          issuerPubKey: "did:example:123456",
          destination: "http://api.example.com/hook",
          bodyByteLength: 1000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_must_be_https");
      }
    });

    it("fails destination not allowed", () => {
      const result = precheck(
        {
          issuerPubKey: "did:example:123456",
          destination: "https://evil.com/hook",
          bodyByteLength: 1000,
        },
        basePolicy,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("destination_not_allowed");
      }
    });
  });
});

describe("envelope", () => {
  const validPayload = { foo: "bar" };

  describe("isEnvelopeLike", () => {
    it("accepts valid envelope", () => {
      const envelope: SignedEnvelopeLike = {
        payload: validPayload,
        publicKeyB64url: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: "abc123",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      expect(isEnvelopeLike(envelope)).toBe(true);
    });

    it("rejects null", () => {
      expect(isEnvelopeLike(null)).toBe(false);
    });

    it("rejects undefined", () => {
      expect(isEnvelopeLike(undefined)).toBe(false);
    });

    it("rejects non-object", () => {
      expect(isEnvelopeLike("string")).toBe(false);
      expect(isEnvelopeLike(123)).toBe(false);
    });

    it("rejects missing payload", () => {
      const envelope = {
        publicKeyB64url: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: "abc123",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      expect(isEnvelopeLike(envelope)).toBe(false);
    });

    it("rejects non-object payload", () => {
      const envelope = {
        payload: "not an object",
        publicKeyB64url: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: "abc123",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      expect(isEnvelopeLike(envelope)).toBe(false);
    });

    it("rejects missing publicKeyB64url", () => {
      const envelope = {
        payload: validPayload,
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: "abc123",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      expect(isEnvelopeLike(envelope)).toBe(false);
    });

    it("rejects missing signatureB64url", () => {
      const envelope = {
        payload: validPayload,
        publicKeyB64url: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: "abc123",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      expect(isEnvelopeLike(envelope)).toBe(false);
    });
  });

  describe("verifyEnvelope", () => {
    it("rejects unsupported algorithm", async () => {
      const envelope: SignedEnvelopeLike = {
        payload: validPayload,
        publicKeyB64url: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "RSA-PKCS1-v1_5",
        keyType: "session",
        contentDigestB64url: "abc123",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      const result = await verifyEnvelope(envelope);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("unsupported_algorithm");
      }
    });

    it("rejects content digest mismatch", async () => {
      const envelope: SignedEnvelopeLike = {
        payload: validPayload,
        publicKeyB64url: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: "wrong_digest",
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      const result = await verifyEnvelope(envelope);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("content_digest_mismatch");
      }
    });

    it("rejects malformed public key", async () => {
      // Compute the correct digest for the payload so we get past
      // the digest check and exercise the pub-key import path.
      const payloadBytes = new TextEncoder().encode(JSON.stringify(validPayload));
      const digestBuf = await crypto.subtle.digest("SHA-256", payloadBytes);
      const digestBytes = new Uint8Array(digestBuf);
      let bin = "";
      for (let i = 0; i < digestBytes.length; i++) bin += String.fromCharCode(digestBytes[i]);
      const correctDigest = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const envelope: SignedEnvelopeLike = {
        payload: validPayload,
        publicKeyB64url: "not_valid_spki",
        signatureB64url: "MEUCIQDZ5Y3j6X8k9Z2m4q1p5r6s7t8u9v0w1x2y3z4",
        algorithm: "ECDSA-P256-SHA256",
        keyType: "session",
        contentDigestB64url: correctDigest,
        signedAtIso: "2024-01-01T00:00:00Z",
      };
      const result = await verifyEnvelope(envelope);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("bad_public_key");
      }
    });

    // Note: Full cryptographic verification test requires a real ECDSA P-256 key pair
    // and signature. The actual verification logic is tested via integration
    // with the main handler using mock fetch.
  });
});
