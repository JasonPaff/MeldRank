import { z } from 'zod';
import { VariantDefinitionSchema } from '../variant/schema';

/**
 * The versioned, opaque replay blob (design D7) — the match runtime's
 * self-describing record of everything needed to reproduce and audit a finished
 * match. It is serialized to the `match_replays.data` bytea column; no SQL ever
 * inspects it, so its meaning is owned solely by the Match Runtime and the eventual
 * replay verifier. A `format`/`schemaVersion` envelope lets later versions evolve
 * the shape without ambiguity.
 *
 * The heavy parts that stay **off the wire** live here, not in the
 * {@link MatchResultEvent}: the ordered intent log and each hand's seed reveal.
 * `Uint8Array` seeds are hex-encoded so the blob round-trips through JSON.
 */

/** Marker fields pinning the blob's shape (design D7). */
export const REPLAY_FORMAT = 'meldrank-replay';
export const REPLAY_SCHEMA_VERSION = 1;

/** Hex-encoded bytes (lower-case), the JSON-safe encoding of a `Uint8Array` seed. */
const HexBytesSchema = z.string().regex(/^[0-9a-f]*$/);

/** One side's as-scored line in a replayed hand (mirrors the projector's line input). */
export const ReplayHandLineSchema = z.object({
  side: z.number().int().nonnegative(),
  meld: z.number().int(),
  counters: z.number().int(),
  total: z.number().int(),
});

/** Per-hand summary in the replay blob — the same plain shape `projectHand` consumes. */
export const ReplayHandSummarySchema = z.object({
  handNumber: z.number().int().positive(),
  bidderSeat: z.number().int().nonnegative(),
  contractValue: z.number().int(),
  trump: z.string(),
  made: z.boolean(),
  lines: z.array(ReplayHandLineSchema),
  cumulativeBySide: z.record(z.string(), z.number().int()),
});

/**
 * One entry in the ordered intent log: the acting seat and either the accepted
 * player intent or a forced-timeout marker (`forcedTimeout: true`, `intent: null`).
 * The intent payload is stored opaquely (`z.unknown`) — the blob is never queried,
 * only replayed by the runtime that produced it.
 */
export const ReplayIntentEntrySchema = z.object({
  seat: z.number().int().nonnegative(),
  forcedTimeout: z.boolean(),
  intent: z.unknown().nullable(),
});

/** A hand's provably-fair seed reveal — hex-encoded so it survives JSON (design D7). */
export const ReplaySeedRevealSchema = z.object({
  handNonce: z.number().int().nonnegative(),
  serverSeed: HexBytesSchema,
  commit: HexBytesSchema,
  contributions: z.array(z.object({ seat: z.number().int().nonnegative(), clientSeed: HexBytesSchema })),
});

/** The versioned replay blob, schema version 1 (design D7). */
export const ReplayBlobV1Schema = z.object({
  format: z.literal(REPLAY_FORMAT),
  schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
  variant: VariantDefinitionSchema,
  hands: z.array(ReplayHandSummarySchema),
  intents: z.array(ReplayIntentEntrySchema),
  reveals: z.array(ReplaySeedRevealSchema),
});

export type ReplayHandLine = z.infer<typeof ReplayHandLineSchema>;
export type ReplayHandSummary = z.infer<typeof ReplayHandSummarySchema>;
export type ReplayIntentEntry = z.infer<typeof ReplayIntentEntrySchema>;
export type ReplaySeedReveal = z.infer<typeof ReplaySeedRevealSchema>;
export type ReplayBlobV1 = z.infer<typeof ReplayBlobV1Schema>;
