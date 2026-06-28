import { z } from 'zod';
import { VariantDefinitionSchema } from '../variant/schema';

/**
 * The API↔Match room-spawn contract (design D1): the schema pair the API sends to
 * and receives from the match service's internal spawn seam. The schemas are
 * transport-agnostic — they describe the payloads, not that they travel over HTTP
 * (the chosen transport this slice; see design D1's flagged deviation from the
 * Redis-pub/sub wording).
 */

/**
 * One seat's assignment in a spawn request: a human-reserved seat (carrying the
 * stub `playerId` whose ticket will admit it) or a bot-filled seat (filled at room
 * creation, awaiting no ticket).
 */
export const SpawnSeatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), playerId: z.string().min(1) }),
  z.object({ kind: z.literal('bot') }),
]);

export type SpawnSeat = z.infer<typeof SpawnSeatSchema>;

/**
 * The spawn request: the frozen variant (id + full snapshot), the per-seat seating
 * assignment marking each seat human-reserved or bot-filled, and the bot count
 * (redundant with `seating` but carried explicitly so the match service can fill
 * bots without re-deriving). The match service maps this onto
 * `matchMaker.createRoom('match', …)`.
 */
export const RoomSpawnRequestSchema = z.object({
  variantId: z.string().min(1),
  variant: VariantDefinitionSchema,
  seating: z.array(SpawnSeatSchema).min(1),
  bots: z.number().int().nonnegative(),
});

export type RoomSpawnRequest = z.infer<typeof RoomSpawnRequestSchema>;

/** The spawn response: the room handle (room id) the client connects to. */
export const RoomSpawnResponseSchema = z.object({
  roomId: z.string().min(1),
});

export type RoomSpawnResponse = z.infer<typeof RoomSpawnResponseSchema>;

/**
 * The internal spawn seam's HTTP coordinates, shared by both sides so the API's
 * client and the match service's route never drift: the route path and the header
 * the shared internal secret is presented in (design D1).
 */
export const INTERNAL_SPAWN_PATH = '/internal/rooms';
export const INTERNAL_SECRET_HEADER = 'x-internal-secret';
