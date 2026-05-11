# Integration Guide for Verifiers

This guide shows how to integrate Even Keel credential verification into your application or workflow.

## Quick Start: Web Integration

### 1. Embed the verifier widget

Add an iframe to your page pointing to the Even Keel verifier:

```html
<iframe
  src="https://evenkeel.org/verify"
  width="100%"
  height="600"
  style="border: 1px solid #ccc; border-radius: 8px;"
></iframe>
```

The verifier runs entirely client-side. No API keys or authentication required.

### 2. Pre-fill a credential (optional)

You can pass a credential via URL fragment:

```html
<iframe
  src="https://evenkeel.org/verify#vc=BASE64_ENCODED_CREDENTIAL_JSON"
  width="100%"
  height="600"
></iframe>
```

Encode the credential JSON as base64url and append it as the `vc` fragment parameter.

## Advanced: Library Integration

If you want to build a custom verification flow (e.g., integrate into your existing admissions system), use the TypeScript library directly.

### Installation

```bash
npm install evenkeel-vc-platform
```

(Note: package not yet published. For now, clone the repository and import from `lib/vc/`.)

### Basic Verification

```typescript
import { verifyCredential } from "evenkeel-vc-platform/verifier";

async function verifyCredentialJson(json: unknown) {
  const result = await verifyCredential(json);

  if (result.ok) {
    const vc = result.credential;
    console.log("Issuer:", vc.issuer);
    console.log("Learner:", vc.credentialSubject.id);
    console.log("Claim:", vc.credentialSubject.claim);
    console.log("Spec points:", vc.credentialSubject.demonstratedSpecPoints);
    return { valid: true, vc };
  } else {
    console.error("Verification failed:", result.reason);
    return { valid: false, reason: result.reason };
  }
}
```

### Verification with DID Binding

To confirm the credential was signed by the claimed school:

```typescript
import {
  verifyCredential,
} from "evenkeel-vc-platform/verifier";
import {
  resolveDidWebUrl,
  verifyVerificationMethodBinding,
} from "evenkeel-vc-platform/did-web";

async function verifyWithDidBinding(vcJson: unknown) {
  // First, verify the signature
  const sigResult = await verifyCredential(vcJson);
  if (!sigResult.ok) return { valid: false, reason: sigResult.reason };

  const vc = sigResult.credential;

  // Resolve the DID document
  const didUrl = resolveDidWebUrl(vc.issuer);
  const didResp = await fetch(didUrl);
  if (!didResp.ok) {
    return { valid: false, reason: "did_resolution_failed" };
  }
  const didDoc = await didResp.json();

  // Verify the key binding
  const bindingResult = await verifyVerificationMethodBinding({
    didDocument: didDoc,
    expectedDid: vc.issuer,
    verificationMethodId: vc.proof.verificationMethod,
    embeddedPublicKeyB64url: vc.proof.publicKeyB64url,
  });

  if (!bindingResult.ok) {
    return { valid: false, reason: bindingResult.reason };
  }

  return { valid: true, vc, didDocument: didDoc };
}
```

### Verification with Revocation Check

```typescript
import { verifyCredential } from "evenkeel-vc-platform/verifier";

async function verifyWithRevocation(vcJson: unknown) {
  const result = await verifyCredential(vcJson, {
    resolveStatusList: async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) return null; // Offline or unreachable — not a failure
      return await resp.json();
    },
  });

  if (result.ok) {
    console.log("Credential is valid and not revoked");
  } else if (result.reason === "revoked") {
    console.log("Credential has been revoked by the issuer");
  } else {
    console.error("Verification failed:", result.reason);
  }

  return result;
}
```

## Extracting Credential Data

Once verified, you can extract structured data for your system:

```typescript
function extractAdmissionData(vc: VerifiableCredential) {
  const subject = vc.credentialSubject;
  return {
    learnerId: subject.id.replace(/^urn:evenkeel:learner:/, ""),
    claim: subject.claim,
    problemId: subject.problemId,
    evidenceDigest: subject.evidenceContentDigestB64url,
    specPoints: subject.demonstratedSpecPoints.map((sp) => ({
      framework: sp.framework,
      code: sp.code,
      label: sp.label,
      skillUri: sp.skillUri,
    })),
    issuedAt: vc.validFrom,
    issuer: vc.issuer,
    revocable: !!vc.credentialStatus,
  };
}
```

## Error Handling

The verifier returns a discriminated result with stable reason codes:

| Reason | Meaning |
|--------|---------|
| `bad_signature` | Credential was tampered with or key mismatch |
| `wrong_type` | Not an Even Keel credential |
| `invalid_spec_point` | Claim vocabulary mismatch |
| `revoked` | Credential is revoked (if status list checked) |
| `did_mismatch` | DID document id does not match issuer (DID binding) |
| `key_mismatch` | Embedded key does not match published key (DID binding) |

Map these to user-facing messages in your UI.

## Rate Limiting

If you run a public verification endpoint, consider rate limiting to prevent abuse. The verifier itself is CPU-bound (crypto operations), so a simple in-memory rate limiter is sufficient for pilot scale.

## Support

- **Documentation:** https://github.com/datacendia/evenkeellearning/blob/main/docs/VC_PLATFORM.md
- **Issues:** https://github.com/datacendia/evenkeellearning/issues
- **Email:** vc@evenkeel.org
