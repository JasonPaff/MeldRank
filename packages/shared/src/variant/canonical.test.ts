import { describe, expect, it } from 'vitest';
import { VariantDefinitionSchema } from './schema';
import { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT } from './canonical';

const STANDARD_COUNTERS = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0 };

describe('canonical variant fixtures', () => {
  it('both fixtures parse cleanly against the schema', () => {
    expect(VariantDefinitionSchema.safeParse(SINGLE_DECK_PARTNERS).success).toBe(true);
    expect(VariantDefinitionSchema.safeParse(SINGLE_DECK_CUTTHROAT).success).toBe(true);
  });

  describe('SINGLE_DECK_PARTNERS matches the locked Partners doc', () => {
    const v = SINGLE_DECK_PARTNERS;

    it('encodes the 48-card single deck', () => {
      expect(v.deck.ranks).toEqual(['A', '10', 'K', 'Q', 'J', '9']);
      expect(v.deck.suits).toEqual(['spades', 'hearts', 'clubs', 'diamonds']);
      expect(v.deck.copiesPerCard).toBe(2);
      expect(v.deck.ranks.length * v.deck.suits.length * v.deck.copiesPerCard).toBe(48);
    });

    it('seats 4 players in two opposite partnerships', () => {
      expect(v.seating.playerCount).toBe(4);
      expect(v.seating.teams).toEqual({ mode: 'partnerships', partnerships: [[0, 2], [1, 3]] });
    });

    it('deals hand size 12 with no widow, bury, or passing', () => {
      expect(v.dealing.handSize).toBe(12);
      expect(v.dealing.widow.size).toBe(0);
      expect(v.dealing.bury.size).toBe(0);
      expect(v.passing.count).toBe(0);
    });

    it('bids from 250 by 10, forcing the dealer in at the minimum on all-pass', () => {
      expect(v.bidding.minimumBid).toBe(250);
      expect(v.bidding.increment).toBe(10);
      expect(v.bidding.passBehavior).toBe('pass-out-for-hand');
      expect(v.bidding.allPassRule).toBe('dealer-forced-minimum');
    });

    it('declares trump by the bid winner and melds at all seats', () => {
      expect(v.trumpDeclaredBy).toBe('bid-winner');
      expect(v.melding.whoMelds).toBe('all-seats');
      expect(v.melding.meldTableId).toBe('standard-single-deck');
    });

    it('uses strict must-beat trick rules and first-played-wins ties', () => {
      expect(v.trick).toEqual({
        mustFollowSuit: true,
        mustTrumpWhenVoid: true,
        mustBeat: true,
        identicalCardTie: 'first-played-wins',
      });
    });

    it('scores all sides with standard counters, meld-needs-a-trick, and −bid+meld-lost set', () => {
      expect(v.scoring.counters).toEqual(STANDARD_COUNTERS);
      expect(v.scoring.lastTrickBonus).toBe(10);
      expect(v.scoring.meldNeedsATrick).toBe(true);
      expect(v.scoring.mode).toBe('all-sides-score');
      expect(v.scoring.setPenalty).toBe('minus-bid-and-meld-lost');
    });

    it('ends the match at target 1500 and rates on team win/loss', () => {
      expect(v.matchEnd).toEqual({ mode: 'target-score', target: 1500 });
      expect(v.ratingBasis).toBe('team-win-loss');
    });
  });

  describe('SINGLE_DECK_CUTTHROAT matches the locked Auction doc', () => {
    const v = SINGLE_DECK_CUTTHROAT;

    it('encodes the 48-card single deck', () => {
      expect(v.deck.ranks).toEqual(['A', '10', 'K', 'Q', 'J', '9']);
      expect(v.deck.copiesPerCard).toBe(2);
      expect(v.deck.ranks.length * v.deck.suits.length * v.deck.copiesPerCard).toBe(48);
    });

    it('seats 3 teamless players', () => {
      expect(v.seating.playerCount).toBe(3);
      expect(v.seating.teams).toEqual({ mode: 'free-for-all' });
    });

    it('deals hand size 15 with a 3-card exposed widow and restricted 3-card bury', () => {
      expect(v.dealing.handSize).toBe(15);
      expect(v.dealing.widow).toEqual({ size: 3, visibility: 'exposed' });
      expect(v.dealing.bury).toEqual({ size: 3, restrictions: ['no-melded', 'no-trump', 'no-dix'] });
      expect(v.passing.count).toBe(0);
    });

    it('bids from 300 by 10, redealing on all-pass', () => {
      expect(v.bidding.minimumBid).toBe(300);
      expect(v.bidding.increment).toBe(10);
      expect(v.bidding.allPassRule).toBe('redeal');
    });

    it('melds bidder-only against the standard table', () => {
      expect(v.melding.whoMelds).toBe('bidder-only');
      expect(v.melding.meldTableId).toBe('standard-single-deck');
    });

    it('scores bidder-vs-bid with the same counters and a −bid set', () => {
      expect(v.scoring.counters).toEqual(STANDARD_COUNTERS);
      expect(v.scoring.lastTrickBonus).toBe(10);
      expect(v.scoring.mode).toBe('bidder-vs-bid');
      expect(v.scoring.setPenalty).toBe('minus-bid');
    });

    it('ends after a fixed 9 deals and rates on individual placement', () => {
      expect(v.matchEnd).toEqual({ mode: 'fixed-deals', deals: 9 });
      expect(v.ratingBasis).toBe('individual-placement');
    });
  });

  describe('fixtures are deeply frozen', () => {
    it('prevents top-level mutation', () => {
      expect(Object.isFrozen(SINGLE_DECK_PARTNERS)).toBe(true);
      expect(() => {
        // @ts-expect-error — readonly fixture, mutation must not compile or take effect
        SINGLE_DECK_PARTNERS.id = 'mutated';
      }).toThrow();
      expect(SINGLE_DECK_PARTNERS.id).toBe('single-deck-partners');
    });

    it('prevents nested mutation', () => {
      expect(Object.isFrozen(SINGLE_DECK_CUTTHROAT.dealing.widow)).toBe(true);
      const widow = SINGLE_DECK_CUTTHROAT.dealing.widow as { size: number };
      expect(() => {
        widow.size = 99;
      }).toThrow();
      expect(SINGLE_DECK_CUTTHROAT.dealing.widow.size).toBe(3);
    });
  });
});
