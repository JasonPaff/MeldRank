import { customType, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { matches } from './matches';

/**
 * Postgres `bytea` column — drizzle-orm has no native bytea, so map it through a
 * custom type that round-trips a `Buffer` (Node) verbatim.
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Opaque replay storage (design D5). `data`/`schema_version`/`format` are stored
 * and returned verbatim; no SQL ever inspects them — their meaning is owned by
 * the Match Runtime writer. The PK is `match_id` (FK → `matches`), so there is at
 * most one replay per match and a replay cannot dangle without its match. The
 * object-storage `storage_url` seam (Data Model §5) is documented, not built.
 */
export const matchReplays = pgTable('match_replays', {
  matchId: uuid('match_id')
    .primaryKey()
    .references(() => matches.id),
  data: bytea('data').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  format: text('format').notNull(),
});
