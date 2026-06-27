import { boolean, integer, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { matches } from './matches';

/**
 * The per-hand envelope of the scorecard (design D2). One row per hand: the
 * bidding context (`bidder_seat`, `contract_value`, `trump`) and the made/set
 * verdict. The per-side results live in `match_hand_lines` so the grain is
 * correct for free-for-all (N sides), not only 2-side Partners.
 */
export const matchHands = pgTable('match_hands', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id')
    .notNull()
    .references(() => matches.id),
  handNumber: integer('hand_number').notNull(),
  bidderSeat: smallint('bidder_seat').notNull(),
  contractValue: integer('contract_value').notNull(),
  trump: text('trump').notNull(),
  made: boolean('made').notNull(),
});

/**
 * One row per side per hand (design D2/D3). Values are stored **as-scored** —
 * after the meld-needs-a-trick gate and the set-penalty override — matching
 * `ScorePad`/`HandScoreLine`. `cumulative` is the running per-side score after
 * the hand. The grain supports any number of sides (2 for Partners, up to 4 for
 * free-for-all).
 */
export const matchHandLines = pgTable('match_hand_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchHandId: uuid('match_hand_id')
    .notNull()
    .references(() => matchHands.id),
  side: smallint('side').notNull(),
  meld: integer('meld').notNull(),
  counters: integer('counters').notNull(),
  total: integer('total').notNull(),
  cumulative: integer('cumulative').notNull(),
});
