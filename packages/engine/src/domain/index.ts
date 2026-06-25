/**
 * The engine's core domain model: pure, dependency-free data types and thin
 * constructors/helpers for Card, Deck, Seat, Hand, Bid/Contract, Meld, Trick,
 * and ScorePad. No rules logic lives here.
 */
export {
  makeCard,
  cardValueKey,
  cardIdentityKey,
  cardsValueEqual,
  cardsIdentical,
  type Rank,
  type Suit,
  type Card,
} from './card';

export {
  buildDeck,
  buildDeckForVariant,
  deckSpecFromVariant,
  type DeckSpec,
  type Deck,
} from './deck';

export { deriveSeats, type Seat } from './seat';

export {
  makeHand,
  makeBid,
  makeContract,
  makeMeld,
  makeTrick,
  makeHandScoreLine,
  createScorePad,
  appendHand,
  type Hand,
  type Bid,
  type Contract,
  type MeldClass,
  type Meld,
  type TrickPlay,
  type Trick,
  type HandScoreLine,
  type ScorePad,
} from './entities';
