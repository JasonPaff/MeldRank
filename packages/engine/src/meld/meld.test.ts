import { describe, expect, it } from 'vitest';
import { getMeldTable, type MeldTable } from '@meldrank/shared/meld';
import type { Rank, Suit } from '@meldrank/shared';
import { MeldDetector } from './meld';
import { makeCard, type Card } from '../domain/card';
import { makeHand, type Meld } from '../domain/entities';

/**
 * Exhaustive MeldDetector coverage. The ruleset doc §6 is the oracle: every meld
 * type and value, trump-dependence, cross-class reuse, within-class non-reuse, the
 * run-vs-royal-marriage rule, double-vs-two-singles, and known full-hand totals.
 * "Correctness here *is* the product's integrity" (§5).
 */

const TABLE: MeldTable = getMeldTable('standard-single-deck')!;

/** Build a card (copyIndex defaults to 0). */
function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

/** Run the detector over a loose set of cards against `trump`. */
function detect(cards: readonly Card[], trump: Suit) {
  return MeldDetector(makeHand(0, cards), trump, TABLE);
}

/** The meld types present, for order-insensitive assertions. */
function types(melds: readonly Meld[]): string[] {
  return melds.map((meld) => meld.type).sort();
}

/** The five trump cards forming a run, all copy 0. */
function runCards(suit: Suit, copyIndex = 0): Card[] {
  return (['A', '10', 'K', 'Q', 'J'] as const).map((rank) => card(rank, suit, copyIndex));
}

describe('MeldDetector — purity and the empty hand', () => {
  it('is deterministic and does not mutate its input', () => {
    const hand = makeHand(0, runCards('hearts'));
    const snapshot = structuredClone(hand);

    const first = MeldDetector(hand, 'hearts', TABLE);
    const second = MeldDetector(hand, 'hearts', TABLE);

    expect(first).toEqual(second);
    expect(hand).toEqual(snapshot);
  });

  it('scores a hand with no melds as zero', () => {
    const result = detect([card('A', 'spades'), card('K', 'clubs'), card('J', 'spades'), card('10', 'diamonds')], 'hearts');
    expect(result.melds).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('MeldDetector — Class A', () => {
  it('scores a trump run at 150 with no royal marriage from its own K–Q', () => {
    const result = detect(runCards('hearts'), 'hearts');
    expect(types(result.melds)).toEqual(['run']);
    expect(result.melds[0]?.value).toBe(150);
    expect(result.total).toBe(150);
  });

  it('recognizes a run only against the declared trump', () => {
    const result = detect(runCards('spades'), 'hearts');
    expect(result.melds.some((meld) => meld.type === 'run')).toBe(false);
    // The K♠–Q♠ still pair as a non-trump marriage (20); the five ♠ cards are no run.
    expect(types(result.melds)).toEqual(['marriage']);
    expect(result.total).toBe(20);
  });

  it('scores a Royal Marriage (40) for a trump K–Q with no run', () => {
    const result = detect([card('K', 'hearts'), card('Q', 'hearts')], 'hearts');
    expect(types(result.melds)).toEqual(['royal-marriage']);
    expect(result.total).toBe(40);
  });

  it('scores a non-trump Marriage at 20', () => {
    const result = detect([card('K', 'spades'), card('Q', 'spades')], 'hearts');
    expect(types(result.melds)).toEqual(['marriage']);
    expect(result.total).toBe(20);
  });

  it('scores a Dix (10) only for the 9 of trump', () => {
    expect(detect([card('9', 'hearts')], 'hearts').total).toBe(10);
    expect(detect([card('9', 'spades')], 'hearts').total).toBe(0);
  });
});

describe('MeldDetector — run vs royal marriage', () => {
  it('scores no extra royal marriage for a lone run', () => {
    const result = detect(runCards('hearts'), 'hearts');
    expect(result.melds.some((meld) => meld.type === 'royal-marriage')).toBe(false);
  });

  it('scores the run plus a royal marriage when a second trump K is held', () => {
    const result = detect([...runCards('hearts'), card('K', 'hearts', 1)], 'hearts');
    expect(types(result.melds)).toEqual(['royal-marriage', 'run']);
    expect(result.total).toBe(150 + 40);
  });

  it('scores the run plus a royal marriage when a second trump Q is held', () => {
    const result = detect([...runCards('hearts'), card('Q', 'hearts', 1)], 'hearts');
    expect(types(result.melds)).toEqual(['royal-marriage', 'run']);
    expect(result.total).toBe(150 + 40);
  });
});

describe('MeldDetector — within-class non-reuse', () => {
  it('scores a single trump K–Q as at most one Class A meld', () => {
    const result = detect([card('K', 'hearts'), card('Q', 'hearts')], 'hearts');
    expect(result.melds.filter((meld) => meld.class === 'A')).toHaveLength(1);
    expect(result.total).toBe(40);
  });
});

describe('MeldDetector — Class B pinochle', () => {
  it('scores a Pinochle (Q♠ + J♦) at 40', () => {
    const result = detect([card('Q', 'spades'), card('J', 'diamonds')], 'hearts');
    expect(types(result.melds)).toEqual(['pinochle']);
    expect(result.total).toBe(40);
  });

  it('scores Double Pinochle (300) instead of two singles when both copies are held', () => {
    const result = detect([card('Q', 'spades', 0), card('Q', 'spades', 1), card('J', 'diamonds', 0), card('J', 'diamonds', 1)], 'hearts');
    expect(types(result.melds)).toEqual(['double-pinochle']);
    expect(result.total).toBe(300);
  });
});

describe('MeldDetector — Class C arounds', () => {
  const aroundCards = (rank: Rank, copyIndex = 0): Card[] =>
    (['spades', 'hearts', 'clubs', 'diamonds'] as const).map((suit) => card(rank, suit, copyIndex));

  it('scores each single around at its value', () => {
    expect(detect(aroundCards('A'), 'hearts').total).toBe(100);
    expect(detect(aroundCards('K'), 'hearts').total).toBe(80);
    // Queens around (60) plus the trump K♥/Q♥... none here, so just 60.
    expect(detect(aroundCards('Q'), 'spades').total).toBe(60);
    expect(detect(aroundCards('J'), 'hearts').total).toBe(40);
  });

  it('scores a double around (all eight) instead of two singles', () => {
    const result = detect([...aroundCards('A', 0), ...aroundCards('A', 1)], 'hearts');
    expect(types(result.melds)).toEqual(['double-aces-around']);
    expect(result.total).toBe(1000);
  });
});

describe('MeldDetector — double run', () => {
  it('scores Double Run (1500) instead of two single runs', () => {
    const result = detect([...runCards('hearts', 0), ...runCards('hearts', 1)], 'hearts');
    expect(types(result.melds)).toEqual(['double-run']);
    expect(result.total).toBe(1500);
  });
});

describe('MeldDetector — cross-class reuse', () => {
  it('lets one Q♠ serve a Marriage, a Pinochle, and Queens around at once', () => {
    const queenSpades = card('Q', 'spades');
    const cards = [
      card('K', 'spades'), // Marriage with Q♠ (Class A, spades non-trump)
      queenSpades,
      card('J', 'diamonds'), // Pinochle with Q♠ (Class B)
      card('Q', 'hearts'),
      card('Q', 'clubs'),
      card('Q', 'diamonds'), // Queens around with Q♠ (Class C)
    ];
    const result = detect(cards, 'hearts');

    expect(types(result.melds)).toEqual(['marriage', 'pinochle', 'queens-around']);
    expect(result.total).toBe(20 + 40 + 60);

    const contains = (meld: Meld | undefined): boolean => meld?.cards.some((c) => c.rank === 'Q' && c.suit === 'spades') ?? false;
    expect(contains(result.melds.find((meld) => meld.type === 'marriage'))).toBe(true);
    expect(contains(result.melds.find((meld) => meld.type === 'pinochle'))).toBe(true);
    expect(contains(result.melds.find((meld) => meld.type === 'queens-around'))).toBe(true);
  });

  it('scores the spec full-meld hand (run + pinochle + queens around) at 250', () => {
    const cards = [
      ...runCards('hearts'), // run 150 (includes Q♥ for queens around)
      card('Q', 'spades'),
      card('J', 'diamonds'), // pinochle 40
      card('Q', 'clubs'),
      card('Q', 'diamonds'), // with Q♥, Q♠ → queens around 60
    ];
    const result = detect(cards, 'hearts');
    expect(types(result.melds)).toEqual(['pinochle', 'queens-around', 'run']);
    expect(result.total).toBe(250);
  });
});

describe('MeldDetector — known full-hand total', () => {
  it('totals a 12-card Partners hand by hand', () => {
    // trump ♠. Run ♠ (150) + non-trump marriage ♥ (20) + Dix 9♠ (10) +
    // Pinochle Q♠/J♦ (40, reusing the run's Q♠ across classes) = 220.
    const cards = [
      ...runCards('spades'),
      card('J', 'diamonds'),
      card('K', 'hearts'),
      card('Q', 'hearts'),
      card('9', 'spades'),
      card('9', 'hearts'),
      card('9', 'clubs'),
      card('9', 'diamonds'),
    ];
    const result = detect(cards, 'spades');
    expect(types(result.melds)).toEqual(['dix', 'marriage', 'pinochle', 'run']);
    expect(result.total).toBe(220);
  });
});
