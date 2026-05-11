# Even Keel Verifiable Credentials — integrator guide

**Audience:** engineers at colleges, employers, regulators, or learning platforms who need to accept and verify a credential a learner has handed them.

**Status:** v1.7.4 (vc1-envelope, vc2-status, vc3-verifier, vc4-did landed). Pilot — production-grade for the components below; not yet covering selective disclosure (BBS+) or DID methods other than `did:web`.

---

## What an Even Keel credential is

A W3C Verifiable Credential 2.0 envelope wrapping a teacher's signed attestation that a specific learner demonstrated mastery of one or more curriculum spec-points on a specific problem. Three artefacts ship together:

| File | Role |
|------|------|
| `sample-credential.json` | The VC the learner shows you. |
| `sample-did.json` | The issuer's DID document, served at `https://samples.evenkeel.org/.well-known/did.json`. Publishes the public key the verifier uses. |
| `sample-status-list.json` | A signed `StatusList2021Credential` whose bitstring carries the revocation status of every credential this issuer has ever issued. Hosted at the URL embedded in `sample-credential.json#credentialStatus.statusListCredential`. |

Live samples: [`/vc/sample-credential.json`](/vc/sample-credential.json), [`/vc/sample-did.json`](/vc/sample-did.json), [`/vc/sample-status-list.json`](/vc/sample-status-list.json).

---

## Minimum-viable verification

Three steps. Every step rejects on a stable machine code (see "Reason codes" below).

```ts
import { verifyCredential } from "@evenkeel/vc/verifier";          // (or copy lib/vc/verifier.ts)
import { defaultDidWebResolver } from "@evenkeel/vc/did-web";

const credential = JSON.parse(pastedCredential);
const result = await verifyCredential(credential, {
  // 1. Resolve the issuer DID and require the resolved key to match
  //    the embedded one. Without this, the embedded key is trusted as-is.
  didResolver: defaultDidWebResolver,

  // 2. Resolve the issuer's status list and reject if the credential's
  //    bit is set. Without this, revocation is not checked.
  statusListResolver: async (url) => {
    const r = await fetch(url);
    const list = await r.json();
    return list.credentialSubject.encodedList;
  },

  // 3. Defence against an attacker substituting a friendly status list:
  //    require the credential's status-list URL to be in your allowlist.
  allowedStatusListUrls: ["https://samples.evenkeel.org/sl/2026A"],

  // 4. Optional policy: only accept credentials with a did:web issuer.
  requireDidIssuer: true,
});

if (!result.ok) {
  console.error("REJECT", result.reason);
  return;
}

const { credentialSubject } = result.credential;
console.log("Learner:", credentialSubject.id);
console.log("Claim:", credentialSubject.claim);
console.log("Spec-points:", credentialSubject.demonstratedSpecPoints);
```

The same call works without any options — you'll get a signature-only check. Each option you add tightens trust.

---

## What you DON'T have to do

- **Run a server.** Verification is browser-side. The credential's signature is verified against a public key you can fetch over HTTPS.
- **Trust Even Keel.** Once you've fetched the issuer's DID document (which lives on the issuer's own domain, not ours), the credential proves itself.
- **Parse JSON-LD contexts.** The verifier treats the `@context` field as an opaque marker (the first entry MUST be `https://www.w3.org/ns/credentials/v2`). It does NOT dereference contexts or perform LD-Proofs canonicalisation. We use a JCS subset; see CAVEATS.
- **Implement DID resolution.** `defaultDidWebResolver` ships in the kit.
- **Implement gzip / bitstring decoding.** The status list helpers ship in the kit.

---

## Claim vocabulary

Every spec-point in `credentialSubject.demonstratedSpecPoints` carries:

```json
{
  "framework": "AQA-GCSE-9-1-Maths",
  "code": "A18",
  "label": "Solve quadratic equations",
  "claimVocabularyVersion": 1,
  "skillUri": null
}
```

- `framework` + `code` is the canonical identifier. Compare on this tuple.
- `label` is a human-readable hint. **Do not match on labels** — they may change.
- `claimVocabularyVersion` is bumped only on breaking semantic changes. Reject any version higher than your verifier supports.
- `skillUri` is reserved for the upcoming curriculum registry. Currently always `null`. Future credentials may populate it; old credentials will not. A populated `skillUri` MUST resolve to the same `(framework, code)` tuple.

Frameworks shipped today: `AQA-GCSE-9-1-Maths`, `Edexcel-GCSE-Maths`, `OCR-GCSE-Maths`, `IE-Junior-Cycle-Maths`, `NC-KS3-Maths`, `CCSS-Math`, `DES`. Treat unknown frameworks as a strong signal — verify with the issuer.

---

## Reason codes

Stable. Suitable for icon mapping. Plain-English descriptions in [`lib/vc/standalone-verifier-helpers.ts`](../../lib/vc/standalone-verifier-helpers.ts).

| Reason | When | Severity |
|--------|------|----------|
| `bad_signature` | Credential's bytes were tampered after signing | **REJECT — likely fraud** |
| `did_key_mismatch` | Embedded key disagrees with the key the issuer publishes | **REJECT — likely fraud** |
| `credential_revoked` | Issuer set the bit | **REJECT** |
| `credential_suspended` | Issuer set the bit (purpose is suspension) | REJECT (may be temporary) |
| `wrong_status_list_url` | Status list URL not in your allowlist | **REJECT — likely fraud** |
| `did_verification_method_not_found` | Proof points at a key absent from the DID doc | **REJECT** |
| `bad_public_key` | Embedded key bytes can't be imported | REJECT |
| `invalid_spec_point` | Vocabulary version above what the verifier supports | Update verifier |
| `wrong_context` / `wrong_type` | Not an Even Keel VC | Skip |
| `did_resolver_failed` / `status_resolver_failed` | Network / fetch failure | Retry; do NOT accept until resolved |
| `status_index_out_of_range` | Suspicious — bit pointer beyond list size | REJECT |
| `issuer_did_required` | Verifier policy requires a did:web issuer | Caller's choice |

---

## Caveats — what you should know before you ship

1. **Canonicalisation is a JCS subset, not full RFC 8785.** Two parties using `lib/vc/verifier.ts` agree on bytes. A third-party verifier using a strict RFC 8785 implementation may disagree on exotic Unicode shapes. Documented in [`lib/vc/issuer.ts`](../../lib/vc/issuer.ts) header.
2. **No JSON-LD context dereferencing.** Adding fields outside the schema documented here will not "just work" — they'll be canonicalised and signed but downstream verifiers may reject unknown fields.
3. **`did:web` only.** Other DID methods (`did:key`, `did:ion`, `did:ebsi`, `did:peer`) are not supported. Use a method router if you need to accept credentials issued under multiple methods.
4. **No selective disclosure.** Verifying an Even Keel credential always reveals every demonstrated spec-point. BBS+ / SD-JWT support is on the roadmap.
5. **Pilot DID is `did:web:samples.evenkeel.org` (not a real domain yet).** Production deployers must publish their own DID document at `https://<their-domain>/.well-known/did.json`.

---

## Comparison with adjacent ecosystems

See [COMPARISON.md](./COMPARISON.md) for a side-by-side with Open Badges 3.0, CLR 2.0, and OpenCreds.
