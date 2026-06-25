/**
 * MeldRank Game Engine — pure TypeScript with **zero runtime dependencies**.
 *
 * The engine stays dependency-free so it can run unchanged in the web client,
 * the Realtime Match Service, and bot workers. The bidding, meld-scoring, and
 * trick-play rules arrive in later changes; this stub exists only to prove the
 * package builds, exports cleanly, and is ready for exhaustive unit testing.
 */

export const ENGINE_VERSION = '0.0.0';

export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds';

/** Pure, deterministic placeholder: is `card`'s suit the trump suit? */
export function isTrump(card: Suit, trump: Suit): boolean {
  return card === trump;
}
