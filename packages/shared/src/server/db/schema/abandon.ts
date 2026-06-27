import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { abandonKind } from './enums';
import { matches } from './matches';
import { players } from './players';

/**
 * Append-only substrate the leaver-penalty layer reads (design, Data Model §7).
 * One row per abandon signal the room emits, against the abandoning `player_id`
 * and `match_id`. Indexed by `player_id` for the penalty layer's lookups. Never
 * updated or deleted.
 */
export const abandonEvents = pgTable(
  'abandon_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    kind: abandonKind('kind').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('abandon_events_player_id_idx').on(table.playerId)],
);
