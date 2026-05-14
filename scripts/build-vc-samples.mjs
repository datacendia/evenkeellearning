// ─────────────────────────────────────────────────────────────────────────────
// scripts/build-vc-samples.mjs
//
// v1.7.4 — Generates the public ecosystem outreach kit:
//   public/vc/sample-credential.json   — one signed Even Keel VC
//   public/vc/sample-did.json          — the matching did:web document
//   public/vc/sample-status-list.json  — a StatusList2021Credential pinning
//                                        the sample's status pointer to "0"
//
// All three artefacts are SELF-CONSISTENT: the credential's
// `proof.publicKeyB64url` matches the DID document's `publicKeyJwk` (when
// converted), and the credential's `credentialStatus.statusListIndex` is
// "0" inside the published status list (not revoked).
//
// Why a small reimplementation instead of importing lib/vc/*?
//   The lib modules are TypeScript. There is no TS runner registered for
//   .mjs scripts in this repo (see scripts/build-content-manifest.mjs for
//   the same trade-off). We mirror the minimum logic needed (canonical
//   JSON, Data Integrity proof shape, gzip+base64url bitstring) inline.
//   tests/unit/vc-samples.test.ts then loads the emitted JSON and runs it
//   through the REAL lib/vc/verifier — the test would fail loudly if any
//   field drifted from what the verifier expects.
//
// Determinism
// ───────────
// Uses a hard-coded PKCS8 P-256 private key so the generated sample is
// stable across runs. ECDSA signatures are non-deterministic (per spec —
// each sign uses fresh `k`), so the signature bytes differ per run, but
// every other byte is reproducible. To keep the committed sample's bytes
// stable across builds, run this script only when intentionally
// regenerating the kit, then commit the new files.
//
// Usage
// ─────
//   node scripts/build-vc-samples.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "vc");

// ─── Fixed sample key (PKCS8 base64url, ECDSA P-256) ──────────────────────
//
// Generated once via:
//   const kp = await crypto.subtle.generateKey({ name:"ECDSA", namedCurve:"P-256" },
//                 true, ["sign","verify"]);
//   await crypto.subtle.exportKey("pkcs8", kp.privateKey);
//
// NOT a production key. Anyone can sign sample credentials with it. The
// purpose is solely to make the published DID document's public-key JWK
// reproducible across regenerations of the sample kit.
const SAMPLE_PKCS8_B64URL =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgtT2LqJm7DCZYuZwUfl0pJ3iVZYslxiu3ylzUZDFZL9OhRANCAAT7fqXXHNlLDQpMvVkG-ug7fC1tyYZ2yktRp_1JmWFrvm3eMtOCUWTXYRmf5ov4fmHqGZeo80SaYw0lgwQ0Ox7W";

const ISSUER_DID = "did:web:samples.evenkeel.org";
const VM_FRAGMENT = "key-1";
const STATUS_LIST_URL = "https://samples.evenkeel.org/sl/2026A";
const SAMPLE_VC_ID = "urn:evenkeel:vc:sample-2026-001";

// ─── base64url + canonical JSON ───────────────────────────────────────────

function base64UrlFromBytes(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesFromBase64Url(b64url) {
  const padded = b64url + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") +
    "}"
  );
}

// ─── Sign a string under the sample key ────────────────────────────────────

async function loadSampleKeyPair() {
  const pkcs8 = bytesFromBase64Url(SAMPLE_PKCS8_B64URL);
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  );
  // Re-derive the public key by exporting JWK → trimming `d` → re-importing.
  const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const publicKey = await webcrypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const spki = await webcrypto.subtle.exportKey("spki", publicKey);
  return {
    privateKey,
    publicKey,
    publicJwk,
    publicKeyB64url: base64UrlFromBytes(new Uint8Array(spki)),
  };
}

/**
 * Mirrors lib/crypto/signing.ts: the signer hashes the canonical JSON
 * of `{ canonical: <string> }`, then signs the UTF-8 bytes of the
 * base64url-encoded digest. Verifier reproduces this exact wrapping.
 */
async function signProof(privateKey, canonicalString) {
  const wrapperJson = JSON.stringify({ canonical: canonicalString });
  const digest = createHash("sha256").update(wrapperJson).digest();
  const digestB64url = base64UrlFromBytes(digest);
  const sig = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    Buffer.from(digestB64url, "utf8"),
  );
  return base64UrlFromBytes(new Uint8Array(sig));
}

// ─── DID document ──────────────────────────────────────────────────────────

function buildDidDocument(publicJwk) {
  const vmId = `${ISSUER_DID}#${VM_FRAGMENT}`;
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/suites/jws-2020/v1",
    ],
    id: ISSUER_DID,
    verificationMethod: [
      {
        id: vmId,
        type: "JsonWebKey2020",
        controller: ISSUER_DID,
        publicKeyJwk: publicJwk,
      },
    ],
    assertionMethod: [vmId],
    authentication: [vmId],
  };
}

// ─── StatusList2021Credential ──────────────────────────────────────────────

const STATUS_LIST_BITS = 131_072; // spec-recommended minimum.

function buildEmptyEncodedList() {
  const bytes = new Uint8Array(STATUS_LIST_BITS / 8);
  const gz = gzipSync(bytes);
  return base64UrlFromBytes(gz);
}

async function buildStatusListCredential(privateKey, publicKeyB64url, encodedList) {
  const validFrom = new Date("2026-05-11T10:00:00.000Z").toISOString();
  const unsigned = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: STATUS_LIST_URL,
    type: ["VerifiableCredential", "StatusList2021Credential"],
    issuer: ISSUER_DID,
    validFrom,
    credentialSubject: {
      id: `${STATUS_LIST_URL}#list`,
      type: "StatusList2021",
      statusPurpose: "revocation",
      encodedList,
    },
  };
  const canonical = canonicalJson(unsigned);
  const proofValue = await signProof(privateKey, canonical);
  return {
    ...unsigned,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-jcs-2019",
      created: validFrom,
      verificationMethod: `${ISSUER_DID}#${VM_FRAGMENT}`,
      proofPurpose: "assertionMethod",
      proofValue,
      publicKeyB64url,
    },
  };
}

// ─── EvenKeelAttestationCredential ─────────────────────────────────────────

async function buildSampleCredential(privateKey, publicKeyB64url) {
  const validFrom = new Date("2026-05-11T10:00:00.000Z").toISOString();
  const unsigned = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: SAMPLE_VC_ID,
    type: ["VerifiableCredential", "EvenKeelAttestationCredential"],
    issuer: ISSUER_DID,
    validFrom,
    credentialSubject: {
      id: "urn:evenkeel:learner:sample-alex",
      type: "Learner",
      claim: "DemonstratedMastery",
      demonstratedSpecPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A18",
          label: "Solve quadratic equations",
          claimVocabularyVersion: 1,
        },
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A19",
          label: "Quadratic graphs and roots",
          claimVocabularyVersion: 1,
        },
      ],
      evidenceContentDigestB64url: "samp1eEv1denceD1gestPref1xExtended_______",
      problemId: "alg-quad-sample-01",
      reviewerNote: "Strong reasoning chain with no prompts.",
    },
    credentialStatus: {
      id: `${STATUS_LIST_URL}#0`,
      type: "StatusList2021Entry",
      statusPurpose: "revocation",
      statusListIndex: "0",
      statusListCredential: STATUS_LIST_URL,
    },
  };
  const canonical = canonicalJson(unsigned);
  const proofValue = await signProof(privateKey, canonical);
  return {
    ...unsigned,
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-jcs-2019",
      created: validFrom,
      verificationMethod: `${ISSUER_DID}#${VM_FRAGMENT}`,
      proofPurpose: "assertionMethod",
      proofValue,
      publicKeyB64url,
    },
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const { privateKey, publicJwk, publicKeyB64url } = await loadSampleKeyPair();

  const didDoc = buildDidDocument(publicJwk);
  const encodedList = buildEmptyEncodedList();
  const statusListCred = await buildStatusListCredential(
    privateKey,
    publicKeyB64url,
    encodedList,
  );
  const sampleCred = await buildSampleCredential(privateKey, publicKeyB64url);

  const writes = [
    ["sample-did.json", didDoc],
    ["sample-status-list.json", statusListCred],
    ["sample-credential.json", sampleCred],
  ];
  for (const [name, value] of writes) {
    const path = join(OUT_DIR, name);
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
    console.log(`wrote ${path}`);
  }

  console.log("\nVC ecosystem outreach kit regenerated.");
  console.log(`  issuer DID:        ${ISSUER_DID}`);
  console.log(`  status list URL:   ${STATUS_LIST_URL}`);
  console.log(`  sample VC id:      ${SAMPLE_VC_ID}`);
  console.log(`  publicKeyB64url:   ${publicKeyB64url.slice(0, 24)}…`);
  console.log("\nNext: run `npx vitest run tests/unit/vc-samples.test.ts` to");
  console.log("verify the generated triple round-trips through lib/vc/verifier.");
}

main().catch((e) => {
  console.error("build-vc-samples failed:", e);
  process.exit(1);
});
