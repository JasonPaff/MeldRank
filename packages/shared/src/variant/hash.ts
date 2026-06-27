import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { VariantDefinition } from './schema';

/**
 * Stable content hash of a {@link VariantDefinition} (design D4). A match is
 * self-describing — `matches.variant_snapshot` carries the full definition and
 * `matches.variant_hash` carries this fingerprint — so a match remains replayable
 * even before a variant registry exists (`variant_id`/`variant_version` stay null
 * for ad-hoc casual). The room writer is the producer; this layer is the only one
 * that computes the hash, and it does so deterministically so two encoders of the
 * same variant agree.
 *
 * Determinism comes from {@link canonicalJson}: object keys are emitted in sorted
 * order (arrays keep their order, which is significant), so a re-ordered-but-equal
 * definition hashes identically. SHA-256 from the audited, isomorphic
 * `@noble/hashes` keeps the helper browser-safe — no Node crypto, no driver.
 */

/**
 * Canonical JSON serialization: object keys sorted lexicographically at every
 * depth, arrays preserved in order. The hash is taken over this string so the
 * fingerprint depends only on the variant's content, not on property insertion
 * order. Mirrors `JSON.stringify` for scalars (numbers/booleans/strings/null).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

/** SHA-256 hex digest of the variant's canonical JSON (design D4). */
export function hashVariant(variant: VariantDefinition): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(variant))));
}
