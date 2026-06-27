import { describe, expect, it } from 'vitest';
import { LegalPlayValidator } from '@meldrank/engine';
import { hashVariant, ReplayBlobV1Schema, SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { createRoomCore, disposeRoom, expireGrace, joinRoom, leaveRoom, markPersisted, submitContribution, submitIntent } from './core';
import type { Clock, Effect, MatchRecord, PlayerIntent, RoomCoreState, ServerSeedSource, StepResult } from './types';

/**
 * The match-record accumulator and `assembleMatchRecord` (capability
 * `match-persistence`), exercised through the public surface: a completed match emits
 * exactly one `persist` effect carrying the assembled {@link MatchRecord}. We drive the
 * pure core to each completion path — played out, forfeit, and abort — and assert the
 * per-hand harvest, the intent-log order, the seed-reveal capture, and the
 * status/reason/outcome derivation.
 */

function fixedSeeder(start = 1): ServerSeedSource {
  let n = start;
  return () => {
    const bytes = new Uint8Array(32);
    bytes[0] = n & 0xff;
    bytes[1] = (n >> 8) & 0xff;
    n += 1;
    return bytes;
  };
}

function clientSeed(seat: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 200 + seat;
  return bytes;
}

/** A fixed clock anchored at 0; both startedAt and completedAt stamp at t = 0. */
const clock: Clock = () => 0;

function connFor(state: RoomCoreState, seat: number): string {
  return state.seats.find((s) => s.seatIndex === seat)!.connectionId;
}

/** The variant's partner seat for `seat` ([[0,2],[1,3]] → opposite seat). */
function partnerSeat(seat: number): number {
  return (seat + 2) % 4;
}

/** Fill every seat and run the handshake so the first hand is dealt. */
function bootAndDeal(variant: VariantDefinition, seed: ServerSeedSource, ranked = false): RoomCoreState {
  let state = createRoomCore(variant, { ranked });
  const count = variant.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
  for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;
  return state;
}

/** Drive one hand through auction → declare → trick play, following the first legal move. */
function playOneHand(start: RoomCoreState, seed: ServerSeedSource, variant: VariantDefinition): StepResult {
  let state = start;
  let bidPlaced = false;
  let last: StepResult = { state, effects: [] };
  for (let guard = 0; guard < 1000; guard++) {
    const engine = state.engine;
    if (engine === null) break;
    const phase = engine.public.phase;
    if (phase !== 'Auction' && phase !== 'DeclareTrump' && phase !== 'TrickPlay') break;

    let actorSeat: number;
    let intent: PlayerIntent;
    if (phase === 'Auction') {
      actorSeat = engine.public.seatToAct!;
      intent = bidPlaced ? { type: 'pass', seat: actorSeat } : { type: 'bid', seat: actorSeat, value: variant.bidding.minimumBid };
      bidPlaced = true;
    } else if (phase === 'DeclareTrump') {
      actorSeat = engine.public.contract!.seatIndex;
      intent = { type: 'declareTrump', seat: actorSeat, trump: variant.deck.suits[0]! };
    } else {
      actorSeat = engine.public.seatToAct!;
      const hand = engine.private.hands[actorSeat]!;
      const card = LegalPlayValidator(hand, engine.public.currentTrick, engine.public.trump!, variant.trick)[0]!;
      intent = { type: 'playCard', seat: actorSeat, card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex } };
    }

    last = submitIntent(state, connFor(state, actorSeat), intent, `c-${guard}`, seed, clock);
    state = last.state;
  }
  return last;
}

/** Pull the single `persist` effect from a step (asserting exactly one is present). */
function persistRecord(step: StepResult): MatchRecord {
  const persists = step.effects.filter((e): e is Extract<Effect, { kind: 'persist' }> => e.kind === 'persist');
  expect(persists).toHaveLength(1);
  return persists[0]!.record;
}

describe('played-out match record', () => {
  // A target-score of 1 ends the match after the first hand.
  const variant: VariantDefinition = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target: 1 } };

  it('emits one persist effect at Complete with a played_out envelope', () => {
    const seed = fixedSeeder();
    const last = playOneHand(bootAndDeal(variant, seed), seed, variant);

    expect(last.state.lifecycle).toBe('Complete');
    const record = persistRecord(last);
    expect(record.match.status).toBe('complete');
    expect(record.match.resolutionReason).toBe('played_out');
    expect(record.match.mode).toBe('casual');
    expect(record.match.variantId).toBeNull();
    expect(record.match.variantVersion).toBeNull();
    expect(record.match.variantSnapshot).toEqual(variant);
    expect(record.match.variantHash).toBe(hashVariant(variant));
    expect(record.match.startedAt).toBe(0);
    expect(record.match.completedAt).toBe(0);
  });

  it('harvests the scored hand mirroring the engine state', () => {
    const seed = fixedSeeder();
    const last = playOneHand(bootAndDeal(variant, seed), seed, variant);
    const record = persistRecord(last);
    const pub = last.state.engine!.public;

    expect(record.hands).toHaveLength(1);
    const hand = record.hands[0]!;
    expect(hand.handNumber).toBe(1);
    expect(hand.bidderSeat).toBe(pub.contract!.seatIndex);
    expect(hand.contractValue).toBe(pub.contract!.value);
    expect(hand.trump).toBe(pub.trump);
    expect(hand.made).toBe(pub.handResult!.made);
    expect(hand.lines).toEqual(pub.handResult!.lines.map((l) => ({ side: l.side, meld: l.meld, counters: l.counters, total: l.total })));
    expect(hand.cumulativeBySide).toEqual(pub.scorePad.cumulative);
  });

  it('derives per-seat outcomes from the match standings', () => {
    const seed = fixedSeeder();
    const last = playOneHand(bootAndDeal(variant, seed), seed, variant);
    const record = persistRecord(last);
    const standings = last.state.engine!.public.matchResult!.standings;
    const winnerSide = standings.find((s) => s.placement === 1)!.side;

    expect(record.outcomes).toHaveLength(4);
    // Every outcome is win/loss (no_result is for aborts only) and partners agree.
    for (const { seat, outcome } of record.outcomes) {
      expect(outcome === 'win' || outcome === 'loss').toBe(true);
      const partner = record.outcomes.find((o) => o.seat === partnerSeat(seat))!;
      expect(partner.outcome).toBe(outcome);
    }
    // Seats 0/2 form side 0, seats 1/3 form side 1; the winning side's seats win.
    for (const { seat, outcome } of record.outcomes) {
      const side = seat % 2 === 0 ? 0 : 1;
      expect(outcome).toBe(side === winnerSide ? 'win' : 'loss');
    }
  });

  it('captures the ordered intent log and the hand seed reveal in a schema-valid blob', () => {
    const seed = fixedSeeder();
    const last = playOneHand(bootAndDeal(variant, seed), seed, variant);
    const record = persistRecord(last);

    // The blob is self-describing and round-trips through its schema.
    expect(() => ReplayBlobV1Schema.parse(record.replay)).not.toThrow();
    expect(record.replay.format).toBe('meldrank-replay');
    expect(record.replay.schemaVersion).toBe(1);
    expect(record.replay.variant).toEqual(variant);
    expect(record.replay.hands).toHaveLength(1);

    // Intents are player moves in order — the first is the opening bid, none forced.
    expect(record.replay.intents.length).toBeGreaterThan(0);
    expect(record.replay.intents.every((i) => i.forcedTimeout === false)).toBe(true);
    expect((record.replay.intents[0]!.intent as PlayerIntent).type).toBe('bid');

    // Exactly the one dealt hand's seed reveal, hex-encoded.
    expect(record.replay.reveals).toHaveLength(1);
    expect(record.replay.reveals[0]!.serverSeed).toMatch(/^[0-9a-f]+$/);
    expect(record.replay.reveals[0]!.contributions).toHaveLength(4);
  });
});

describe('forfeit match record', () => {
  it('assembles a complete/forfeit_abandon envelope with normalized outcomes', () => {
    const seed = fixedSeeder();
    const dealt = bootAndDeal(SINGLE_DECK_PARTNERS, seed, true);
    const abandoner = 0;
    const dropped = leaveRoom(dealt, connFor(dealt, abandoner), () => 0).state;
    const result = expireGrace(dropped, abandoner, () => dealt.config.reconnectGraceMs, seed);

    expect(result.state.lifecycle).toBe('Complete');
    const record = persistRecord(result);
    expect(record.match.status).toBe('complete');
    expect(record.match.resolutionReason).toBe('forfeit_abandon');
    expect(record.match.mode).toBe('ranked');
    // opponent_win → win, abandoner_loss / stranded_partner_reduced_loss → loss.
    expect(record.outcomes.find((o) => o.seat === abandoner)!.outcome).toBe('loss');
    expect(record.outcomes.find((o) => o.seat === partnerSeat(abandoner))!.outcome).toBe('loss');
    expect(record.outcomes.find((o) => o.seat === 1)!.outcome).toBe('win');
    expect(record.outcomes.find((o) => o.seat === 3)!.outcome).toBe('win');
    // The match was abandoned before any hand scored, but the dealt hand's reveal is kept.
    expect(record.hands).toHaveLength(0);
    expect(record.replay.reveals).toHaveLength(1);
    expect(() => ReplayBlobV1Schema.parse(record.replay)).not.toThrow();
  });
});

describe('abort match record', () => {
  it('assembles an aborted/aborted envelope with all no_result outcomes', () => {
    const seed = fixedSeeder();
    const dealt = bootAndDeal(SINGLE_DECK_PARTNERS, seed, true);
    let dropped = leaveRoom(dealt, connFor(dealt, 0), () => 0).state;
    dropped = leaveRoom(dropped, connFor(dropped, 1), () => 0).state;
    const result = expireGrace(dropped, 0, () => dealt.config.reconnectGraceMs, seed);

    expect(result.state.lifecycle).toBe('Complete');
    const record = persistRecord(result);
    expect(record.match.status).toBe('aborted');
    expect(record.match.resolutionReason).toBe('aborted');
    expect(record.outcomes).toHaveLength(4);
    expect(record.outcomes.every((o) => o.outcome === 'no_result')).toBe(true);
  });
});

describe('markPersisted (adapter-driven transition)', () => {
  it('advances Complete → Persisted and gates disposal on it', () => {
    const variant: VariantDefinition = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target: 1 } };
    const seed = fixedSeeder();
    const completed = playOneHand(bootAndDeal(variant, seed), seed, variant).state;
    expect(completed.lifecycle).toBe('Complete');

    // Disposal is illegal directly from Complete (a no-op leaving the room unchanged).
    expect(disposeRoom(completed).state.lifecycle).toBe('Complete');

    const persisted = markPersisted(completed).state;
    expect(persisted.lifecycle).toBe('Persisted');
    expect(disposeRoom(persisted).state.lifecycle).toBe('Disposed');
  });
});
