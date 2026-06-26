/**
 * Player intent payload types (the locked "API Surface" §4 wire intents),
 * consumed type-only by `@meldrank/engine`. Types only — the Zod validation of
 * these messages belongs to the Match Service / client boundary, not here.
 */
export type {
  CardRef,
  BidIntent,
  PassIntent,
  DeclareTrumpIntent,
  PlayCardIntent,
  BuryIntent,
  PlayerIntent,
  PlayerIntentKind,
} from './types';
