import type { VariantDefinition } from '@meldrank/shared';
import type { ScorePad } from '../domain/entities';
import type { HandResult } from '../score/score';

/**
 * The MatchScorer, per "Game Engine — Abstract Model" §5 (design D1–D4). A pure
 * `(scorePad, handResult, handsMadeAsBidder, variant) → MatchResult` that reads
 * the running score pad's cumulative-by-side totals, the just-finished hand's
 * `HandResult` (the bidding side + made/set verdict, needed for the §9 count-out),
 * and the per-side hands-made-as-bidder tiebreak counter to decide whether the
 * match has ended and, when it has, to produce final standings and the rating
 * basis. It mutates nothing, is deterministic, and reads only plain values and the
 * `VariantDefinition` *type* (no runtime dependency).
 *
 * The signature deviates from the bare §5 `(scorePad, variant)` (design D1): the
 * count-out needs the last hand's bidding side + made verdict and the Ruling 2
 * tiebreak needs hands-made-as-bidder — neither is recoverable from `ScorePad`
 * (its lines carry only `{side, meld, counters, total}`), so both are threaded in
 * explicitly rather than thickening every score-pad line with provenance.
 */

/**
 * One side's final standing in a completed match: the side id (partnership index,
 * or seat index for free-for-all), its final cumulative score, its
 * hands-made-as-bidder tiebreak key (Ruling 2), a 1-based `placement` (tied sides
 * share a placement), and the win/loss `outcome` (`win` for placement 1).
 */
export interface MatchStanding {
  readonly side: number;
  readonly cumulative: number;
  readonly handsMadeAsBidder: number;
  readonly placement: number;
  readonly outcome: 'win' | 'loss';
}

/**
 * The MatchScorer's result: whether the match has ended, the per-side standings
 * ordered by placement (empty until complete), and the variant's rating basis.
 */
export interface MatchResult {
  readonly complete: boolean;
  readonly standings: readonly MatchStanding[];
  readonly ratingBasis: 'team-win-loss' | 'individual-placement';
}

/** A side's raw, pre-placement tallies gathered from the score pad and counter. */
interface SideTally {
  readonly side: number;
  readonly cumulative: number;
  readonly handsMadeAsBidder: number;
}

/** The outcome of the match-end evaluation: whether it ended, and the count-out winner if any. */
interface MatchEndOutcome {
  readonly complete: boolean;
  /** The side forced to placement 1 under `target-score`'s count-out, else `null`. */
  readonly winnerSide: number | null;
}

/**
 * Score the match-end condition and, when complete, the final standings.
 */
export function MatchScorer(
  scorePad: ScorePad,
  handResult: HandResult,
  handsMadeAsBidder: Readonly<Record<number, number>>,
  variant: VariantDefinition,
): MatchResult {
  const ratingBasis = variant.ratingBasis;
  const tallies = buildTallies(scorePad, handsMadeAsBidder);
  const end = evaluateMatchEnd(scorePad, handResult, tallies, variant.matchEnd);
  if (!end.complete) {
    return { complete: false, standings: [], ratingBasis };
  }
  const ordered = orderSides(tallies, end.winnerSide);
  return { complete: true, standings: assignPlacements(ordered), ratingBasis };
}

/**
 * Gather one {@link SideTally} per side from the score pad's cumulative totals,
 * folding in each side's hands-made-as-bidder counter (defaulting to `0`). The
 * cumulative keys are the authoritative set of sides; the counter keys are unioned
 * in for robustness (a side that bid-and-made always also scored a line).
 */
function buildTallies(scorePad: ScorePad, handsMadeAsBidder: Readonly<Record<number, number>>): SideTally[] {
  const sideIds = new Set<number>();
  for (const key of Object.keys(scorePad.cumulative)) sideIds.add(Number(key));
  for (const key of Object.keys(handsMadeAsBidder)) sideIds.add(Number(key));
  return [...sideIds].map((side) => ({
    side,
    cumulative: scorePad.cumulative[side] ?? 0,
    handsMadeAsBidder: handsMadeAsBidder[side] ?? 0,
  }));
}

/**
 * Evaluate the variant's `matchEnd` condition (design D2). `fixed-deals` ends once
 * the recorded hand count reaches `deals`. `target-score` applies the §9 count-out
 * with the bidding side counted first: the bidder wins if it **made** and reached
 * the target (even if an opponent also crossed); otherwise the highest other side
 * to reach the target wins; otherwise the match continues.
 */
function evaluateMatchEnd(
  scorePad: ScorePad,
  handResult: HandResult,
  tallies: readonly SideTally[],
  matchEnd: VariantDefinition['matchEnd'],
): MatchEndOutcome {
  if (matchEnd.mode === 'fixed-deals') {
    return { complete: scorePad.hands.length >= matchEnd.deals, winnerSide: null };
  }

  const { target } = matchEnd;
  // 1) The bidding side counts out first: made its bid and reached the target.
  const bidder = tallies.find((t) => t.side === handResult.side);
  if (handResult.made && bidder !== undefined && bidder.cumulative >= target) {
    return { complete: true, winnerSide: bidder.side };
  }
  // 2) Otherwise any other side that reached the target wins (best cumulative,
  //    Ruling 2 tiebreak on hands-made-as-bidder).
  const others = tallies.filter((t) => t.side !== handResult.side && t.cumulative >= target);
  if (others.length > 0) {
    const winner = [...others].sort(compareByRank)[0]!;
    return { complete: true, winnerSide: winner.side };
  }
  // 3) No one counted out: continue the match.
  return { complete: false, winnerSide: null };
}

/**
 * Order the sides for placement (design D3). Under `target-score` the counted-out
 * `winnerSide` is placed first and the remaining sides follow by cumulative
 * descending; under `fixed-deals` (`winnerSide` is `null`) all sides rank by
 * cumulative descending. Ties on cumulative break by hands-made-as-bidder
 * descending, then side id ascending for a stable, deterministic order.
 */
function orderSides(tallies: readonly SideTally[], winnerSide: number | null): SideTally[] {
  if (winnerSide === null) {
    return [...tallies].sort(compareByRank);
  }
  const winner = tallies.find((t) => t.side === winnerSide)!;
  const rest = tallies.filter((t) => t.side !== winnerSide).sort(compareByRank);
  return [winner, ...rest];
}

/** Rank comparator: cumulative desc, then hands-made-as-bidder desc, then side asc. */
function compareByRank(a: SideTally, b: SideTally): number {
  if (b.cumulative !== a.cumulative) return b.cumulative - a.cumulative;
  if (b.handsMadeAsBidder !== a.handsMadeAsBidder) {
    return b.handsMadeAsBidder - a.handsMadeAsBidder;
  }
  return a.side - b.side;
}

/**
 * Assign 1-based placements over the ordered sides with the Ruling 2 share-and-skip
 * rule: sides fully tied on both cumulative score and hands-made-as-bidder share a
 * placement, and the next distinct placement skips the shared positions (e.g. two
 * firsts → the next is placement 3). Placement 1 is a `win`, every other a `loss`.
 */
function assignPlacements(ordered: readonly SideTally[]): MatchStanding[] {
  const standings: MatchStanding[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const tally = ordered[i]!;
    const previous = standings[i - 1];
    const placement = previous !== undefined && fullyTied(tally, ordered[i - 1]!) ? previous.placement : i + 1;
    standings.push({
      side: tally.side,
      cumulative: tally.cumulative,
      handsMadeAsBidder: tally.handsMadeAsBidder,
      placement,
      outcome: placement === 1 ? 'win' : 'loss',
    });
  }
  return standings;
}

/** Two sides are fully tied when equal on both cumulative score and hands-made-as-bidder. */
function fullyTied(a: SideTally, b: SideTally): boolean {
  return a.cumulative === b.cumulative && a.handsMadeAsBidder === b.handsMadeAsBidder;
}
