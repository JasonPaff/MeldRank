import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { playerStatus, playerType } from './enums';

/**
 * Unified identity table for humans and bots, discriminated by `type` (design
 * D6). `clerk_user_id` is nullable (bots have none) and uniquely indexed where
 * present, so multiple bot nulls coexist. A check constraint binds
 * `type='human'` ⟺ `clerk_user_id IS NOT NULL`. Identity is mirrored from Clerk.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: playerType('type').notNull(),
    clerkUserId: text('clerk_user_id'),
    displayName: text('display_name').notNull(),
    avatar: text('avatar'),
    status: playerStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `type='human'` ⟺ a Clerk id is present (biconditional over two booleans).
    check('players_clerk_identity_check', sql`(${table.type} = 'human') = (${table.clerkUserId} IS NOT NULL)`),
    // Unique only where present, so bots (all null) do not collide.
    uniqueIndex('players_clerk_user_id_key')
      .on(table.clerkUserId)
      .where(sql`${table.clerkUserId} IS NOT NULL`),
  ],
);

/**
 * Thin side-table for bot players, keyed by `player_id` (design D6). Holds the
 * bot's `difficulty` and a `params` jsonb seam for engine tuning.
 */
export const botProfiles = pgTable('bot_profiles', {
  playerId: uuid('player_id')
    .primaryKey()
    .references(() => players.id),
  difficulty: text('difficulty').notNull(),
  params: jsonb('params'),
});
