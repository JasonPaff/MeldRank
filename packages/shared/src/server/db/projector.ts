import type { matchHandLines, matchHands } from './schema/hands';

/**
 * Pure as-scored hand projector (design D4). Turns a plain structural
 * hand-result input into the scorecard insert rows — one `match_hands` row and
 * its `match_hand_lines` rows.
 *
 * It deliberately accepts a plain value object rather than engine types:
 * `@meldrank/engine` depends on `@meldrank/shared`, so `shared` cannot import
 * `engine` without a cycle. The future room-writer does the trivial extraction
 * from `HandResult`/`ScorePad` into this input. The projector imports no engine
 * package and touches no database.
 */

/** Drizzle insert row for a `match_hands` row. */
export type MatchHandInsert = typeof matchHands.$inferInsert;

/** Drizzle insert row for a `match_hand_lines` row. */
export type MatchHandLineInsert = typeof matchHandLines.$inferInsert;

/**
 * The hand row the projector produces, minus `match_id` — the writer supplies the
 * match linkage at insert time (it is not part of the engine-derived input).
 */
export type ProjectedHand = Omit<MatchHandInsert, 'matchId'>;

/**
 * A line row the projector produces, minus `match_hand_id` — the writer sets it
 * after inserting the parent hand and obtaining its generated id.
 */
export type ProjectedHandLine = Omit<MatchHandLineInsert, 'matchHandId'>;

/** One side's as-scored result for a hand, mirroring the engine's `HandScoreLine`. */
export interface ProjectHandLineInput {
  readonly side: number;
  readonly meld: number;
  readonly counters: number;
  readonly total: number;
}

/**
 * Plain projector input (design D4): the bidding context and made verdict, the
 * per-side as-scored lines (from `HandResult.lines`), and the per-side cumulative
 * map after the hand (from `ScorePad.cumulative`).
 */
export interface ProjectHandInput {
  readonly handNumber: number;
  readonly bidderSeat: number;
  readonly contractValue: number;
  readonly trump: string;
  readonly made: boolean;
  readonly lines: readonly ProjectHandLineInput[];
  readonly cumulativeBySide: Readonly<Record<number, number>>;
}

/**
 * Project a hand-result input into its scorecard rows. Joins each side's
 * as-scored line to its cumulative-after score and orders the line rows
 * deterministically by side id. Values pass through unchanged — the gate and
 * set-penalty are already reflected in the input lines.
 */
export function projectHand(input: ProjectHandInput): { hand: ProjectedHand; lines: ProjectedHandLine[] } {
  const hand: ProjectedHand = {
    handNumber: input.handNumber,
    bidderSeat: input.bidderSeat,
    contractValue: input.contractValue,
    trump: input.trump,
    made: input.made,
  };

  const lines: ProjectedHandLine[] = [...input.lines]
    .sort((a, b) => a.side - b.side)
    .map((line) => ({
      side: line.side,
      meld: line.meld,
      counters: line.counters,
      total: line.total,
      cumulative: input.cumulativeBySide[line.side] ?? 0,
    }));

  return { hand, lines };
}
