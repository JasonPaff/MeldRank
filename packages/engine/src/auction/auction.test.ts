import { describe, expect, it } from 'vitest';
import {
  applyBid,
  applyPass,
  openAuction,
  type AuctionParams,
  type AuctionState,
  type AuctionStep,
} from './auction';

/** Single-Deck Partners auction parameters (minimum 250, increment 10, dealer forced). */
const PARTNERS: AuctionParams = {
  minimumBid: 250,
  increment: 10,
  allPassRule: 'dealer-forced-minimum',
};

/** Single-Deck Cutthroat auction parameters (minimum 300, increment 10, redeal). */
const CUTTHROAT: AuctionParams = {
  minimumBid: 300,
  increment: 10,
  allPassRule: 'redeal',
};

type Move = { readonly kind: 'bid'; readonly seat: number; readonly value: number } | { readonly kind: 'pass'; readonly seat: number };

/** Run a sequence of moves from an opening auction, returning the final step. */
function run(
  initial: AuctionState,
  params: AuctionParams,
  dealerSeat: number,
  moves: readonly Move[],
): AuctionStep {
  let step: AuctionStep = { status: 'continue', auction: initial };
  for (const move of moves) {
    if (step.status !== 'continue') {
      throw new Error('auction already resolved');
    }
    step =
      move.kind === 'bid'
        ? applyBid(step.auction, params, move.seat, move.value)
        : applyPass(step.auction, params, dealerSeat, move.seat);
  }
  return step;
}

describe('AuctionManager — turn order', () => {
  it('opens at the seat left of the dealer and proceeds clockwise', () => {
    let auction = openAuction(4, 0);
    expect(auction.toAct).toBe(1);

    const order: number[] = [auction.toAct];
    for (let value = 250; value < 290; value += 10) {
      const step = applyBid(auction, PARTNERS, auction.toAct, value);
      expect(step.status).toBe('continue');
      if (step.status !== 'continue') return;
      auction = step.auction;
      order.push(auction.toAct);
    }
    // Acting seats cycle 1 → 2 → 3 → 0, then wrap back to 1.
    expect(order).toEqual([1, 2, 3, 0, 1]);
  });
});

describe('AuctionManager — bid legality', () => {
  it('accepts a bid at the floor and advances the turn', () => {
    const step = applyBid(openAuction(4, 0), PARTNERS, 1, 250);
    expect(step).toEqual({
      status: 'continue',
      auction: { highBid: { seatIndex: 1, value: 250 }, live: [true, true, true, true], toAct: 2 },
    });
  });

  it('rejects a bid below the floor', () => {
    expect(applyBid(openAuction(4, 0), PARTNERS, 1, 240).status).toBe('rejected');
  });

  it('rejects a bid off the increment grid', () => {
    expect(applyBid(openAuction(4, 0), PARTNERS, 1, 255).status).toBe('rejected');
  });

  it('rejects an out-of-turn bid', () => {
    expect(applyBid(openAuction(4, 0), PARTNERS, 2, 250).status).toBe('rejected');
  });

  it('rejects a bid from a seat that has already passed', () => {
    const afterPass = applyPass(openAuction(4, 0), PARTNERS, 0, 1);
    expect(afterPass.status).toBe('continue');
    if (afterPass.status !== 'continue') return;
    // Seat 1 has passed; even ignoring turn it is no longer live.
    expect(applyBid(afterPass.auction, PARTNERS, 1, 250).status).toBe('rejected');
  });

  it('requires the next bid to clear the prior high bid plus the increment', () => {
    const opened = applyBid(openAuction(4, 0), PARTNERS, 1, 250);
    expect(opened.status).toBe('continue');
    if (opened.status !== 'continue') return;
    expect(applyBid(opened.auction, PARTNERS, 2, 250).status).toBe('rejected'); // not above floor
    expect(applyBid(opened.auction, PARTNERS, 2, 260).status).toBe('continue'); // floor = 260
  });
});

describe('AuctionManager — termination', () => {
  it('concludes with the last live seat at its high bid', () => {
    const step = run(openAuction(4, 0), PARTNERS, 0, [
      { kind: 'bid', seat: 1, value: 250 },
      { kind: 'pass', seat: 2 },
      { kind: 'pass', seat: 3 },
      { kind: 'pass', seat: 0 },
    ]);
    expect(step).toEqual({ status: 'won', bid: { seatIndex: 1, value: 250 } });
  });

  it('forces the dealer in at the minimum when every Partners seat passes', () => {
    const step = run(openAuction(4, 0), PARTNERS, 0, [
      { kind: 'pass', seat: 1 },
      { kind: 'pass', seat: 2 },
      { kind: 'pass', seat: 3 },
    ]);
    expect(step).toEqual({ status: 'won', bid: { seatIndex: 0, value: 250 } });
  });

  it('yields a redeal when every Cutthroat seat passes', () => {
    const step = run(openAuction(3, 0), CUTTHROAT, 0, [
      { kind: 'pass', seat: 1 },
      { kind: 'pass', seat: 2 },
    ]);
    expect(step).toEqual({ status: 'redeal' });
  });
});
