import { randomUUID } from 'node:crypto';
import { dbSchema, projectHand, type DatabaseClient, type RedisClient } from '@meldrank/shared/server';
import { MATCH_RESULT_CHANNEL, type MatchResultEvent } from '@meldrank/shared';
import type { MatchRecord } from '../room';

/**
 * The durable match writer (design D5; capability `match-persistence`). Turns the
 * assembled {@link MatchRecord} the room emits on its `persist` effect into the four
 * player-FK-free Postgres tables and the status-only Redis result event. This is the
 * IO half the pure `RoomCore` deliberately leaves to the adapter; it is isolated here
 * so the engine→room→persistence spine is testable against a live DB without a socket.
 */

const { matches, matchHands, matchHandLines, matchReplays } = dbSchema;

/** The non-empty-tuple argument `db.batch` requires, derived without importing drizzle. */
type BatchArg = Parameters<DatabaseClient['batch']>[0];

/** An injected epoch-ms instant rendered as a timestamptz `Date`, or null. */
function toDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

/**
 * Write a completed match transactionally and return its generated id (design D5).
 *
 * The Neon HTTP driver has no interactive transactions, so the id of every row is
 * generated up front (`randomUUID`) and the whole match is sent as a single
 * `db.batch([...])` — which Neon executes as one transaction, so a match never lands
 * half-written. One `matches` row, then per accumulated hand the `projectHand()`-folded
 * `match_hands` row and its `match_hand_lines`, then the opaque `match_replays` blob
 * (the `ReplayBlobV1` serialized to a `bytea` Buffer). `match_participants` /
 * `abandon_events` are not touched this slice (no player FKs).
 */
export async function persistMatchRecord(db: DatabaseClient, record: MatchRecord): Promise<string> {
  const matchId = randomUUID();

  const writes: unknown[] = [
    db.insert(matches).values({
      id: matchId,
      mode: record.match.mode,
      status: record.match.status,
      resolutionReason: record.match.resolutionReason,
      variantId: record.match.variantId,
      variantVersion: record.match.variantVersion,
      variantSnapshot: record.match.variantSnapshot,
      variantHash: record.match.variantHash,
      startedAt: toDate(record.match.startedAt),
      completedAt: toDate(record.match.completedAt),
    }),
  ];

  for (const hand of record.hands) {
    const handId = randomUUID();
    const projected = projectHand(hand);
    writes.push(db.insert(matchHands).values({ id: handId, matchId, ...projected.hand }));
    if (projected.lines.length > 0) {
      writes.push(db.insert(matchHandLines).values(projected.lines.map((line) => ({ matchHandId: handId, ...line }))));
    }
  }

  writes.push(
    db.insert(matchReplays).values({
      matchId,
      data: Buffer.from(JSON.stringify(record.replay), 'utf8'),
      schemaVersion: record.replay.schemaVersion,
      format: record.replay.format,
    }),
  );

  await db.batch(writes as unknown as BatchArg);
  return matchId;
}

/**
 * Build the status-only result event (design D6) from the written record and its
 * DB-generated id — the API↔Match contract. The heavy intent log and seed reveals stay
 * in the durable replay blob and never appear here.
 */
export function buildMatchResultEvent(record: MatchRecord, matchId: string): MatchResultEvent {
  return {
    matchId,
    mode: record.match.mode,
    status: record.match.status,
    resolutionReason: record.match.resolutionReason,
    variantId: record.match.variantId,
    variantVersion: record.match.variantVersion,
    outcomes: record.outcomes.map((o) => ({ seat: o.seat, outcome: o.outcome })),
  };
}

/** Publish a result event to the single `match.result` channel (design D6). */
export async function publishMatchResult(redis: RedisClient, event: MatchResultEvent): Promise<void> {
  await redis.publish(MATCH_RESULT_CHANNEL, event);
}
