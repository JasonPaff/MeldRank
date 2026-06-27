import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, type DatabaseClient } from './client';
import { abandonEvents, matchHandLines, matchHands, matchParticipants, matchReplays, matches, players } from './schema';

/**
 * DB round-trip / constraint tests against a live Postgres (design D8). These
 * prove the generated schema's integrity rules — the `players` check constraint
 * and partial-unique index, FK enforcement, the parent/child hand grain, and the
 * opaque replay round-trip — by inserting representative rows and asserting
 * rejection cases.
 *
 * Requires `DATABASE_URL`; skipped cleanly when unset (e.g. CI/unit-only runs).
 * Run with the dev DB configured: `DATABASE_URL=... pnpm --filter @meldrank/shared test`.
 */
const databaseUrl = process.env.DATABASE_URL;

/** First row of an insert/select result, asserting one is present. */
function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected at least one row');
  }
  return row;
}

describe.skipIf(!databaseUrl)('match-record schema (live DB)', () => {
  // Construct the client only when a DB is configured — the describe body still
  // evaluates during collection even when the suite is skipped, and `neon()`
  // throws on an empty connection string.
  const db = (databaseUrl ? createDb({ DATABASE_URL: databaseUrl }) : null) as DatabaseClient;

  // Track inserted ids for FK-safe teardown.
  const createdPlayerIds: string[] = [];
  const createdMatchIds: string[] = [];

  const VARIANT_SNAPSHOT = { id: 'single-deck-partners', name: 'Single-Deck Partners' };

  /** Insert a bot player (no Clerk id) and return its id, registering for cleanup. */
  async function makeBot(displayName = 'Test Bot'): Promise<string> {
    const row = first(await db.insert(players).values({ type: 'bot', displayName }).returning({ id: players.id }));
    createdPlayerIds.push(row.id);
    return row.id;
  }

  /** Insert a complete ranked match and return its id, registering for cleanup. */
  async function makeMatch(): Promise<string> {
    const row = first(
      await db
        .insert(matches)
        .values({
          mode: 'ranked',
          status: 'complete',
          resolutionReason: 'played_out',
          variantId: 'single-deck-partners',
          variantVersion: 1,
          variantSnapshot: VARIANT_SNAPSHOT,
          variantHash: 'hash-abc',
        })
        .returning({ id: matches.id }),
    );
    createdMatchIds.push(row.id);
    return row.id;
  }

  afterAll(async () => {
    // Delete children before parents to respect FKs.
    if (createdMatchIds.length > 0) {
      const handRows = await db.select({ id: matchHands.id }).from(matchHands).where(inArray(matchHands.matchId, createdMatchIds));
      const handIds = handRows.map((h) => h.id);
      if (handIds.length > 0) {
        await db.delete(matchHandLines).where(inArray(matchHandLines.matchHandId, handIds));
        await db.delete(matchHands).where(inArray(matchHands.id, handIds));
      }
      await db.delete(abandonEvents).where(inArray(abandonEvents.matchId, createdMatchIds));
      await db.delete(matchReplays).where(inArray(matchReplays.matchId, createdMatchIds));
      await db.delete(matchParticipants).where(inArray(matchParticipants.matchId, createdMatchIds));
      await db.delete(matches).where(inArray(matches.id, createdMatchIds));
    }
    if (createdPlayerIds.length > 0) {
      await db.delete(players).where(inArray(players.id, createdPlayerIds));
    }
  });

  describe('players check constraint and partial-unique index', () => {
    it('rejects a human with a null clerk_user_id', async () => {
      await expect(db.insert(players).values({ type: 'human', displayName: 'No Clerk Id' })).rejects.toThrow();
    });

    it('rejects a bot carrying a clerk_user_id', async () => {
      await expect(
        db.insert(players).values({ type: 'bot', clerkUserId: 'clerk_should_not_have', displayName: 'Bad Bot' }),
      ).rejects.toThrow();
    });

    it('allows multiple null clerk ids but rejects a duplicate non-null clerk id', async () => {
      // Two bots with null clerk ids coexist under the partial-unique index.
      await makeBot('Bot A');
      await makeBot('Bot B');

      const clerkId = `clerk_dup_${VARIANT_SNAPSHOT.id}_${createdPlayerIds.length}`;
      const human = first(
        await db.insert(players).values({ type: 'human', clerkUserId: clerkId, displayName: 'Human One' }).returning({ id: players.id }),
      );
      createdPlayerIds.push(human.id);

      await expect(db.insert(players).values({ type: 'human', clerkUserId: clerkId, displayName: 'Human Dup' })).rejects.toThrow();
    });
  });

  describe('matches variant columns', () => {
    it('round-trips a casual match with null variant reference but a present snapshot', async () => {
      const row = first(
        await db
          .insert(matches)
          .values({
            mode: 'casual',
            status: 'complete',
            resolutionReason: 'played_out',
            variantSnapshot: VARIANT_SNAPSHOT,
            variantHash: 'hash-casual',
          })
          .returning(),
      );
      createdMatchIds.push(row.id);

      expect(row.variantId).toBeNull();
      expect(row.variantVersion).toBeNull();
      expect(row.variantSnapshot).toEqual(VARIANT_SNAPSHOT);
      expect(row.variantHash).toBe('hash-casual');
    });

    it('round-trips a ranked match carrying its full variant reference', async () => {
      const matchId = await makeMatch();
      const row = first(await db.select().from(matches).where(eq(matches.id, matchId)));

      expect(row.mode).toBe('ranked');
      expect(row.variantId).toBe('single-deck-partners');
      expect(row.variantVersion).toBe(1);
      expect(row.variantHash).toBe('hash-abc');
    });
  });

  describe('match participants', () => {
    it('records a free-for-all placement seat with no team', async () => {
      const matchId = await makeMatch();
      const playerId = await makeBot('FFA Seat');

      const row = first(
        await db
          .insert(matchParticipants)
          .values({ matchId, playerId, seatIndex: 2, team: null, outcome: 'loss', placement: 3, finalScore: 120 })
          .returning(),
      );

      expect(row.team).toBeNull();
      expect(row.outcome).toBe('loss');
      expect(row.placement).toBe(3);
      expect(row.isAbandoner).toBe(false);
    });

    it('records an aborted-match seat with no_result and a null placement', async () => {
      const matchId = await makeMatch();
      const playerId = await makeBot('Aborted Seat');

      const row = first(
        await db.insert(matchParticipants).values({ matchId, playerId, seatIndex: 0, outcome: 'no_result', finalScore: 0 }).returning(),
      );

      expect(row.outcome).toBe('no_result');
      expect(row.placement).toBeNull();
    });
  });

  describe('scorecard hands and lines', () => {
    it('persists a Partners hand with two side lines', async () => {
      const matchId = await makeMatch();
      const hand = first(
        await db
          .insert(matchHands)
          .values({ matchId, handNumber: 1, bidderSeat: 0, contractValue: 50, trump: 'spades', made: true })
          .returning({ id: matchHands.id }),
      );

      await db.insert(matchHandLines).values([
        { matchHandId: hand.id, side: 0, meld: 40, counters: 25, total: 65, cumulative: 65 },
        { matchHandId: hand.id, side: 1, meld: 20, counters: 10, total: 30, cumulative: 30 },
      ]);

      const lines = await db.select().from(matchHandLines).where(eq(matchHandLines.matchHandId, hand.id));
      expect(lines).toHaveLength(2);
    });

    it('persists a free-for-all hand with four side lines', async () => {
      const matchId = await makeMatch();
      const hand = first(
        await db
          .insert(matchHands)
          .values({ matchId, handNumber: 1, bidderSeat: 2, contractValue: 40, trump: 'clubs', made: true })
          .returning({ id: matchHands.id }),
      );

      await db.insert(matchHandLines).values([
        { matchHandId: hand.id, side: 0, meld: 10, counters: 5, total: 15, cumulative: 15 },
        { matchHandId: hand.id, side: 1, meld: 12, counters: 8, total: 20, cumulative: 20 },
        { matchHandId: hand.id, side: 2, meld: 30, counters: 15, total: 45, cumulative: 45 },
        { matchHandId: hand.id, side: 3, meld: 6, counters: 0, total: 6, cumulative: 6 },
      ]);

      const lines = await db.select().from(matchHandLines).where(eq(matchHandLines.matchHandId, hand.id));
      expect(lines).toHaveLength(4);
    });
  });

  describe('opaque replay storage', () => {
    it('round-trips arbitrary bytes and metadata byte-for-byte', async () => {
      const matchId = await makeMatch();
      const data = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x42]);

      await db.insert(matchReplays).values({ matchId, data, schemaVersion: 1, format: 'intent-log' });
      const row = first(await db.select().from(matchReplays).where(eq(matchReplays.matchId, matchId)));

      expect(Buffer.from(row.data).equals(data)).toBe(true);
      expect(row.schemaVersion).toBe(1);
      expect(row.format).toBe('intent-log');
    });

    it('rejects a replay whose match_id references no match', async () => {
      await expect(
        db.insert(matchReplays).values({
          matchId: '00000000-0000-0000-0000-000000000000',
          data: Buffer.from([0x01]),
          schemaVersion: 1,
          format: 'intent-log',
        }),
      ).rejects.toThrow();
    });

    it('rejects a second replay for the same match (PK)', async () => {
      const matchId = await makeMatch();
      await db.insert(matchReplays).values({ matchId, data: Buffer.from([0x01]), schemaVersion: 1, format: 'intent-log' });

      await expect(
        db.insert(matchReplays).values({ matchId, data: Buffer.from([0x02]), schemaVersion: 1, format: 'intent-log' }),
      ).rejects.toThrow();
    });
  });

  describe('abandon events', () => {
    it('records an abandon event against a player and match', async () => {
      const matchId = await makeMatch();
      const playerId = await makeBot('Abandoner');

      const row = first(await db.insert(abandonEvents).values({ playerId, matchId, kind: 'forfeit_abandon' }).returning());

      expect(row.kind).toBe('forfeit_abandon');
      expect(row.occurredAt).toBeInstanceOf(Date);
    });
  });
});
