import { describe, expect, it } from 'vitest';
import { projectHand, type ProjectHandInput } from './projector';

describe('projectHand', () => {
  it('projects a made Partners hand to one hand row and two ordered line rows', () => {
    const input: ProjectHandInput = {
      handNumber: 1,
      bidderSeat: 0,
      contractValue: 50,
      trump: 'spades',
      made: true,
      lines: [
        { side: 0, meld: 40, counters: 25, total: 65 },
        { side: 1, meld: 20, counters: 10, total: 30 },
      ],
      cumulativeBySide: { 0: 65, 1: 30 },
    };

    const { hand, lines } = projectHand(input);

    expect(hand).toEqual({
      handNumber: 1,
      bidderSeat: 0,
      contractValue: 50,
      trump: 'spades',
      made: true,
    });
    expect(lines).toEqual([
      { side: 0, meld: 40, counters: 25, total: 65, cumulative: 65 },
      { side: 1, meld: 20, counters: 10, total: 30, cumulative: 30 },
    ]);
  });

  it('preserves an as-scored set hand penalty unchanged with made=false', () => {
    // The bidding side's input line already reflects the set-penalty override
    // (meld/counters zeroed, total = -contract.value under `minus-bid-and-meld-lost`).
    const input: ProjectHandInput = {
      handNumber: 3,
      bidderSeat: 1,
      contractValue: 60,
      trump: 'hearts',
      made: false,
      lines: [
        { side: 0, meld: 30, counters: 22, total: 52 },
        { side: 1, meld: 0, counters: 0, total: -60 },
      ],
      cumulativeBySide: { 0: 110, 1: -10 },
    };

    const { hand, lines } = projectHand(input);

    expect(hand.made).toBe(false);
    const biddingLine = lines.find((line) => line.side === 1);
    expect(biddingLine).toEqual({ side: 1, meld: 0, counters: 0, total: -60, cumulative: -10 });
  });

  it('projects a free-for-all hand with four side lines, each joined to its cumulative', () => {
    const input: ProjectHandInput = {
      handNumber: 5,
      bidderSeat: 2,
      contractValue: 40,
      trump: 'clubs',
      made: true,
      lines: [
        { side: 0, meld: 10, counters: 5, total: 15 },
        { side: 1, meld: 12, counters: 8, total: 20 },
        { side: 2, meld: 30, counters: 15, total: 45 },
        { side: 3, meld: 6, counters: 0, total: 6 },
      ],
      cumulativeBySide: { 0: 15, 1: 20, 2: 45, 3: 6 },
    };

    const { lines } = projectHand(input);

    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.side)).toEqual([0, 1, 2, 3]);
    expect(lines.map((line) => line.cumulative)).toEqual([15, 20, 45, 6]);
  });

  it('orders line rows deterministically by side id regardless of input order', () => {
    const input: ProjectHandInput = {
      handNumber: 2,
      bidderSeat: 3,
      contractValue: 50,
      trump: 'diamonds',
      made: true,
      lines: [
        { side: 3, meld: 20, counters: 30, total: 50 },
        { side: 0, meld: 15, counters: 5, total: 20 },
        { side: 2, meld: 18, counters: 2, total: 20 },
        { side: 1, meld: 10, counters: 10, total: 20 },
      ],
      cumulativeBySide: { 0: 20, 1: 20, 2: 20, 3: 50 },
    };

    const { lines } = projectHand(input);

    expect(lines.map((line) => line.side)).toEqual([0, 1, 2, 3]);
  });

  it('does not mutate the input lines array', () => {
    const lines = [
      { side: 1, meld: 5, counters: 5, total: 10 },
      { side: 0, meld: 5, counters: 5, total: 10 },
    ];
    const input: ProjectHandInput = {
      handNumber: 1,
      bidderSeat: 0,
      contractValue: 20,
      trump: 'spades',
      made: false,
      lines,
      cumulativeBySide: { 0: 10, 1: 10 },
    };

    projectHand(input);

    expect(lines.map((line) => line.side)).toEqual([1, 0]);
  });
});
