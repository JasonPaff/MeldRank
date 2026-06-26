import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type Rank, type Suit } from '@meldrank/shared';
import { reduce } from './reduce';
import { createInitialState, type SeatMeld, type State } from './state';
import { makeCard, type Card } from '../domain/card';
import { makeHand, makeTrick } from '../domain/entities';
import { LegalPlayValidator, trickStrength } from '../play';
import type { Event } from './events';

/**
 * The match loop in `reduce` (design D5/D6). At a resting `HandScoring`, the
 * hands-made-as-bidder counter is updated and `MatchScorer` decides match-end: the
 * match either rests for another `deal` (dealer rotated, per-hand state reset,
 * score pad + match scope preserved) or advances to a terminal `MatchComplete`
 * carrying the `MatchResult`. A full Single-Deck Partners match folds over `reduce`
 * from an event log and replays deterministically.
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

function play(seat: number, c: Card): Event {
  return { type: 'playCard', seat, card: { rank: c.rank, suit: c.suit, copyIndex: c.copyIndex } };
}

const seatMeld = (seatIndex: number, total: number): SeatMeld => ({ seatIndex, melds: [], total });

/** Build a state resting at `TrickPlay`, seeded as `reduce` seeds it on entry. */
function trickPlayState(
  hands: readonly (readonly Card[])[],
  trump: Suit,
  leader: number,
  melds: readonly SeatMeld[],
  contractValue: number,
): State {
  const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
  const handObjs = hands.map((cards, seatIndex) => makeHand(seatIndex, cards));
  return {
    ...base,
    public: {
      ...base.public,
      phase: 'TrickPlay',
      trump,
      contract: { seatIndex: leader, value: contractValue },
      seatToAct: leader,
      currentTrick: makeTrick(),
      captured: handObjs.map((hand) => ({
        seatIndex: hand.seatIndex,
        counters: 0,
        tricksTaken: 0,
      })),
      melds,
    },
    private: { ...base.private, hands: handObjs },
  };
}

function foldPlays(state: State, plays: readonly Event[]): State {
  return plays.reduce((s, event) => reduce(s, event), state);
}

// Two-trick hands where each side takes one trick (the HandScoring fixture). Trump
// hearts, seat 0 leads. Side 0 takes trick 1; side 1 trumps trick 2.
const SPLIT_HANDS = [
  [card('A', 'spades'), card('9', 'clubs')],
  [card('K', 'spades'), card('A', 'hearts')],
  [card('Q', 'spades'), card('9', 'spades')],
  [card('J', 'spades'), card('10', 'clubs')],
] as const;

const SPLIT_PLAYS: Event[] = [
  play(0, card('A', 'spades')),
  play(1, card('K', 'spades')),
  play(2, card('Q', 'spades')),
  play(3, card('J', 'spades')),
  play(0, card('9', 'clubs')),
  play(1, card('A', 'hearts')),
  play(2, card('9', 'spades')),
  play(3, card('10', 'clubs')),
];

describe('match loop — hands made as bidder', () => {
  it('increments the bidding side on a made hand', () => {
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const scored = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    expect(scored.public.handResult!.made).toBe(true);
    expect(scored.public.handsMadeAsBidder).toEqual({ 0: 1 });
  });

  it('leaves the counter unchanged on a set hand', () => {
    // Bidding side 0 falls short (meld 100 + counters 20 = 120 < 250) → set.
    const melds = [seatMeld(0, 100), seatMeld(1, 40)];
    const scored = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    expect(scored.public.handResult!.made).toBe(false);
    expect(scored.public.handsMadeAsBidder).toEqual({});
  });
});

describe('match loop — deal starts the next hand from a resting HandScoring', () => {
  it('rotates the dealer, preserves match scope, resets per-hand fields, lands at Auction', () => {
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const scored = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);
    expect(scored.public.phase).toBe('HandScoring');
    expect(scored.public.matchResult).toBeNull(); // 250 < 1500 target

    const next = reduce(scored, { type: 'deal', seed: 99 });

    // Landed at the next hand's auction with the dealer rotated one seat.
    expect(next.public.phase).toBe('Auction');
    expect(next.public.dealerSeat).toBe(1);
    // Match scope carried forward unchanged.
    expect(next.public.scorePad.hands).toHaveLength(1);
    expect(next.public.scorePad.cumulative).toEqual(scored.public.scorePad.cumulative);
    expect(next.public.handsMadeAsBidder).toEqual({ 0: 1 });
    // Per-hand fields reset to their Dealing defaults.
    expect(next.public.handResult).toBeNull();
    expect(next.public.melds).toEqual([]);
    expect(next.public.completedTricks).toEqual([]);
    expect(next.public.trump).toBeNull();
    expect(next.private.hands.length).toBeGreaterThan(0); // fresh hands dealt
  });

  it('rejects a non-deal event at the resting HandScoring', () => {
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const scored = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    expect(reduce(scored, play(0, card('A', 'spades')))).toBe(scored);
  });
});

describe('match loop — MatchComplete is terminal', () => {
  it('rejects every event unchanged', () => {
    const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
    const complete: State = {
      ...base,
      public: {
        ...base.public,
        phase: 'MatchComplete',
        matchResult: {
          complete: true,
          ratingBasis: 'team-win-loss',
          standings: [
            { side: 0, cumulative: 1550, handsMadeAsBidder: 3, placement: 1, outcome: 'win' },
            { side: 1, cumulative: 1200, handsMadeAsBidder: 2, placement: 2, outcome: 'loss' },
          ],
        },
      },
    };

    expect(reduce(complete, { type: 'deal', seed: 1 })).toBe(complete);
    expect(reduce(complete, { type: 'bid', seat: 0, value: 250 })).toBe(complete);
    expect(reduce(complete, play(0, card('A', 'spades')))).toBe(complete);
    expect(reduce(complete, { type: 'timeout', seat: 0 })).toBe(complete);
  });
});

/** The seats partnered with the contract winner (the bidding side's seats). */
function biddingSeats(state: State): readonly number[] {
  const teams = state.variant.seating.teams;
  if (teams.mode !== 'partnerships') return [state.public.contract!.seatIndex];
  return teams.partnerships.find((group) => group.includes(state.public.contract!.seatIndex))!;
}

/**
 * Choose a `TrickPlay` card deterministically: the bidding side plays its strongest
 * legal card (to win the trick and capture counters), the defenders play their
 * weakest. A leader sets the led suit, so its strength is taken against its own
 * suit. This drives the bidding side to make its bid and the match to climb to the
 * target, while staying a pure function of the state for deterministic replay.
 */
function chooseTrickCard(state: State): Card {
  const seat = state.public.seatToAct!;
  const trump = state.public.trump!;
  const trick = state.public.currentTrick;
  const legal = LegalPlayValidator(state.private.hands[seat]!, trick, trump, state.variant.trick);
  const strengthOf = (c: Card): number => trickStrength(c, trump, trick.ledSuit ?? c.suit);
  const byStrengthDesc = [...legal].sort((a, b) => strengthOf(b) - strengthOf(a));
  const wantsToWin = biddingSeats(state).includes(seat);
  return wantsToWin ? byStrengthDesc[0]! : byStrengthDesc[byStrengthDesc.length - 1]!;
}

/**
 * Drive a full Partners match with a deterministic policy: seat 0 always takes the
 * contract at the minimum (it bids when first to act, else it is forced in by the
 * all-pass rule), the contract winner declares the first deck suit as trump, and
 * each trick is played by {@link chooseTrickCard}. Records the event log and returns
 * the terminal state.
 */
function driveMatch(): { log: Event[]; final: State } {
  const log: Event[] = [];
  let state = createInitialState(SINGLE_DECK_PARTNERS, 0);
  let seed = 1;
  const emit = (event: Event): void => {
    log.push(event);
    state = reduce(state, event);
  };

  let guard = 0;
  while (state.public.phase !== 'MatchComplete') {
    if (guard++ > 20_000) throw new Error('match did not terminate');
    switch (state.public.phase) {
      case 'Dealing':
      case 'HandScoring':
        emit({ type: 'deal', seed: seed++ });
        break;
      case 'Auction': {
        const seat = state.public.seatToAct!;
        if (seat === 0 && state.public.auction!.highBid === null) {
          emit({ type: 'bid', seat, value: state.variant.bidding.minimumBid });
        } else {
          emit({ type: 'pass', seat });
        }
        break;
      }
      case 'DeclareTrump':
        emit({
          type: 'declareTrump',
          seat: state.public.contract!.seatIndex,
          trump: state.variant.deck.suits[0]!,
        });
        break;
      case 'TrickPlay':
        emit(play(state.public.seatToAct!, chooseTrickCard(state)));
        break;
      default:
        throw new Error(`unexpected phase ${state.public.phase}`);
    }
  }
  return { log, final: state };
}

describe('match loop — full Partners match integration', () => {
  it('terminates at MatchComplete with a correct, deterministic MatchResult', () => {
    const { log, final } = driveMatch();

    // The match ended at a terminal MatchComplete carrying a result.
    expect(final.public.phase).toBe('MatchComplete');
    const result = final.public.matchResult!;
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
    expect(result.ratingBasis).toBe('team-win-loss');

    // Two partnership sides, one winner at placement 1, the other a loss.
    expect(result.standings).toHaveLength(2);
    expect(result.standings.filter((s) => s.outcome === 'win')).toHaveLength(1);
    expect([...result.standings].map((s) => s.placement).sort()).toEqual([1, 2]);
    // The target was reached by at least one side.
    expect(Math.max(...result.standings.map((s) => s.cumulative))).toBeGreaterThanOrEqual(1500);
    // Standings cumulatives match the running score pad.
    for (const standing of result.standings) {
      expect(standing.cumulative).toBe(final.public.scorePad.cumulative[standing.side]);
    }
    // Multiple hands were played.
    expect(final.public.scorePad.hands.length).toBeGreaterThan(1);

    // Folding the same log from scratch reproduces the terminal state exactly.
    const replay = log.reduce((s, event) => reduce(s, event), createInitialState(SINGLE_DECK_PARTNERS, 0));
    expect(replay).toEqual(final);
  });
});
