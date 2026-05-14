# Even Keel Verifiable Credential Platform

**Version:** 1.7.x (pilot)

**Purpose:** Enable teachers to issue cryptographically verifiable attestations of learner mastery that travel outside the classroom — to universities, employers, and other institutions — without requiring a central database or a login to the issuing school's system.

---

## Overview

Even Keel uses the W3C Verifiable Credentials Data Model 2.0 to wrap teacher attestations into portable, tamper-evident credentials. The core properties:

- **Issuer identity:** Published as a `did:web` document under the school's domain (e.g. `did:web:school.example` → `https://school.example/.well-known/did.json`). The document contains the issuer's public keys.
- **Credential content:** A claim (e.g. "verified mastery of quadratic equations"), the learner's canonical identity, the problem id, and a digest of the classroom trace evidence (CRT log) that backs the attestation.
- **Signature:** ECDSA-P256 over the canonical JSON-LD form of the credential, produced by the teacher's passkey. The public key is embedded in the credential for immediate verification.
- **Revocation:** Optional `credentialStatus` block pointing to a `StatusList2021` credential that encodes a revocation bitstring. Revoked credentials are rejected by verifiers.

---

## For Schools: Issuing Credentials

### 1. Publish a DID document

Create a `did:web` document at `https://YOUR-SCHOOL-DOMAIN/.well-known/did.json`. Example:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/jws-2020/v1"],
  "id": "did:web:school.example",
  "verificationMethod": [
    {
      "id": "did:web:school.example#key-1",
      "type": "JsonWebKey2020",
      "controller": "did:web:school.example",
      "publicKeyJwk": {
        "kty": "EC",
        "crv": "P-256",
        "x": "base64url-encoded-x-coordinate",
        "y": "base64url-encoded-y-coordinate",
        "alg": "ES256",
        "use": "sig"
      }
    }
  ],
  "assertionMethod": ["did:web:school.example#key-1"]
}
```

The `publicKeyJwk.x` and `y` values are the base64url-encoded coordinates of the ECDSA-P256 public key you will use to sign credentials. Even Keel's `lib/vc/did-web.ts` can generate this document from a SPKI public key.

### 2. Issue credentials

When a teacher signs an attestation in Even Keel, the system can automatically wrap it into a VC:

- The `issuer` field is set to your `did:web` identifier.
- The `proof.verificationMethod` references the key fragment in your DID document.
- The `proof.publicKeyB64url` is the SPKI public key (for immediate verification).
- Optionally, a `credentialStatus` block is added referencing your revocation list.

### 3. Revocation (optional)

To enable revocation:

- Maintain a bitstring registry where each issued credential has a unique index.
- Publish a `StatusList2021` credential at a stable URL (e.g. `https://school.example/status-list.json`).
- When a credential is revoked, flip the bit at its index and re-publish the status list.

Even Keel's `lib/vc/status-list.ts` provides a ready-made registry implementation.

---

## For Verifiers: Checking Credentials

### 1. Fetch the credential

The learner provides the credential as a JSON file or a QR code pointing to a hosted file.

### 2. Verify the signature

Use Even Keel's open-source verifier at `https://evenkeel.org/verify` (or run `lib/vc/verifier.ts` locally):

- Check that the credential has the correct `@context` and `type` (`VerifiableCredential`, `EvenKeelAttestationCredential`).
- Canonicalize the credential (JCS subset) and verify the ECDSA-P256 signature against the embedded `publicKeyB64url`.
- Validate that each claimed spec point is in the Even Keel claim vocabulary.

### 3. Verify the issuer identity (DID binding)

For stronger assurance that the credential was signed by the claimed school:

- Resolve the DID: `did:web:school.example` → `https://school.example/.well-known/did.json`.
- Fetch the DID document over HTTPS.
- Confirm that `proof.verificationMethod` (e.g. `did:web:school.example#key-1`) exists in `verificationMethod` and is listed in `assertionMethod`.
- Confirm that the JWK in the DID document, when converted to SPKI, matches the `publicKeyB64url` embedded in the credential.

Even Keel's `lib/vc/did-web.ts` provides `verifyVerificationMethodBinding()` for this check.

### 4. Check revocation (if present)

If the credential has a `credentialStatus` block:

- Fetch the status-list credential at `credentialStatus.statusListCredential`.
- Decode the `encodedList` bitstring.
- Check the bit at `statusListIndex`. If `1`, the credential is revoked.

---

## Claim Vocabulary

Even Keel defines a canonical claim vocabulary for spec points. Each claim includes:

- `framework`: e.g. `"AQA"` (Australian Qualifications Framework), `"CCSS"` (Common Core).
- `code`: e.g. `"A18"`, `"8.EE.C.7"`.
- `label`: human-readable description (optional).
- `skillUri`: a stable URI for the skill (auto-generated from framework + code).

The vocabulary is versioned (`claimVocabularyVersion`). Verifiers can clamp the accepted version to simulate an older verifier.

See `lib/vc/claim-vocabulary.ts` for the full vocabulary and validation logic.

---

## Security Properties

- **No central database:** Credentials are self-contained. Verification does not require contacting the issuing school's server (except for optional revocation checks).
- **Passkey-bound signing:** The teacher's private key never leaves their device. The signature is produced client-side using WebAuthn.
- **Tamper-evidence:** Any modification to the credential (learner id, claim, problem, evidence digest) invalidates the signature.
- **Issuer identity:** The `did:web` binding proves the credential was signed by a key published under the school's DNS name, assuming the school's HTTPS server is secure.

---

## Limitations (Pilot)

- **No DID resolution cache:** Verifiers fetch DID documents on each verification. In production, a caching layer is recommended.
- **Revocation is optional:** Credentials without a `credentialStatus` block cannot be revoked. Schools should decide whether to issue revocable credentials on a per-case basis.
- **No multi-issuer trust framework:** The pilot assumes verifiers trust the issuing school directly. A future release may support trust registries or federated trust anchors.
- **StatusList encoding variant:** The pilot uses a base64url-encoded bitstring without gzip compression (named `base64url-bitstring-v1` in the status-list subject). This deviates from the W3C StatusList2021 spec (which requires gzip) for simplicity and browser compatibility. A future release will add full spec compliance.

---

## Integration Guide

### Using the verifier in your application

Even Keel's verifier is a pure TypeScript module (`lib/vc/verifier.ts`). To integrate:

```typescript
import { verifyCredential } from "@/lib/vc/verifier";

// Basic verification (signature only)
const result = await verifyCredential(vcJson);
if (result.ok) {
  console.log("Credential is valid", result.credential);
} else {
  console.log("Verification failed:", result.reason);
}

// With revocation check
const result = await verifyCredential(vcJson, {
  resolveStatusList: async (url) => {
    const resp = await fetch(url);
    return await resp.json();
  },
});
```

### Issuing credentials programmatically

If you operate your own Even Keel instance, you can issue VCs using `lib/vc/issuer.ts`:

```typescript
import { issueVerifiableCredential } from "@/lib/vc/issuer";

const vc = await issueVerifiableCredential({
  attestation: teacherSignedEnvelope,
  issuerDid: "did:web:school.example",
  // optional:
  credentialStatus: statusListEntry,
});
```

---

## Open Source

All VC platform code is open source at:
- **Repository:** https://github.com/datacendia/evenkeellearning
- **Verifier page:** https://evenkeel.org/verify (runs entirely client-side)
- **Modules:**
  - `lib/vc/claim-vocabulary.ts` — claim vocabulary and validation
  - `lib/vc/issuer.ts` — VC issuer
  - `lib/vc/verifier.ts` — VC verifier
  - `lib/vc/status-list.ts` — revocation registry
  - `lib/vc/did-web.ts` — DID document builder and binding check

---

## Contact

For questions about integration or to request support, contact:
- **Email:** vc@evenkeel.org
- **GitHub issues:** https://github.com/datacendia/evenkeellearning/issues
