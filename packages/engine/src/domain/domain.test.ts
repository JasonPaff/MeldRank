import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT } from '@meldrank/shared';
import { makeCard, cardsValueEqual, cardsIdentical, cardValueKey, cardIdentityKey } from './card';
import { buildDeck, buildDeckForVariant, deckSpecFromVariant } from './deck';
import { deriveSeats } from './seat';
import {
  makeHand,
  makeBid,
  makeContract,
  makeMeld,
  makeTrick,
  makeHandScoreLine,
  createScorePad,
  appendHand,
} from './entities';

describe('Card', () => {
  it('treats the two copies of a card as value-equal but distinct in identity', () => {
    const a = makeCard('9', 'diamonds', 0);
    const b = makeCard('9', 'diamonds', 1);
    expect(cardsValueEqual(a, b)).toBe(true);
    expect(cardsIdentical(a, b)).toBe(false);
    expect(cardValueKey(a)).toBe(cardValueKey(b));
    expect(cardIdentityKey(a)).not.toBe(cardIdentityKey(b));
  });

  it('distinguishes different ranks/suits by value', () => {
    expect(cardsValueEqual(makeCard('A', 'spades', 0), makeCard('A', 'hearts', 0))).toBe(false);
    expect(cardsValueEqual(makeCard('A', 'spades', 0), makeCard('K', 'spades', 0))).toBe(false);
  });
});

describe('Deck', () => {
  it('builds the 48-card single deck: two copies of six ranks in four suits', () => {
    const deck = buildDeckForVariant(SINGLE_DECK_PARTNERS);
    expect(deck).toHaveLength(48);

    const valueCounts = new Map<string, number>();
    for (const card of deck) {
      valueCounts.set(cardValueKey(card), (valueCounts.get(cardValueKey(card)) ?? 0) + 1);
    }
    expect(valueCounts.size).toBe(24);
    for (const count of valueCounts.values()) {
      expect(count).toBe(2);
    }
  });

  it('is deterministic: two builds from the same spec are identical in order', () => {
    const spec = deckSpecFromVariant(SINGLE_DECK_PARTNERS);
    expect(buildDeck(spec)).toEqual(buildDeck(spec));
  });
});

describe('Seat derivation', () => {
  it('derives 4 seats in two opposite partnerships for Partners', () => {
    const seats = deriveSeats(SINGLE_DECK_PARTNERS);
    expect(seats).toHaveLength(4);
    expect(seats.map((s) => s.teamId)).toEqual([0, 1, 0, 1]);
  });

  it('derives 3 teamless seats for Cutthroat', () => {
    const seats = deriveSeats(SINGLE_DECK_CUTTHROAT);
    expect(seats).toHaveLength(3);
    expect(seats.every((s) => s.teamId === null)).toBe(true);
  });
});

describe('Entity constructors round-trip their fields', () => {
  it('Hand', () => {
    const cards = [makeCard('A', 'spades', 0)];
    expect(makeHand(2, cards)).toEqual({ seatIndex: 2, cards });
  });

  it('Bid', () => {
    expect(makeBid(1, 260)).toEqual({ seatIndex: 1, value: 260 });
  });

  it('Contract captures bidder, value, and trump', () => {
    const contract = makeContract(0, 300, 'hearts');
    expect(contract).toEqual({ seatIndex: 0, value: 300, trump: 'hearts' });
  });

  it('Meld records its type, cards, value, and class', () => {
    const cards = [makeCard('Q', 'spades', 0), makeCard('J', 'diamonds', 0)];
    expect(makeMeld('pinochle', cards, 4, 'B')).toEqual({
      type: 'pinochle',
      cards,
      value: 4,
      class: 'B',
    });
  });

  it('Trick defaults to empty/unresolved and round-trips supplied fields', () => {
    expect(makeTrick()).toEqual({ ledSuit: null, plays: [], winnerSeatIndex: null });
    const plays = [{ seatIndex: 0, card: makeCard('A', 'clubs', 0) }];
    expect(makeTrick('clubs', plays, 0)).toEqual({ ledSuit: 'clubs', plays, winnerSeatIndex: 0 });
  });
});

describe('ScorePad', () => {
  it('starts empty and accumulates per-side totals across hands', () => {
    let pad = createScorePad();
    expect(pad).toEqual({ hands: [], cumulative: {} });

    pad = appendHand(pad, [makeHandScoreLine(0, 40, 25), makeHandScoreLine(1, 20, 10)]);
    pad = appendHand(pad, [makeHandScoreLine(0, 10, 30), makeHandScoreLine(1, 50, 15)]);

    expect(pad.hands).toHaveLength(2);
    expect(pad.cumulative).toEqual({ 0: 40 + 25 + 10 + 30, 1: 20 + 10 + 50 + 15 });
  });

  it('does not mutate the input pad', () => {
    const empty = createScorePad();
    appendHand(empty, [makeHandScoreLine(0, 10, 10)]);
    expect(empty).toEqual({ hands: [], cumulative: {} });
  });

  it('computes a hand score line total from meld + counters', () => {
    expect(makeHandScoreLine(0, 40, 25).total).toBe(65);
  });
});
