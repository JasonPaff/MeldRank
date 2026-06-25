/**
 * MeldRank Game Engine — pure TypeScript with **zero runtime dependencies**.
 *
 * The engine stays dependency-free so it can run unchanged in the web client,
 * the Realtime Match Service, and bot workers. It consumes only the inferred
 * `VariantDefinition` *type* from `@meldrank/shared` (erased at build), never
 * Zod or any runtime import.
 *
 * This change lays the foundation: the core domain model and the hand-lifecycle
 * state-machine structure. The phase logic (Dealer, AuctionManager,
 * MeldDetector, TrickResolver, scorers) arrives in later changes.
 */

export const ENGINE_VERSION = '0.0.0';

/** Core domain entities: Card, Deck, Seat, Hand, Bid/Contract, Meld, Trick, ScorePad. */
export * from './domain';

/** Hand-lifecycle phases, the legal-transition table, and the active-path resolver. */
export * from './lifecycle';
