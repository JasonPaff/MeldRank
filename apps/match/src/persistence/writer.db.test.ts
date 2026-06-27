import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { LegalPlayValidator } from '@meldrank/engine';
import { SINGLE_DECK_PARTNERS, type MatchResultEvent, type VariantDefinition } from '@meldrank/shared';
import { createDb, dbSchema, type DatabaseClient, type RedisClient } from '@meldrank/shared/server';
import {
  createRoomCore,
  joinRoom,
  submitContribution,
  submitIntent,
  type Clock,
  type Effect,
  type MatchRecord,
  type PlayerIntent,
  type RoomCoreState,
  type ServerSeedSource,
  type StepResult,
} from '../room';
import { buildMatchResultEvent, persistMatchRecord, publishMatchResult } from './writer';

/**
 * The engine→room→persistence spine (capability `match-persistence`, task 5.3),
 * end-to-end against a live Postgres: drive four stub seats through a full
 * Single-Deck Partners match to completion, then persist the emitted `MatchRecord`
 * and assert the `matches` + scorecard + `match_replays` rows landed and the result
 * event carries the persisted identity.
 *
 * Requires `DATABASE_URL`; skipped cleanly when unset (CI/unit-only runs), exactly
 * like the schema round-trip suite in `@meldrank/shared`.
 */
const databaseUrl = process.env.DATABASE_URL;

const { matches, matchHands, matchHandLines, matchReplays } = dbSchema;

// A target-score of 1 ends the match after the first hand — a complete, played-out
// match with a real scorecard, kept deterministic and fast for the live-DB path.
const variant: VariantDefinition = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target: 1 } };

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

const clock: Clock = () => 0;

function connFor(state: RoomCoreState, seat: number): string {
  return state.seats.find((s) => s.seatIndex === seat)!.connectionId;
}

/** Drive four stub seats through a full Partners match, returning the persist record. */
function runMatchToCompletion(): MatchRecord {
  const seed = fixedSeeder();
  let state = createRoomCore(variant);
  const count = variant.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
  for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;

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

  const persist = last.effects.find((e): e is Extract<Effect, { kind: 'persist' }> => e.kind === 'persist');
  if (persist === undefined) {
    throw new Error('match did not complete with a persist effect');
  }
  return persist.record;
}

describe.skipIf(!databaseUrl)('match persistence spine (live DB)', () => {
  const db = (databaseUrl ? createDb({ DATABASE_URL: databaseUrl }) : null) as DatabaseClient;
  const createdMatchIds: string[] = [];

  afterAll(async () => {
    // Delete children before parents to respect FKs.
    for (const matchId of createdMatchIds) {
      const handRows = await db.select({ id: matchHands.id }).from(matchHands).where(eq(matchHands.matchId, matchId));
      for (const hand of handRows) {
        await db.delete(matchHandLines).where(eq(matchHandLines.matchHandId, hand.id));
      }
      await db.delete(matchHands).where(eq(matchHands.matchId, matchId));
      await db.delete(matchReplays).where(eq(matchReplays.matchId, matchId));
      await db.delete(matches).where(eq(matches.id, matchId));
    }
  });

  it('persists matches + scorecard + replay rows and emits the result event', async () => {
    const record = runMatchToCompletion();

    const matchId = await persistMatchRecord(db, record);
    createdMatchIds.push(matchId);

    // The match envelope landed exactly as assembled.
    const matchRow = (await db.select().from(matches).where(eq(matches.id, matchId)))[0]!;
    expect(matchRow.mode).toBe('casual');
    expect(matchRow.status).toBe('complete');
    expect(matchRow.resolutionReason).toBe('played_out');
    expect(matchRow.variantId).toBeNull();
    expect(matchRow.variantHash).toBe(record.match.variantHash);
    expect(matchRow.variantSnapshot).toEqual(variant);

    // One scorecard hand with its two side lines folded through projectHand().
    const handRows = await db.select().from(matchHands).where(eq(matchHands.matchId, matchId));
    expect(handRows).toHaveLength(record.hands.length);
    expect(handRows).toHaveLength(1);
    const lineRows = await db.select().from(matchHandLines).where(eq(matchHandLines.matchHandId, handRows[0]!.id));
    expect(lineRows).toHaveLength(2);

    // The opaque replay blob round-trips byte-for-byte as serialized.
    const replayRow = (await db.select().from(matchReplays).where(eq(matchReplays.matchId, matchId)))[0]!;
    expect(replayRow.format).toBe('meldrank-replay');
    expect(replayRow.schemaVersion).toBe(1);
    expect(JSON.parse(Buffer.from(replayRow.data).toString('utf8'))).toEqual(record.replay);

    // The result event carries the persisted identity and the normalized outcomes.
    const captured: { channel: string; message: unknown }[] = [];
    const fakeRedis = {
      publish: (channel: string, message: unknown) => {
        captured.push({ channel, message });
        return Promise.resolve(1);
      },
    } as unknown as RedisClient;
    const event: MatchResultEvent = buildMatchResultEvent(record, matchId);
    await publishMatchResult(fakeRedis, event);

    expect(event.matchId).toBe(matchId);
    expect(event.status).toBe('complete');
    expect(event.outcomes).toHaveLength(4);
    expect(captured).toEqual([{ channel: 'match.result', message: event }]);
  });
});
