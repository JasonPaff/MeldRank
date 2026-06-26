import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT, type VariantDefinition } from '@meldrank/shared';
import { reduce, createInitialState, LegalPlayValidator, buryableCards, trickStrength, type Event, type State } from './index';

/** Fold an ordered event log over `reduce` from a fresh initial state. */
function fold(variant: VariantDefinition, dealerSeat: number, log: readonly Event[]) {
  return log.reduce((state, event) => reduce(state, event), createInitialState(variant, dealerSeat));
}

describe('Dealing → Auction integration', () => {
  it('deals into the Auction phase with populated hands and widow', () => {
    const dealt = fold(SINGLE_DECK_CUTTHROAT, 0, [{ type: 'deal', seed: 555 }]);

    expect(dealt.public.phase).toBe('Auction');
    expect(dealt.private.hands.map((hand) => hand.cards.length)).toEqual([15, 15, 15]);
    expect(dealt.private.widow).toHaveLength(3);
    expect(dealt.public.seatToAct).toBe(1);
  });

  it('folds a full Partners auction into a recorded winning bid at DeclareTrump', () => {
    const log: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
    ];
    const final = fold(SINGLE_DECK_PARTNERS, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 2, value: 260 });
    // Partners skips WidowReveal, so the auction advances straight to DeclareTrump.
    expect(final.public.phase).toBe('DeclareTrump');
    expect(final.public.outcome).toBeNull();
  });

  it('folds a Partners hand through Melding to recorded melds at every seat, resting at TrickPlay', () => {
    const log: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
      { type: 'declareTrump', seat: 2, trump: 'hearts' },
    ];
    const final = fold(SINGLE_DECK_PARTNERS, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 2, value: 260 });
    expect(final.public.trump).toBe('hearts');
    // Partners skips Bury, so Melding passes through to TrickPlay.
    expect(final.public.phase).toBe('TrickPlay');
    // All four seats meld; each entry carries a seat, its melds, and a numeric total.
    expect(final.public.melds.map((seatMeld) => seatMeld.seatIndex)).toEqual([0, 1, 2, 3]);
    for (const seatMeld of final.public.melds) {
      expect(typeof seatMeld.total).toBe('number');
      expect(seatMeld.total).toBe(seatMeld.melds.reduce((sum, meld) => sum + meld.value, 0));
    }
  });

  it('folds a Cutthroat hand through the widow reveal and Melding to a bidder-only meld at Bury', () => {
    const dealt = fold(SINGLE_DECK_CUTTHROAT, 0, [{ type: 'deal', seed: 99 }]);
    const log: Event[] = [
      { type: 'deal', seed: 99 },
      { type: 'bid', seat: 1, value: 300 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 0 },
      { type: 'declareTrump', seat: 1, trump: 'clubs' },
    ];
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 1, value: 300 });
    // The widow was revealed into the bidder's hand on the way to DeclareTrump.
    expect(final.public.revealedWidow).toEqual(dealt.private.widow);
    expect(final.private.hands[1]!.cards).toHaveLength(18);
    expect(final.private.widow).toEqual([]);
    expect(final.public.trump).toBe('clubs');
    // Cutthroat has a Bury, so Melding rests at Bury (not TrickPlay).
    expect(final.public.phase).toBe('Bury');
    // Only the bidder melds (whoMelds: bidder-only).
    expect(final.public.melds.map((seatMeld) => seatMeld.seatIndex)).toEqual([1]);
  });

  it('surfaces a redeal outcome on a Cutthroat all-pass without advancing the phase', () => {
    const log: Event[] = [
      { type: 'deal', seed: 1 },
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
    ];
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, log);

    expect(final.public.outcome).toBe('redeal');
    expect(final.public.contract).toBeNull();
    expect(final.public.phase).toBe('Auction');
  });

  it('folds a full Partners hand through TrickPlay to HandScoring with a complete capture tally', () => {
    // Drive the auction + declaration to the resting TrickPlay phase.
    const setup: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
      { type: 'declareTrump', seat: 2, trump: 'hearts' },
    ];
    const postMelding = fold(SINGLE_DECK_PARTNERS, 0, setup);
    expect(postMelding.public.phase).toBe('TrickPlay');

    // Generate a legal play log: at each turn, the seat-to-act plays its first
    // legal card. This folds the whole hand to all-hands-empty.
    const playLog: Event[] = [];
    let state: State = postMelding;
    while (state.public.phase === 'TrickPlay') {
      const seat = state.public.seatToAct!;
      const hand = state.private.hands[seat]!;
      const legal = LegalPlayValidator(hand, state.public.currentTrick, state.public.trump!, SINGLE_DECK_PARTNERS.trick);
      const card = legal[0]!;
      const event: Event = {
        type: 'playCard',
        seat,
        card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex },
      };
      playLog.push(event);
      state = reduce(state, event);
    }

    // 4 seats × 12 cards = 48 plays over 12 tricks, then the phase advances.
    expect(playLog).toHaveLength(48);
    expect(state.public.phase).toBe('HandScoring');
    expect(state.public.seatToAct).toBeNull();
    expect(state.public.completedTricks).toHaveLength(12);
    expect(state.public.completedTricks.every((t) => t.winnerSeatIndex !== null)).toBe(true);
    expect(state.private.hands.every((h) => h.cards.length === 0)).toBe(true);
    // Every counter point (240) plus the last-trick bonus (10) is captured.
    const totalCounters = state.public.captured.reduce((sum, c) => sum + c.counters, 0);
    expect(totalCounters).toBe(250);
    const totalTricks = state.public.captured.reduce((sum, c) => sum + c.tricksTaken, 0);
    expect(totalTricks).toBe(12);

    // HandScoring computed the per-side result and appended it to the score pad.
    const result = state.public.handResult!;
    expect(result).not.toBeNull();
    // Partners folds the four seats into the two partnership sides.
    expect(result.lines.map((line) => line.side)).toEqual([0, 1]);
    // The bidding side is the contract seat's side (seat 2 → partnership [0, 2] = side 0).
    expect(result.side).toBe(0);
    expect(typeof result.made).toBe('boolean');
    // Each line's total is consistent: meld + counters, or the set penalty (−bid).
    for (const line of result.lines) {
      const expected = line.side === result.side && !result.made ? -260 : line.meld + line.counters;
      expect(line.total).toBe(expected);
    }
    // The pad carries exactly this hand's lines and its cumulative-by-side totals.
    expect(state.public.scorePad.hands).toHaveLength(1);
    expect(state.public.scorePad.hands[0]).toEqual(result.lines);
    for (const line of result.lines) {
      expect(state.public.scorePad.cumulative[line.side]).toBe(line.total);
    }

    // Folding the same play log twice from the same post-melding state is
    // deep-equal (replay determinism).
    const replayA = playLog.reduce((s, e) => reduce(s, e), postMelding);
    const replayB = playLog.reduce((s, e) => reduce(s, e), postMelding);
    expect(replayA).toEqual(replayB);
    expect(replayA).toEqual(state);
  });

  it('folds the same event log twice to deep-equal state (replay determinism)', () => {
    const partners: Event[] = [
      { type: 'deal', seed: 31415 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'declareTrump', seat: 1, trump: 'spades' },
    ];
    expect(fold(SINGLE_DECK_PARTNERS, 0, partners)).toEqual(fold(SINGLE_DECK_PARTNERS, 0, partners));

    // The Cutthroat fold runs through the deterministic widow reveal too.
    const cutthroat: Event[] = [
      { type: 'deal', seed: 27182 },
      { type: 'bid', seat: 1, value: 300 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 0 },
      { type: 'declareTrump', seat: 1, trump: 'diamonds' },
    ];
    expect(fold(SINGLE_DECK_CUTTHROAT, 0, cutthroat)).toEqual(fold(SINGLE_DECK_CUTTHROAT, 0, cutthroat));
  });
});

/**
 * The forced bury at a resting `Bury`: the bidder buries the first
 * `dealing.bury.size` eligible cards (per the bury-validator). A deterministic,
 * always-legal policy for the integration drivers below.
 */
function buryEvent(state: State): Event {
  const bidder = state.public.seatToAct!;
  const hand = state.private.hands[bidder]!;
  const trump = state.public.trump!;
  const bidderMelds = state.public.melds.find((m) => m.seatIndex === bidder)?.melds ?? [];
  const eligible = buryableCards(hand, bidderMelds, trump, state.variant.dealing.bury.restrictions);
  const size = state.variant.dealing.bury.size;
  if (eligible.length < size) {
    throw new Error(`only ${eligible.length} buryable cards, need ${size}`);
  }
  const cards = eligible.slice(0, size).map((c) => ({
    rank: c.rank,
    suit: c.suit,
    copyIndex: c.copyIndex,
  }));
  return { type: 'bury', seat: bidder, cards };
}

/** Play the seat-to-act's first legal card during `TrickPlay`. */
function firstLegalPlay(state: State): Event {
  const seat = state.public.seatToAct!;
  const hand = state.private.hands[seat]!;
  const legal = LegalPlayValidator(hand, state.public.currentTrick, state.public.trump!, state.variant.trick);
  const card = legal[0]!;
  return {
    type: 'playCard',
    seat,
    card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex },
  };
}

/**
 * A differentiating `TrickPlay` policy for the Cutthroat match driver: the bidder
 * (the lone bidding seat in free-for-all) plays its strongest legal card to capture
 * counters, the defenders dump their weakest. With distinct per-hand seeds this
 * breaks the symmetry a fixed-card policy would create, so the three seats reach
 * distinct cumulative scores.
 */
function competitivePlay(state: State): Event {
  const seat = state.public.seatToAct!;
  const trump = state.public.trump!;
  const trick = state.public.currentTrick;
  const legal = LegalPlayValidator(state.private.hands[seat]!, trick, trump, state.variant.trick);
  const byStrengthDesc = [...legal].sort(
    (a, b) => trickStrength(b, trump, trick.ledSuit ?? b.suit) - trickStrength(a, trump, trick.ledSuit ?? a.suit),
  );
  const wantsToWin = seat === state.public.contract!.seatIndex;
  const card = wantsToWin ? byStrengthDesc[0]! : byStrengthDesc[byStrengthDesc.length - 1]!;
  return {
    type: 'playCard',
    seat,
    card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex },
  };
}

/**
 * Drive a single Single-Deck Cutthroat hand from a fresh state to the first
 * `HandScoring` (the seat left of the dealer takes the contract at the minimum, the
 * bid winner declares the first deck suit, buries the first eligible cards, and each
 * trick plays the first legal card). Records the event log.
 */
function driveCutthroatHand(seed: number): { log: Event[]; final: State } {
  const log: Event[] = [];
  let state = createInitialState(SINGLE_DECK_CUTTHROAT, 0);
  const emit = (event: Event): void => {
    log.push(event);
    state = reduce(state, event);
  };

  let guard = 0;
  while (state.public.phase !== 'HandScoring') {
    if (guard++ > 5_000) throw new Error('hand did not reach HandScoring');
    switch (state.public.phase) {
      case 'Dealing':
        emit({ type: 'deal', seed });
        break;
      case 'Auction': {
        const seat = state.public.seatToAct!;
        if (state.public.auction!.highBid === null) {
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
      case 'Bury':
        emit(buryEvent(state));
        break;
      case 'TrickPlay':
        emit(firstLegalPlay(state));
        break;
      default:
        throw new Error(`unexpected phase ${state.public.phase}`);
    }
  }
  return { log, final: state };
}

describe('Single-Deck Cutthroat — full hand and match integration', () => {
  it('folds a full Cutthroat hand through Bury and 15 tricks to a scored HandScoring', () => {
    const { final } = driveCutthroatHand(4242);

    expect(final.public.phase).toBe('HandScoring');
    const bidder = final.public.contract!.seatIndex;
    // The bidder buried exactly 3 cards face-down.
    expect(final.private.buried).toHaveLength(3);
    // 15 tricks (3 seats × 15 cards) were played and all hands are empty.
    expect(final.public.completedTricks).toHaveLength(15);
    expect(final.private.hands.every((h) => h.cards.length === 0)).toBe(true);
    // A hand result was computed; the bidding side is the bidder's seat (free-for-all).
    const result = final.public.handResult!;
    expect(result).not.toBeNull();
    expect(result.side).toBe(bidder);
    // Every counter on the table (240) plus the last-trick bonus (10) is accounted
    // for across the captured tally and the buried pile.
    const capturedCounters = final.public.captured.reduce((sum, c) => sum + c.counters, 0);
    const buriedCounters = final.private.buried.reduce((sum, c) => {
      return sum + SINGLE_DECK_CUTTHROAT.scoring.counters[c.rank];
    }, 0);
    expect(capturedCounters + buriedCounters).toBe(250);
  });

  it('folds a full 9-deal Cutthroat match to MatchComplete with placement standings, replaying deep-equal', () => {
    const log: Event[] = [];
    let state = createInitialState(SINGLE_DECK_CUTTHROAT, 0);
    let seed = 1;
    const emit = (event: Event): void => {
      log.push(event);
      state = reduce(state, event);
    };

    let guard = 0;
    while (state.public.phase !== 'MatchComplete') {
      if (guard++ > 50_000) throw new Error('match did not terminate');
      switch (state.public.phase) {
        case 'Dealing':
        case 'HandScoring':
          emit({ type: 'deal', seed: seed++ });
          break;
        case 'Auction': {
          const seat = state.public.seatToAct!;
          if (state.public.auction!.highBid === null) {
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
        case 'Bury':
          emit(buryEvent(state));
          break;
        case 'TrickPlay':
          emit(competitivePlay(state));
          break;
        default:
          throw new Error(`unexpected phase ${state.public.phase}`);
      }
    }

    const result = state.public.matchResult!;
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
    // Cutthroat is rated on individual placement across the three teamless seats.
    expect(result.ratingBasis).toBe('individual-placement');
    expect(result.standings).toHaveLength(3);
    // A fixed-deals match plays exactly 9 hands.
    expect(state.public.scorePad.hands).toHaveLength(9);
    // Standings track the running score pad.
    for (const standing of result.standings) {
      expect(standing.cumulative).toBe(state.public.scorePad.cumulative[standing.side]);
    }
    // Placements are derived correctly from the cumulative / hands-made-as-bidder
    // ranking (the share-and-skip rule): each side's placement is one more than the
    // number of sides that strictly out-rank it, and placement 1 is the only win.
    const ranksAhead = (s: (typeof result.standings)[number]): number =>
      result.standings.filter(
        (o) => o.cumulative > s.cumulative || (o.cumulative === s.cumulative && o.handsMadeAsBidder > s.handsMadeAsBidder),
      ).length;
    for (const standing of result.standings) {
      expect(standing.placement).toBe(ranksAhead(standing) + 1);
      expect(standing.outcome).toBe(standing.placement === 1 ? 'win' : 'loss');
    }
    // At least one side placed first.
    expect(result.standings.some((s) => s.placement === 1)).toBe(true);

    // Folding the same log from scratch reproduces the terminal state exactly.
    const replay = log.reduce((s, event) => reduce(s, event), createInitialState(SINGLE_DECK_CUTTHROAT, 0));
    expect(replay).toEqual(state);
  });
});
