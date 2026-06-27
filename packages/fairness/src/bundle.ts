import { z } from 'zod';

/**
 * The reveal bundle — the replay-sufficient record of one hand's randomness,
 * per design D7. It carries everything a third party needs to recompute the
 * deal offline: the hand nonce, the published `commit`, the revealed
 * `serverSeed`, every seat's contribution (a `clientSeed` or a substitution
 * marker), and a digest of the dealt result. Persistence and transport belong to
 * later slices; this module only defines the shape and validates it.
 *
 * All byte fields are lowercase hex. The fixed-width fields (`commit`,
 * `serverSeed`, `dealtResultDigest`, and each `clientSeed`) are 32 bytes, so they
 * are pinned to exactly 64 hex characters.
 */

/** Lowercase hex of a 32-byte value (64 hex chars). */
const hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 32-byte lowercase hex (64 chars)');

/**
 * One seat's revealed contribution: either the actual `clientSeed`
 * (`substituted: false`) or a marker that the seat was filled by the
 * missing-reveal fallback (`substituted: true`). The `substituted` flag is the
 * discriminant, so a malformed mix (a substituted seat carrying a seed, say) is
 * rejected at parse time.
 */
export const SeatContributionRevealSchema = z.discriminatedUnion('substituted', [
  z.object({
    seat: z.number().int().nonnegative(),
    substituted: z.literal(false),
    clientSeed: hex32,
  }),
  z.object({
    seat: z.number().int().nonnegative(),
    substituted: z.literal(true),
  }),
]);

export type SeatContributionReveal = z.infer<typeof SeatContributionRevealSchema>;

/**
 * The full reveal bundle. Beyond field shapes, the `contributions` array is
 * required to cover exactly seats `0..n-1` once each, so the seat set is total
 * and unambiguous — `verify` can assemble the seed directly from it.
 */
export const RevealBundleSchema = z
  .object({
    handNonce: z.number().int().nonnegative(),
    commit: hex32,
    serverSeed: hex32,
    contributions: z.array(SeatContributionRevealSchema).nonempty(),
    dealtResultDigest: hex32,
  })
  .refine(
    (bundle) => {
      const seats = bundle.contributions.map((contribution) => contribution.seat).sort((a, b) => a - b);
      return seats.every((seat, index) => seat === index);
    },
    { message: 'contributions must cover seats 0..n-1 exactly once', path: ['contributions'] },
  );

export type RevealBundle = z.infer<typeof RevealBundleSchema>;
