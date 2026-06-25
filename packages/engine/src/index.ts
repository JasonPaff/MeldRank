/**
 * MeldRank Game Engine — pure TypeScript with **zero runtime dependencies**.
 *
 * The engine stays dependency-free so it can run unchanged in the web client,
 * the Realtime Match Service, and bot workers. It consumes only the inferred
 * `VariantDefinition` *type* from `@meldrank/shared` (erased at build), never
 * Zod or any runtime import.
 *
 * On the foundation's domain model and hand-lifecycle structure this change adds
 * the first phase drivers — the pure `reduce(state, event)` state container, the
 * Dealer, and the AuctionManager — wiring the `Dealing → Auction` slice. The
 * remaining phase logic (DeclareTrump, MeldDetector, TrickResolver, scorers)
 * arrives in later changes.
 */

export const ENGINE_VERSION = '0.0.0';

/** Core domain entities: Card, Deck, Seat, Hand, Bid/Contract, Meld, Trick, ScorePad. */
export * from './domain';

/** Hand-lifecycle phases, the legal-transition table, and the active-path resolver. */
export * from './lifecycle';

/** The pure `reduce` state container: `State`, the `Event` union, and the reducer. */
export * from './state';

/** The deterministic, seed-injected Dealer and its injected-`rng` seam. */
export * from './dealer';

/** The AuctionManager: bid/pass legality, turn order, and termination outcomes. */
export * from './auction';
