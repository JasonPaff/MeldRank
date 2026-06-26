/**
 * MeldRank Game Engine — pure TypeScript with **zero runtime dependencies**.
 *
 * The engine stays dependency-free so it can run unchanged in the web client,
 * the Realtime Match Service, and bot workers. It consumes only the inferred
 * `VariantDefinition` *type* from `@meldrank/shared` (erased at build), never
 * Zod or any runtime import.
 *
 * On the foundation's domain model and hand-lifecycle structure the phase
 * drivers — the pure `reduce(state, event)` state container, the Dealer, the
 * AuctionManager, the deterministic WidowReveal transition, the DeclareTrump
 * driver, and the MeldDetector — wire the `Dealing → Auction → [WidowReveal] →
 * DeclareTrump → Melding → [Bury] → TrickPlay` slice (Melding is computed and
 * recorded as a deterministic transition). The remaining phase logic (TrickResolver,
 * scorers) arrives in later changes.
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

/** The WidowReveal transition: the deterministic widow reveal for widow variants. */
export * from './widow';

/** The DeclareTrump phase driver: `declareTrump` legality and the recorded trump. */
export * from './declare';

/** The MeldDetector: the pure maximum-legal-meld computation for the Melding phase. */
export * from './meld';
