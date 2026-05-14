# Even Keel VCs vs. adjacent ecosystems

A side-by-side comparison so an integrator can decide whether Even Keel credentials slot into their existing trust infrastructure or require a parallel verifier.

**Status:** v1.7.4. Honest about what the pilot does NOT yet do.

---

## At a glance

| Capability | Even Keel | Open Badges 3.0 | CLR 2.0 | OpenCreds (W3C VC base) |
|---|---|---|---|---|
| **Envelope** | W3C VC 2.0 | W3C VC 2.0 | W3C VC 2.0 (CLR is a VC) | W3C VC 2.0 |
| **Subject type** | `Learner` | `AchievementSubject` | `Learner` (with embedded achievements) | application-defined |
| **Specific credential `type`** | `EvenKeelAttestationCredential` | `OpenBadgeCredential` | `ClrCredential` | application-defined |
| **Proof format** | Data Integrity Proof, `ecdsa-jcs-2019` | DI Proof OR JWT (VC-JOSE) | DI Proof OR JWT | DI Proof OR JWT |
| **Issuer identity** | `did:web` | DID OR HTTPS profile URL | DID OR HTTPS profile URL | DID OR HTTPS profile URL |
| **Revocation** | StatusList2021 (gzipped bitstring) | StatusList2021 OR Bitstring Status List | StatusList2021 OR Bitstring Status List | StatusList2021 OR Bitstring Status List |
| **Selective disclosure** | ❌ pilot | ❌ none in spec | ❌ none in spec | ✓ via BBS+ / SD-JWT (separate spec) |
| **Curriculum vocabulary** | `(framework, code, claimVocabularyVersion)` typed claim, registry pending | Free-form `Achievement.criteria.narrative` + tag list | `Achievement` with `inLanguage`, `educationalLevel`, etc. | application-defined |
| **Underlying evidence** | Linked by sha256 digest (CRT envelope, NOT exposed in claim) | `Evidence` array (URLs + descriptions) | `Evidence` array | application-defined |
| **Endorsement / counter-signing** | Required: every claim is a teacher-counter-signed CRT | `Endorsement` credential (optional, separate VC) | `Endorsement` credential | application-defined |
| **Verifier complexity** | One module, ~600 LOC | Requires Open Badges-aware libs (e.g., Inversify badges-shared) | Requires CLR-aware libs | Generic VC libs |

---

## What Even Keel shares with the rest

- **W3C VC 2.0 envelope.** A generic VC verifier that knows `@context: https://www.w3.org/ns/credentials/v2` can structurally parse the credential.
- **Data Integrity Proof.** The proof block is the same shape (`type: DataIntegrityProof`, `cryptosuite`, `proofValue`, etc.) as OB3 / CLR / OpenCreds.
- **StatusList2021.** Revocation is checked the same way: fetch the issuer's status list, decode the gzip-base64url bitstring, read the bit. A verifier that already implements StatusList2021 needs no new code.
- **`did:web` resolution.** Same algorithm as the W3C did-method-web spec — fetch `https://<host>/.well-known/did.json`, validate `id`, look up the verification method by fragment.
- **JsonWebKey2020.** The DID document publishes a standard JWK, importable by any Web Crypto stack.

This means: **a verifier built for Open Badges 3.0 with StatusList2021 + did:web support will accept Even Keel credentials at the structural level**. It will fail to recognise the `EvenKeelAttestationCredential` type unless explicitly added, but the proof + revocation + DID parts work as-is.

---

## What Even Keel does differently

### 1. The claim vocabulary is typed and versioned

OB3 / CLR identify achievements with free-form text (`Achievement.criteria.narrative`, plus tags). Comparing across awarders is hard — "Solving quadratic equations" might map to AQA A18, Edexcel something else, or CCSS HSA-REI.B.4.

Even Keel ships a structured `(framework, code, claimVocabularyVersion)` tuple. A verifier can:

- Match exactly across issuers using the same framework.
- Map between frameworks via a registry (Phase A — see below).
- Reject a claim whose vocabulary version is newer than what the verifier supports.

### 2. The credential is bound to underlying evidence by digest

OB3 / CLR `Evidence` arrays carry URLs to artefacts that may or may not still exist. Even Keel credentials carry an `evidenceContentDigestB64url` — a sha256 of the underlying Cognitive Reasoning Trace (the keystroke-level recording of the learner's session). The trace itself stays with the learner; the credential proves it existed and was reviewed without exposing it.

### 3. Every credential is teacher-counter-signed

OB3 / CLR allow self-attested claims and treat counter-signature as a separate `Endorsement` credential. Every Even Keel credential is, by definition, a teacher-counter-signed attestation — a learner cannot mint one. The teacher's passkey signature lives inside the `evidenceContentDigestB64url` chain; the wrapping VC is signed by the issuer (the school's DID).

### 4. The verifier deliberately runs in the browser

A verifier that requires a server call to the issuer is no verifier — the issuer could lie. Even Keel's `/verify` page runs entirely client-side, against the credential's embedded public key cross-checked with the issuer's published DID document.

---

## What Even Keel does NOT yet do

These gaps are real. Don't ship a deployment that needs them without filling them in.

### Selective disclosure
A learner showing an Even Keel credential reveals every demonstrated spec-point + the teacher's reviewer note. There is no way to disclose "I have a quadratic equation credential" without also revealing the specific problem id.

OB3 / CLR don't solve this either; the wider VC ecosystem solves it via BBS+ signatures or SD-JWT. Both require non-trivial cryptographic work. On the roadmap; not in the pilot.

### DID methods other than `did:web`
`did:key`, `did:ion`, `did:ebsi`, `did:peer` not supported. A verifier that wants to accept Even Keel credentials AND credentials issued under another DID method needs to wire its own method router.

### Full RFC 8785 JCS canonicalisation
The pilot uses a JCS subset (sorted keys, deterministic stringify). Two parties using `lib/vc/verifier.ts` agree byte-for-byte. A third-party verifier using a strict RFC 8785 implementation may disagree on rare Unicode shapes (specifically, codepoints that require canonical Unicode normalisation). Documented inline in [`lib/vc/issuer.ts`](../../lib/vc/issuer.ts).

### Linked-data context dereferencing
The verifier treats `@context` as opaque. We do not fetch context URLs and do not expand JSON-LD. Adding fields beyond the documented schema will be canonicalised and signed but downstream verifiers may reject them.

### Curriculum registry resolution
The `(framework, code)` tuple is canonical, but there is no registry yet that maps it to a stable URI or cross-walks frameworks. Phase A (`p15-curriculum`) will land:

- A typed `framework + code → skillUri` registry.
- Cross-walks (AQA A18 ↔ Edexcel ↔ CCSS).
- A dashboard showing per-framework coverage of authored content.

When Phase A ships, existing credentials become richer for free: the verifier can resolve `framework + code` to the registry's `skillUri` without needing the credential to carry it. The reserved-but-empty `skillUri` field on every issued credential makes this seamless.

---

## When NOT to use Even Keel credentials

Be honest:

- **You need selective disclosure today.** Use SD-JWT-VC or BBS+ Open Badges.
- **You're issuing badges for completion of a course.** Open Badges 3.0 is the more idiomatic choice — it's designed for "the bearer completed X" and has wide LMS / portfolio support.
- **Your issuer can't host a `did:web` document.** Use a VC system that accepts HTTPS-profile issuers.
- **Your verifier won't run JavaScript.** The pilot's verifier is browser-side; an offline native verifier would need a port (the underlying primitives are standard, the port is mechanical).
