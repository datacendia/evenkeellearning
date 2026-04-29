// ─────────────────────────────────────────────────────────────────────────────
// lib/content/registry.ts
//
// v1.5.0 — Browser-side content registry. Loads the signed manifest and
// pack JSON files from `/content/`, verifies every signature against the
// trusted-reviewers list, and exposes deterministic lookup functions for
// the engine and UI surfaces.
//
// HONESTY
// ───────
// • Verification uses the same `lib/crypto/signing.ts` primitives as the
//   rest of the platform (ECDSA P-256 / SHA-256 over a base64url SHA-256
//   digest of the canonicalised payload). A tampered pack fails verify
//   and is dropped with a console warning; the surface that asked for
//   content from that pack falls through to the existing v1.4.5
//   hand-written `parallel-problems.ts` corpus.
// • This module is browser-only at runtime (uses fetch + SubtleCrypto).
//   Node-side scripts use `scripts/build-content-manifest.mjs` instead.
// • The registry is *additive*. If the manifest is missing or empty, the
//   engine continues to work exactly as v1.4.11 did; richer fields
//   (explanation, misconceptions) simply do not appear. There is no hard
//   dependency on the registry being populated.
// ─────────────────────────────────────────────────────────────────────────────

import { contentDigest, importPublicKey } from "../crypto/signing";
import {
  CONTENT_SCHEMA_VERSION,
  canonicaliseForHash,
  validateContentItem,
  validateContentPack,
  type SchemaContentItem,
  type SchemaContentManifest,
  type SchemaContentPack,
} from "./schema";

const MANIFEST_URL = "/content/manifest.json";
const SIGNING_ALG = { name: "ECDSA", hash: { name: "SHA-256" } } as const;

/** Loaded + verified pack, indexed for lookup. */
interface VerifiedPack {
  pack: SchemaContentPack;
  /** Items keyed by id for O(1) lookup. */
  byId: Map<string, SchemaContentItem>;
}

let cache: Promise<RegistryState> | null = null;

interface RegistryState {
  manifest: SchemaContentManifest | null;
  packs: Map<string, VerifiedPack>; // keyed by skillFamily
  /** Reasons individual packs were rejected (for transparency bundle). */
  rejections: { packId: string; reason: string }[];
}

const EMPTY_STATE: RegistryState = {
  manifest: null,
  packs: new Map(),
  rejections: [],
};

/** Resets the in-memory cache. Tests only. */
export function resetContentRegistry(): void {
  cache = null;
}

/**
 * Loads, verifies, and indexes the signed content manifest. Returns an
 * empty state if the manifest is missing or malformed — never throws on
 * a missing manifest, because the platform must work without it (v1.4.11
 * back-compat). Throws only on programmer errors.
 */
export function loadContentRegistry(): Promise<RegistryState> {
  if (!cache) cache = doLoad();
  return cache;
}

async function doLoad(): Promise<RegistryState> {
  if (typeof window === "undefined" || !window.fetch) return EMPTY_STATE;

  let manifest: SchemaContentManifest;
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[content] manifest HTTP ${res.status}; running without enriched content`);
      }
      return EMPTY_STATE;
    }
    manifest = (await res.json()) as SchemaContentManifest;
  } catch (e) {
    console.warn("[content] manifest fetch failed; running without enriched content", e);
    return EMPTY_STATE;
  }

  if (manifest.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    console.warn(
      `[content] manifest schemaVersion ${manifest.schemaVersion} ≠ runtime ${CONTENT_SCHEMA_VERSION}; ignoring`
    );
    return EMPTY_STATE;
  }

  const trusted = new Map(
    manifest.trustedReviewers.map((r) => [r.publicKeyB64url, r])
  );

  const packs = new Map<string, VerifiedPack>();
  const rejections: { packId: string; reason: string }[] = [];

  for (const entry of manifest.entries) {
    try {
      const res = await fetch(`/content/${entry.path}`, { cache: "no-cache" });
      if (!res.ok) {
        rejections.push({ packId: entry.packId, reason: `HTTP ${res.status}` });
        continue;
      }
      const pack = (await res.json()) as SchemaContentPack;

      const packErrs = validateContentPack(pack);
      if (packErrs.length) {
        rejections.push({ packId: entry.packId, reason: `validation: ${packErrs[0]}` });
        continue;
      }

      // Verify pack hash matches manifest
      const computed = await sha256B64Url(canonicaliseForHash(pack));
      if (computed !== entry.contentHashB64url) {
        rejections.push({ packId: entry.packId, reason: "content hash mismatch" });
        continue;
      }

      // Verify each item's reviewer signature
      const verifiedItems: SchemaContentItem[] = [];
      for (const item of pack.items) {
        const itemErrs = validateContentItem(item);
        if (itemErrs.length) continue;

        if (!trusted.has(item.approval.publicKeyB64url)) continue;

        const ok = await verifyItemSignature(item);
        if (!ok) continue;

        verifiedItems.push(item);
      }

      if (!verifiedItems.length) {
        rejections.push({ packId: entry.packId, reason: "no items survived verification" });
        continue;
      }

      const verifiedPack: SchemaContentPack = { ...pack, items: verifiedItems };
      packs.set(pack.skillFamily, {
        pack: verifiedPack,
        byId: new Map(verifiedItems.map((i) => [i.id, i])),
      });
    } catch (e) {
      rejections.push({
        packId: entry.packId,
        reason: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  if (rejections.length) {
    console.warn("[content] some packs were rejected", rejections);
  }

  return { manifest, packs, rejections };
}

async function verifyItemSignature(item: SchemaContentItem): Promise<boolean> {
  try {
    const { approval, ...rest } = item;
    // Signature was computed over base64url(SHA-256(canonical(itemSansApproval))),
    // mirroring the build-time signing path in scripts/build-content-manifest.mjs.
    const expectedDigest = await sha256B64Url(canonicaliseForHash(rest));
    const publicKey = await importPublicKey(approval.publicKeyB64url);
    const sigBytes = base64UrlToBytes(approval.signatureB64url);
    return await window.crypto.subtle.verify(
      SIGNING_ALG,
      publicKey,
      toArrayBuffer(sigBytes),
      toArrayBuffer(new TextEncoder().encode(expectedDigest))
    );
  } catch {
    return false;
  }
}

// ── Local helpers (mirror lib/crypto/signing.ts) ───────────────────────────
async function sha256B64Url(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await window.crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return bytesToB64Url(new Uint8Array(digest));
}
function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

// ── Public lookup API ───────────────────────────────────────────────────────

/** Returns the verified item for a (skillFamily, itemId) pair, or null. */
export async function getContentItem(
  skillFamily: string,
  itemId: string,
): Promise<SchemaContentItem | null> {
  const state = await loadContentRegistry();
  return state.packs.get(skillFamily)?.byId.get(itemId) ?? null;
}

/** Returns every verified item in a skill family (in pack order). */
export async function getFamilyItems(
  skillFamily: string,
): Promise<readonly SchemaContentItem[]> {
  const state = await loadContentRegistry();
  return state.packs.get(skillFamily)?.pack.items ?? [];
}

/**
 * Returns the misconception for a given (skillFamily, itemId, trigger).
 * Used by EkeChat to surface a teaching message after a categorised
 * wrong attempt. Returns null if no matching misconception exists.
 */
export async function getMisconception(
  skillFamily: string,
  itemId: string,
  trigger: string,
): Promise<{ explanation: string; nudge?: string } | null> {
  const item = await getContentItem(skillFamily, itemId);
  if (!item) return null;
  const m = item.misconceptions.find((m) => m.trigger === trigger);
  return m ? { explanation: m.explanation, nudge: m.nudge } : null;
}

/**
 * Returns the explanation for an item (shown after the comprehension
 * gate clears, or on explicit "show me how" after N wrong attempts).
 */
export async function getExplanation(
  skillFamily: string,
  itemId: string,
): Promise<string | null> {
  const item = await getContentItem(skillFamily, itemId);
  return item?.explanation ?? null;
}

/** Returns a brief summary of the registry for the transparency bundle. */
export async function getRegistrySummary(): Promise<{
  manifestVersion: string | null;
  packCount: number;
  itemCount: number;
  rejectionCount: number;
  trustedReviewerFingerprints: readonly string[];
}> {
  const s = await loadContentRegistry();
  let itemCount = 0;
  for (const p of s.packs.values()) itemCount += p.pack.items.length;
  return {
    manifestVersion: s.manifest?.version ?? null,
    packCount: s.packs.size,
    itemCount,
    rejectionCount: s.rejections.length,
    trustedReviewerFingerprints:
      s.manifest?.trustedReviewers.map((r) => r.fingerprint) ?? [],
  };
}
