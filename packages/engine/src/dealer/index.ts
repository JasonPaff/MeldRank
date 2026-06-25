/**
 * The Dealer: a deterministic, seed-injected shuffle-and-slice that distributes
 * a deck into per-seat hands plus the widow, enforcing the deal-size invariant.
 * Owns the shuffle algorithm; the entropy is injected.
 */
export { deal, type DealResult } from './deal';
export { createSeededRng, boundedInt, type Rng } from './rng';
