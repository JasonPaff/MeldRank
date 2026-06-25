import { buildDeck, type Deck, type DeckSpec } from '../domain/deck';
import { makeHand, type Hand } from '../domain/entities';
import type { Card } from '../domain/card';
import { boundedInt, type Rng } from './rng';

/**
 * The Dealer, per "Game Engine — Abstract Model" §5: it builds the deck from the
 * spec, shuffles it with an injected {@link Rng} (Fisher–Yates), and slices the
 * result into one {@link Hand} per seat plus the widow. Pure and deterministic —
 * the same spec and the same `rng` always produce the same deal — and free of
 * any runtime dependency. Entropy/keying live in Match Runtime; the Dealer owns
 * only the shuffle-and-slice algorithm.
 */

/** The result of a deal: one hand per seat (by seat index) and the widow. */
export interface DealResult {
  readonly hands: readonly Hand[];
  readonly widow: readonly Card[];
}

/**
 * Fisher–Yates shuffle of a deck using the injected `rng`. Returns a new array;
 * the input is not mutated. Iterates high → low, swapping each position with a
 * uniformly chosen earlier-or-equal position drawn via {@link boundedInt}.
 */
function shuffle(deck: Deck, rng: Rng): Card[] {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = boundedInt(rng, i + 1);
    const temp = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = temp;
  }
  return cards;
}

/**
 * Deal `deckSpec` into `playerCount` hands of `handSize` plus a `widowSize`
 * widow, where `playerCount` is derived from the deal-size invariant
 * `handSize × playerCount + widowSize === deck size`. A configuration that
 * violates the invariant (the remainder does not divide evenly into whole hands,
 * or yields a non-positive player count) is rejected with a thrown error rather
 * than producing a partial or overflowing deal — this is a configuration fault,
 * not a hot-path event, so it throws rather than returning a typed rejection.
 *
 * The shuffled deck is sliced contiguously: seat 0 takes the first `handSize`
 * cards, seat 1 the next, and so on, with the trailing `widowSize` cards forming
 * the widow. Because the shuffle is uniform, the slice order does not bias the
 * deal, and the union of all hands plus the widow conserves the deck exactly.
 */
export function deal(
  deckSpec: DeckSpec,
  handSize: number,
  widowSize: number,
  rng: Rng,
): DealResult {
  const deck = buildDeck(deckSpec);
  const dealtToHands = deck.length - widowSize;

  if (
    handSize <= 0 ||
    widowSize < 0 ||
    dealtToHands <= 0 ||
    dealtToHands % handSize !== 0
  ) {
    throw new Error(
      `Invalid deal configuration: handSize=${handSize}, widowSize=${widowSize}, ` +
        `deckSize=${deck.length} do not satisfy handSize × playerCount + widowSize === deckSize`,
    );
  }

  const playerCount = dealtToHands / handSize;
  const shuffled = shuffle(deck, rng);

  const hands: Hand[] = [];
  for (let seat = 0; seat < playerCount; seat++) {
    const start = seat * handSize;
    hands.push(makeHand(seat, shuffled.slice(start, start + handSize)));
  }
  const widow = shuffled.slice(playerCount * handSize);

  return { hands, widow };
}
