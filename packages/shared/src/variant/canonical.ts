import { VariantDefinitionSchema, type VariantDefinition } from './schema';

/**
 * The two canonical ranked rulesets, encoded as deeply-frozen
 * `VariantDefinition` fixtures from the locked Linear docs "Ranked Ruleset —
 * Single-Deck Partners (Canonical)" and "Ranked Ruleset — Single-Deck Cutthroat
 * / Auction Pinochle (Canonical)".
 *
 * These are the executable contract against the design docs: a fidelity test
 * pins every axis to the documented value, and every later engine change uses
 * them as fixtures. Both are validated through `VariantDefinitionSchema` at
 * construction so an authoring mistake fails loudly here, not downstream.
 */

/** The standard single-deck ranks and suits shared by both canonical variants. */
const SINGLE_DECK_RANKS = ['A', '10', 'K', 'Q', 'J', '9'] as const;
const ALL_SUITS = ['spades', 'hearts', 'clubs', 'diamonds'] as const;

/** Standard pinochle counter values and last-trick bonus, common to both variants. */
const STANDARD_COUNTERS = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0 } as const;
const LAST_TRICK_BONUS = 10;

/**
 * Recursively freeze an object so the exported fixtures cannot be mutated at
 * runtime. TypeScript already reports the properties as readonly via the schema
 * inference; this guards the runtime object too.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Single-Deck Partners (Canonical): 48-card deck, 4 players in two opposite
 * partnerships, hand size 12, no widow/bury/passing, minimum bid 250, all-pass
 * forces the dealer in at the minimum, all seats meld, all sides score, set is
 * −bid with meld lost, race to 1500, rated on team win/loss.
 */
export const SINGLE_DECK_PARTNERS: Readonly<VariantDefinition> = deepFreeze(
  VariantDefinitionSchema.parse({
    id: 'single-deck-partners',
    name: 'Single-Deck Partners',
    deck: { ranks: SINGLE_DECK_RANKS, suits: ALL_SUITS, copiesPerCard: 2 },
    seating: {
      playerCount: 4,
      teams: { mode: 'partnerships', partnerships: [[0, 2], [1, 3]] },
    },
    dealing: {
      handSize: 12,
      widow: { size: 0, visibility: 'hidden' },
      bury: { size: 0, restrictions: [] },
    },
    passing: { count: 0, passBack: false },
    bidding: {
      minimumBid: 250,
      increment: 10,
      passBehavior: 'pass-out-for-hand',
      allPassRule: 'dealer-forced-minimum',
    },
    trumpDeclaredBy: 'bid-winner',
    melding: { whoMelds: 'all-seats', meldTableId: 'standard-single-deck' },
    trick: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeat: true,
      identicalCardTie: 'first-played-wins',
    },
    scoring: {
      counters: STANDARD_COUNTERS,
      lastTrickBonus: LAST_TRICK_BONUS,
      meldNeedsATrick: true,
      mode: 'all-sides-score',
      setPenalty: 'minus-bid-and-meld-lost',
    },
    matchEnd: { mode: 'target-score', target: 1500 },
    ratingBasis: 'team-win-loss',
  }),
);

/**
 * Single-Deck Cutthroat / Auction Pinochle (Canonical): 48-card deck, 3 teamless
 * players, hand size 15, a 3-card exposed widow, a 3-card restricted bury (no
 * melded cards, no trump, no dix), no passing, minimum bid 300, all-pass redeals,
 * only the bidder melds, the bidder scores against the bid (defenders score 0),
 * set is −bid, a fixed 9 deals, rated on individual placement.
 */
export const SINGLE_DECK_CUTTHROAT: Readonly<VariantDefinition> = deepFreeze(
  VariantDefinitionSchema.parse({
    id: 'single-deck-cutthroat',
    name: 'Single-Deck Cutthroat / Auction Pinochle',
    deck: { ranks: SINGLE_DECK_RANKS, suits: ALL_SUITS, copiesPerCard: 2 },
    seating: { playerCount: 3, teams: { mode: 'free-for-all' } },
    dealing: {
      handSize: 15,
      widow: { size: 3, visibility: 'exposed' },
      bury: { size: 3, restrictions: ['no-melded', 'no-trump', 'no-dix'] },
    },
    passing: { count: 0, passBack: false },
    bidding: {
      minimumBid: 300,
      increment: 10,
      passBehavior: 'pass-out-for-hand',
      allPassRule: 'redeal',
    },
    trumpDeclaredBy: 'bid-winner',
    melding: { whoMelds: 'bidder-only', meldTableId: 'standard-single-deck' },
    trick: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeat: true,
      identicalCardTie: 'first-played-wins',
    },
    scoring: {
      counters: STANDARD_COUNTERS,
      lastTrickBonus: LAST_TRICK_BONUS,
      meldNeedsATrick: true,
      mode: 'bidder-vs-bid',
      setPenalty: 'minus-bid',
    },
    matchEnd: { mode: 'fixed-deals', deals: 9 },
    ratingBasis: 'individual-placement',
  }),
);
