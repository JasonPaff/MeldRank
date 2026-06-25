import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { reduce } from './reduce';
import { createInitialState } from './state';
import { EVENT_KINDS } from './events';

describe('Event union', () => {
  it('enumerates exactly the six documented event kinds', () => {
    expect([...EVENT_KINDS].sort()).toEqual(
      ['bid', 'deal', 'declareTrump', 'pass', 'playCard', 'timeout'].sort(),
    );
    expect(EVENT_KINDS).toHaveLength(6);
  });
});

describe('reduce — purity', () => {
  it('does not mutate its input and returns a distinct value', () => {
    const state = createInitialState(SINGLE_DECK_PARTNERS);
    const snapshot = structuredClone(state);

    const next = reduce(state, { type: 'deal', seed: 42 });

    expect(state).toEqual(snapshot); // input untouched
    expect(next).not.toBe(state); // result is a new value
  });

  it('produces a State that round-trips through JSON unchanged', () => {
    const dealt = reduce(createInitialState(SINGLE_DECK_PARTNERS), { type: 'deal', seed: 42 });
    const roundTripped = JSON.parse(JSON.stringify(dealt)) as unknown;
    expect(roundTripped).toEqual(dealt);
  });
});

describe('reduce — phase guard', () => {
  it('rejects a bid during Dealing, leaving the state unchanged', () => {
    const state = createInitialState(SINGLE_DECK_PARTNERS);
    const next = reduce(state, { type: 'bid', seat: 1, value: 250 });
    expect(next).toBe(state);
  });

  it('rejects not-yet-driven later-phase events (declareTrump, playCard)', () => {
    const dealt = reduce(createInitialState(SINGLE_DECK_PARTNERS), { type: 'deal', seed: 1 });
    expect(reduce(dealt, { type: 'declareTrump', seat: 1, trump: 'spades' })).toBe(dealt);
    expect(
      reduce(dealt, { type: 'playCard', seat: 1, card: { rank: 'A', suit: 'spades', copyIndex: 0 } }),
    ).toBe(dealt);
  });
});

describe('reduce — deal drives Dealing → Auction', () => {
  it('populates hands and widow, opens the auction left of the dealer, and advances the phase', () => {
    const dealt = reduce(createInitialState(SINGLE_DECK_PARTNERS), { type: 'deal', seed: 7 });

    expect(dealt.public.phase).toBe('Auction');
    expect(dealt.private.hands).toHaveLength(4);
    expect(dealt.private.hands.every((hand) => hand.cards.length === 12)).toBe(true);
    expect(dealt.private.widow).toHaveLength(0);
    expect(dealt.public.seatToAct).toBe(1);
    expect(dealt.public.auction?.toAct).toBe(1);
  });
});

describe('reduce — auction timeout is a pass', () => {
  it('passes the seat to act and advances the turn on a timeout', () => {
    const dealt = reduce(createInitialState(SINGLE_DECK_PARTNERS), { type: 'deal', seed: 7 });
    expect(dealt.public.seatToAct).toBe(1);

    const afterTimeout = reduce(dealt, { type: 'timeout', seat: 1 });

    expect(afterTimeout.public.auction?.live[1]).toBe(false);
    expect(afterTimeout.public.seatToAct).toBe(2);
  });
});
