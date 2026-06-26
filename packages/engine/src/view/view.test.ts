import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import {
  LegalPlayValidator,
  buryableCards,
  createInitialState,
  reduce,
  viewFor,
  type Event,
  type FilteredView,
  type LifecyclePhase,
  type State,
} from '../index';

/**
 * Tests for the per-seat filtered-view projection (`seat-view-projector`). The
 * projection is the engine's hidden-information boundary, so these suites prove —
 * at runtime across every lifecycle phase and at compile time via the type — that
 * no other seat's hand, no unrevealed widow, and no foreign buried pile can leave
 * `viewFor`.
 */

/** The exact, allow-listed key set of a `FilteredView` (design Risks — key allow-list). */
const VIEW_KEYS = ['handSizes', 'own', 'public', 'viewer'] as const;
/** The exact, allow-listed key set of an `OwnRegion`. */
const OWN_KEYS = ['buried', 'hand'] as const;

/** The forced bury at a resting `Bury`: bury the first `bury.size` eligible cards. */
function buryEvent(state: State): Event {
  const bidder = state.public.seatToAct!;
  const hand = state.private.hands[bidder]!;
  const trump = state.public.trump!;
  const bidderMelds = state.public.melds.find((m) => m.seatIndex === bidder)?.melds ?? [];
  const eligible = buryableCards(hand, bidderMelds, trump, state.variant.dealing.bury.restrictions);
  const size = state.variant.dealing.bury.size;
  const cards = eligible.slice(0, size).map((c) => ({ rank: c.rank, suit: c.suit, copyIndex: c.copyIndex }));
  return { type: 'bury', seat: bidder, cards };
}

/** Play the seat-to-act's first legal card during `TrickPlay`. */
function firstLegalPlay(state: State): Event {
  const seat = state.public.seatToAct!;
  const hand = state.private.hands[seat]!;
  const legal = LegalPlayValidator(hand, state.public.currentTrick, state.public.trump!, state.variant.trick);
  const card = legal[0]!;
  return { type: 'playCard', seat, card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex } };
}

/** Advance one step under a deterministic, always-legal policy for any phase. */
function step(state: State, nextSeed: () => number): State {
  switch (state.public.phase) {
    case 'Dealing':
    case 'HandScoring':
      return reduce(state, { type: 'deal', seed: nextSeed() });
    case 'Auction': {
      const seat = state.public.seatToAct!;
      return state.public.auction!.highBid === null
        ? reduce(state, { type: 'bid', seat, value: state.variant.bidding.minimumBid })
        : reduce(state, { type: 'pass', seat });
    }
    case 'DeclareTrump':
      return reduce(state, { type: 'declareTrump', seat: state.public.contract!.seatIndex, trump: state.variant.deck.suits[0]! });
    case 'Bury':
      return reduce(state, buryEvent(state));
    case 'TrickPlay':
      return reduce(state, firstLegalPlay(state));
    default:
      throw new Error(`unexpected phase ${state.public.phase}`);
  }
}

/**
 * Drive a full Cutthroat match to `MatchComplete`, recording the first state seen
 * resting at each phase. `WidowReveal` and `Melding` are deterministic
 * pass-through transitions (never rest), so they are synthesized below.
 */
function captureCutthroatPhaseStates(): Map<LifecyclePhase, State> {
  const snapshots = new Map<LifecyclePhase, State>();
  let seed = 1;
  let state = createInitialState(SINGLE_DECK_CUTTHROAT, 0);
  const record = (s: State): void => {
    if (!snapshots.has(s.public.phase)) snapshots.set(s.public.phase, s);
  };
  record(state);
  let guard = 0;
  while (state.public.phase !== 'MatchComplete') {
    if (guard++ > 50_000) throw new Error('match did not terminate');
    state = step(state, () => seed++);
    record(state);
  }
  return snapshots;
}

/** Drive a Partners hand (no widow, no bury) to its resting `TrickPlay`. */
function partnersTrickPlayState(): State {
  let seed = 1;
  let state = createInitialState(SINGLE_DECK_PARTNERS, 0);
  let guard = 0;
  while (state.public.phase !== 'TrickPlay') {
    if (guard++ > 5_000) throw new Error('Partners hand did not reach TrickPlay');
    state = step(state, () => seed++);
  }
  return state;
}

const cutthroatPhases = captureCutthroatPhaseStates();

/**
 * Every phase in the task's coverage list. `WidowReveal`/`Melding` are synthesized
 * from a populated resting state by overriding only the phase marker — the
 * projection never branches on `phase`, so the key-set invariant must hold for any
 * marker value.
 */
function stateForPhase(phase: LifecyclePhase): State {
  const captured = cutthroatPhases.get(phase);
  if (captured) return captured;
  const base = cutthroatPhases.get('Bury') ?? cutthroatPhases.get('Auction')!;
  return { ...base, public: { ...base.public, phase } };
}

const COVERED_PHASES: readonly LifecyclePhase[] = [
  'Dealing',
  'Auction',
  'WidowReveal',
  'DeclareTrump',
  'Bury',
  'Melding',
  'TrickPlay',
  'HandScoring',
  'MatchComplete',
];

/** Assert a view's shape matches the hidden-info allow-list. */
function assertViewShape(view: FilteredView): void {
  expect(Object.keys(view).sort()).toEqual([...VIEW_KEYS]);
  const ownKeys = view.own === null ? [] : Object.keys(view.own).sort();
  const expectedOwnKeys = view.own === null ? [] : [...OWN_KEYS];
  expect(ownKeys).toEqual(expectedOwnKeys);
}

describe('viewFor — per-seat derivation (3.1)', () => {
  const state = cutthroatPhases.get('TrickPlay')!;

  it('derives each seat its own hand and the verbatim public state', () => {
    for (let seat = 0; seat < state.private.hands.length; seat++) {
      const view = viewFor(state, seat);
      expect(view.viewer).toBe(seat);
      expect(view.own!.hand).toEqual(state.private.hands[seat]!.cards);
      expect(view.public).toEqual(state.public);
    }
  });

  it('is deterministic — two calls are deeply equal', () => {
    expect(viewFor(state, 1)).toEqual(viewFor(state, 1));
    expect(viewFor(state, null)).toEqual(viewFor(state, null));
  });

  it('does not mutate the input State', () => {
    const before = structuredClone(state);
    viewFor(state, 0);
    viewFor(state, null);
    expect(state).toEqual(before);
  });
});

describe('viewFor — hidden-info exclusion across every lifecycle phase (3.2)', () => {
  it('covers every phase in the lifecycle list', () => {
    // Guards against a phase being silently dropped from coverage.
    for (const phase of COVERED_PHASES) {
      expect(stateForPhase(phase).public.phase).toBe(phase);
    }
  });

  for (const phase of COVERED_PHASES) {
    it(`exposes only the allow-listed keys in ${phase}`, () => {
      const state = stateForPhase(phase);
      // Spectator view is always derivable.
      assertViewShape(viewFor(state, null));
      // Seated views for every dealt seat (none before the deal, in Dealing).
      for (let seat = 0; seat < state.private.hands.length; seat++) {
        const view = viewFor(state, seat);
        assertViewShape(view);
        // No serialized form carries a `private`/`hands`/`widow` field either.
        const keys = Object.keys(view);
        expect(keys).not.toContain('private');
        expect(keys).not.toContain('hands');
        expect(keys).not.toContain('widow');
      }
    });
  }
});

describe('viewFor — hidden-info exclusion at compile time (3.3)', () => {
  it('cannot read another seat hand or the unrevealed widow from a FilteredView', () => {
    const view = viewFor(cutthroatPhases.get('TrickPlay')!, 0);
    // @ts-expect-error — a FilteredView has no per-seat `hands` array.
    void view.hands;
    // @ts-expect-error — a FilteredView has no `private` region.
    void view.private;
    // @ts-expect-error — the unrevealed widow has no field on a FilteredView.
    void view.widow;
    // @ts-expect-error — the own region exposes the viewer's own hand, not other seats'.
    void view.own?.hands;
    expect(view.own).not.toBeNull();
  });
});

describe('viewFor — bidder buried pile (V1, 3.4)', () => {
  // Post-bury Cutthroat state: the bidder's buried pile is populated.
  const state = cutthroatPhases.get('TrickPlay')!;
  const bidder = state.public.contract!.seatIndex;

  it('populated the buried pile for the test fixture', () => {
    expect(state.private.buried.length).toBeGreaterThan(0);
  });

  it("includes the bidder's own buried pile in the bidder's view", () => {
    const view = viewFor(state, bidder);
    expect(view.own!.buried).toEqual(state.private.buried);
  });

  it('exposes no buried contents to any non-bidder', () => {
    for (let seat = 0; seat < state.private.hands.length; seat++) {
      if (seat === bidder) continue;
      expect(viewFor(state, seat).own!.buried).toEqual([]);
    }
  });

  it('leaves the own buried pile empty on the non-bury (Partners) path', () => {
    const partners = partnersTrickPlayState();
    expect(partners.private.buried).toEqual([]);
    for (let seat = 0; seat < partners.private.hands.length; seat++) {
      expect(viewFor(partners, seat).own!.buried).toEqual([]);
    }
  });
});

describe('viewFor — opponent hand sizes as counts (V2, 3.5)', () => {
  const state = cutthroatPhases.get('TrickPlay')!;
  const expectedSizes = state.private.hands.map((hand) => hand.cards.length);

  it('reports each dealt seat its live card count for a seated view', () => {
    const view = viewFor(state, 0);
    expect(view.handSizes).toEqual(expectedSizes);
  });

  it('reports the same counts for a spectator view', () => {
    expect(viewFor(state, null).handSizes).toEqual(expectedSizes);
  });

  it('conveys only numbers — no rank, suit, or card identity', () => {
    for (const size of viewFor(state, null).handSizes) {
      expect(typeof size).toBe('number');
    }
  });
});

describe('viewFor — spectator view (V3, 3.6)', () => {
  it('exposes public state and counts but no own region', () => {
    const state = cutthroatPhases.get('TrickPlay')!;
    const view = viewFor(state, null);
    expect(view.viewer).toBeNull();
    expect(view.public).toEqual(state.public);
    expect(view.handSizes).toEqual(state.private.hands.map((h) => h.cards.length));
    expect(view.own).toBeNull();
  });

  it('carries no own hand or buried pile in any phase', () => {
    for (const phase of COVERED_PHASES) {
      const view = viewFor(stateForPhase(phase), null);
      expect(view.own).toBeNull();
      expect(Object.keys(view)).not.toContain('private');
    }
  });
});

describe('viewFor — invalid seat index (D6, 3.7)', () => {
  const state = cutthroatPhases.get('TrickPlay')!;
  const seatCount = state.private.hands.length;

  it('throws for a seat index beyond the dealt seats', () => {
    expect(() => viewFor(state, seatCount)).toThrow();
    expect(() => viewFor(state, 99)).toThrow();
  });

  it('throws for a negative or non-integer seat index', () => {
    expect(() => viewFor(state, -1)).toThrow();
    expect(() => viewFor(state, 1.5)).toThrow();
  });

  it('throws for any seat before the deal (no dealt seats yet)', () => {
    const dealing = createInitialState(SINGLE_DECK_CUTTHROAT, 0);
    expect(() => viewFor(dealing, 0)).toThrow();
    // The spectator path is the only legitimate "no own hand" case.
    expect(() => viewFor(dealing, null)).not.toThrow();
  });
});
