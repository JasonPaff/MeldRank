import { makeHand, type Hand } from '../domain/entities';
import type { Card } from '../domain/card';

/**
 * The WidowReveal transition, per "Game Engine — Abstract Model" §2 and design
 * decision 2. A single pure function the reducer folds on auction conclusion for
 * widow variants: it moves the unrevealed widow into the bid winner's `Hand`,
 * empties the widow, and records the revealed cards so the canonical *exposed*
 * widow lands in public state. No player intent drives it — the reveal is
 * deterministic — and it adds nothing to the closed `Event` union.
 */

/**
 * The result of revealing the widow: the post-reveal hands (the winner's hand
 * grown by the widow), the now-empty widow, and the cards that were revealed.
 */
export interface WidowRevealResult {
  readonly hands: readonly Hand[];
  readonly widow: readonly Card[];
  readonly revealedWidow: readonly Card[];
}

/**
 * Reveal `widow` into the seat at `winnerSeat`: append the widow cards to that
 * seat's hand, empty the widow, and report the revealed cards. Pure — the input
 * hands and widow are not mutated. The union of all hands and the (now empty)
 * widow conserves the dealt cards as a multiset: no card is lost or duplicated.
 */
export function revealWidow(hands: readonly Hand[], widow: readonly Card[], winnerSeat: number): WidowRevealResult {
  const nextHands = hands.map((hand) => (hand.seatIndex === winnerSeat ? makeHand(hand.seatIndex, [...hand.cards, ...widow]) : hand));
  return { hands: nextHands, widow: [], revealedWidow: widow };
}
