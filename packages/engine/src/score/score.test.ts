import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { makeContract, type Contract } from '../domain/entities';
import type { SeatCapture, SeatMeld } from '../state/state';
import { HandScorer } from './score';

/** A seat's recorded meld with the given summed total (the melds list is irrelevant here). */
const meld = (seatIndex: number, total: number): SeatMeld => ({ seatIndex, melds: [], total });

/** A seat's capture tally. */
const cap = (seatIndex: number, counters: number, tricksTaken: number): SeatCapture => ({
  seatIndex,
  counters,
  tricksTaken,
});

/** A contract on `seatIndex` at `value` (trump is immaterial to scoring). */
const contract = (seatIndex: number, value: number): Contract => makeContract(seatIndex, value, 'hearts');

/** Look up a side's line by side id. */
const lineOf = (result: ReturnType<typeof HandScorer>, side: number): { side: number; meld: number; counters: number; total: number } =>
  result.lines.find((line) => line.side === side)!;

describe('HandScorer — side folding', () => {
  it('folds seats into partnership sides, one line per side, summing meld and counters', () => {
    // Partners: sides [0,2] and [1,3]. Seat melds/counters spread across partners.
    const melds = [meld(0, 60), meld(2, 40), meld(1, 20), meld(3, 0)];
    const captured = [cap(0, 100, 2), cap(2, 50, 1), cap(1, 60, 1), cap(3, 30, 1)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(result.lines).toHaveLength(2);
    // Side 0 = seats 0+2: meld 100, counters 150.
    expect(lineOf(result, 0)).toEqual({ side: 0, meld: 100, counters: 150, total: 250 });
    // Side 1 = seats 1+3: meld 20, counters 90.
    expect(lineOf(result, 1)).toEqual({ side: 1, meld: 20, counters: 90, total: 110 });
    expect(result.side).toBe(0);
  });

  it('keys each seat as its own side in a free-for-all variant', () => {
    // Cutthroat: 3 teamless seats. Bidder seat 1 melds; defenders score 0 (bidder-vs-bid).
    const melds = [meld(1, 80)];
    const captured = [cap(0, 40, 2), cap(1, 200, 3), cap(2, 10, 1)];
    const result = HandScorer(melds, captured, contract(1, 250), 0, SINGLE_DECK_CUTTHROAT);

    expect(result.lines.map((line) => line.side)).toEqual([0, 1, 2]);
    expect(result.side).toBe(1);
  });

  it('credits buried counters to the bidding side only', () => {
    // Free-for-all bidder seat 1, made, with 20 buried counters folded into its line.
    const melds = [meld(1, 80)];
    const captured = [cap(0, 40, 2), cap(1, 200, 3), cap(2, 10, 1)];
    const withBury = HandScorer(melds, captured, contract(1, 250), 20, SINGLE_DECK_CUTTHROAT);
    const withoutBury = HandScorer(melds, captured, contract(1, 250), 0, SINGLE_DECK_CUTTHROAT);

    expect(lineOf(withBury, 1).counters).toBe(lineOf(withoutBury, 1).counters + 20);
    // The other sides are unaffected (defenders score 0 here regardless).
    expect(lineOf(withBury, 0)).toEqual(lineOf(withoutBury, 0));
    expect(lineOf(withBury, 2)).toEqual(lineOf(withoutBury, 2));
  });
});

describe('HandScorer — meld-needs-a-trick gate', () => {
  it('forfeits a trickless side’s meld while scoring its counters', () => {
    // Side 1 (seats 1,3) took no trick: its 40 meld is voided, counters kept.
    const melds = [meld(0, 60), meld(2, 40), meld(1, 40), meld(3, 0)];
    const captured = [cap(0, 150, 6), cap(2, 100, 6), cap(1, 0, 0), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(lineOf(result, 1)).toEqual({ side: 1, meld: 0, counters: 0, total: 0 });
  });

  it('keeps a side’s meld when it took at least one trick', () => {
    const melds = [meld(0, 60), meld(2, 40), meld(1, 40), meld(3, 0)];
    const captured = [cap(0, 150, 6), cap(2, 90, 5), cap(1, 10, 1), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(lineOf(result, 1).meld).toBe(40);
  });

  it('applies the gate before the made/set check (a trickless meld cannot make the bid)', () => {
    // Bidding side 0 would reach 250 on meld 200 + counters 60, but took no trick:
    // the meld is voided first, so 60 < 250 and the contract is set.
    const melds = [meld(0, 200), meld(2, 0), meld(1, 0), meld(3, 0)];
    const captured = [cap(0, 60, 0), cap(2, 0, 0), cap(1, 100, 12), cap(3, 80, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(result.made).toBe(false);
    // minus-bid-and-meld-lost penalty on the set bidding side.
    expect(lineOf(result, 0)).toEqual({ side: 0, meld: 0, counters: 0, total: -250 });
  });
});

describe('HandScorer — made / set and the set penalty', () => {
  it('makes the bid at exactly the bid value', () => {
    const melds = [meld(0, 100), meld(2, 0), meld(1, 20), meld(3, 0)];
    const captured = [cap(0, 150, 6), cap(2, 0, 0), cap(1, 90, 6), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(result.made).toBe(true);
    expect(lineOf(result, 0)).toEqual({ side: 0, meld: 100, counters: 150, total: 250 });
  });

  it('sets the bidding side below the bid and records −bid with meld lost', () => {
    const melds = [meld(0, 100), meld(2, 0), meld(1, 20), meld(3, 0)];
    const captured = [cap(0, 130, 5), cap(2, 0, 0), cap(1, 110, 7), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    // 100 + 130 = 230 < 250 → set.
    expect(result.made).toBe(false);
    expect(lineOf(result, 0)).toEqual({ side: 0, meld: 0, counters: 0, total: -250 });
  });

  it('does not penalize the non-bidding side when the bidding side is set (all-sides-score)', () => {
    const melds = [meld(0, 100), meld(2, 0), meld(1, 20), meld(3, 0)];
    const captured = [cap(0, 130, 5), cap(2, 0, 0), cap(1, 110, 7), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    // The defender side scores what it earned.
    expect(lineOf(result, 1)).toEqual({ side: 1, meld: 20, counters: 110, total: 130 });
  });

  it('records −bid but keeps meld/counters informational under minus-bid', () => {
    const minusBid: VariantDefinition = {
      ...SINGLE_DECK_PARTNERS,
      scoring: { ...SINGLE_DECK_PARTNERS.scoring, setPenalty: 'minus-bid' },
    };
    const melds = [meld(0, 100), meld(2, 0), meld(1, 20), meld(3, 0)];
    const captured = [cap(0, 130, 5), cap(2, 0, 0), cap(1, 110, 7), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, minusBid);

    // meld + counters stay on the line; only the total becomes −bid.
    expect(lineOf(result, 0)).toEqual({ side: 0, meld: 100, counters: 130, total: -250 });
  });
});

describe('HandScorer — scoring mode', () => {
  it('scores every side under all-sides-score', () => {
    const melds = [meld(0, 100), meld(2, 0), meld(1, 20), meld(3, 0)];
    const captured = [cap(0, 150, 6), cap(2, 0, 0), cap(1, 90, 6), cap(3, 0, 0)];
    const result = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(lineOf(result, 1).total).toBe(110);
  });

  it('zeroes every defender side under bidder-vs-bid', () => {
    // Cutthroat bidder seat 1; defenders 0 and 2 score 0 despite capturing counters.
    const melds = [meld(1, 80)];
    const captured = [cap(0, 90, 4), cap(1, 200, 10), cap(2, 60, 1)];
    const result = HandScorer(melds, captured, contract(1, 250), 0, SINGLE_DECK_CUTTHROAT);

    expect(lineOf(result, 0).total).toBe(0);
    expect(lineOf(result, 2).total).toBe(0);
    // Only the bidding side reflects its made/set outcome (80 + 200 ≥ 250 → made).
    expect(result.made).toBe(true);
    expect(lineOf(result, 1).total).toBe(280);
  });
});

describe('HandScorer — purity', () => {
  it('does not mutate its inputs and is deterministic', () => {
    const melds = [meld(0, 100), meld(1, 20)];
    const captured = [cap(0, 150, 6), cap(1, 90, 6), cap(2, 0, 0), cap(3, 0, 0)];
    const meldsSnapshot = JSON.parse(JSON.stringify(melds)) as SeatMeld[];
    const capturedSnapshot = JSON.parse(JSON.stringify(captured)) as SeatCapture[];

    const a = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);
    const b = HandScorer(melds, captured, contract(0, 250), 0, SINGLE_DECK_PARTNERS);

    expect(a).toEqual(b);
    expect(melds).toEqual(meldsSnapshot);
    expect(captured).toEqual(capturedSnapshot);
  });
});
