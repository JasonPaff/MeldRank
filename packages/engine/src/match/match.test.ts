import { describe, expect, it } from 'vitest';
import {
  SINGLE_DECK_CUTTHROAT,
  SINGLE_DECK_PARTNERS,
  type VariantDefinition,
} from '@meldrank/shared';
import type { ScorePad } from '../domain/entities';
import type { HandResult } from '../score/score';
import { MatchScorer, type MatchStanding } from './match';

/**
 * The `MatchScorer` (design D1–D4). A pure `(scorePad, handResult,
 * handsMadeAsBidder, variant) → MatchResult` that decides match-end (the §9
 * count-out / `fixed-deals` boundary), orders sides into placements with the
 * Ruling 2 hands-made-as-bidder tiebreak and share-and-skip, and reports the
 * variant's rating basis. Oracles: "Single-Deck Partners" §9 and "Game Engine —
 * Abstract Model" Ruling 2.
 */

/** A score pad with the given cumulative-by-side totals and `handCount` recorded hands. */
function pad(cumulative: Record<number, number>, handCount: number): ScorePad {
  return { hands: Array.from({ length: handCount }, () => []), cumulative };
}

/** A minimal hand result carrying only the bidding side and made/set verdict. */
function handResult(side: number, made: boolean): HandResult {
  return { lines: [], side, made };
}

/** Look up a side's standing by side id. */
function standingOf(standings: readonly MatchStanding[], side: number): MatchStanding {
  return standings.find((s) => s.side === side)!;
}

/** A `target-score` variant with a custom target (Partners is team-win-loss). */
function targetScore(target: number): VariantDefinition {
  return { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target } };
}

describe('MatchScorer — match-end (fixed-deals)', () => {
  it('is not complete below the deal count and complete once it is reached', () => {
    // Cutthroat: 9 fixed deals.
    const cumulative = { 0: 100, 1: 200, 2: 300 };
    const below = MatchScorer(pad(cumulative, 8), handResult(0, true), {}, SINGLE_DECK_CUTTHROAT);
    const at = MatchScorer(pad(cumulative, 9), handResult(0, true), {}, SINGLE_DECK_CUTTHROAT);

    expect(below.complete).toBe(false);
    expect(below.standings).toEqual([]);
    expect(at.complete).toBe(true);
  });
});

describe('MatchScorer — match-end (target-score §9 count-out)', () => {
  it('continues while no side has reached the target', () => {
    const result = MatchScorer(
      pad({ 0: 250, 1: 71 }, 1),
      handResult(0, true),
      {},
      targetScore(1500),
    );
    expect(result.complete).toBe(false);
  });

  it('counts the bidding side out first when both sides cross the target', () => {
    // Bidder side 0 made and reached 1500; opponent side 1 crossed higher (1600).
    const result = MatchScorer(
      pad({ 0: 1500, 1: 1600 }, 7),
      handResult(0, true),
      {},
      targetScore(1500),
    );

    expect(result.complete).toBe(true);
    // The bidder wins despite the lower cumulative.
    expect(standingOf(result.standings, 0).placement).toBe(1);
    expect(standingOf(result.standings, 0).outcome).toBe('win');
    expect(standingOf(result.standings, 1).placement).toBe(2);
  });

  it('lets the non-bidding side win when the bidder did not count out', () => {
    // Bidder side 0 was set; only the defender side 1 reached the target.
    const result = MatchScorer(
      pad({ 0: 900, 1: 1500 }, 7),
      handResult(0, false),
      {},
      targetScore(1500),
    );

    expect(result.complete).toBe(true);
    expect(standingOf(result.standings, 1).placement).toBe(1);
    expect(standingOf(result.standings, 1).outcome).toBe('win');
    expect(standingOf(result.standings, 0).placement).toBe(2);
  });

  it('continues when the bidder is set at/above target and no opponent reached (residual)', () => {
    // Side 0 sits at the target from prior hands but was set this hand, and the
    // opponent has not reached — the count-first reading continues play (design D2).
    const result = MatchScorer(
      pad({ 0: 1500, 1: 200 }, 7),
      handResult(0, false),
      {},
      targetScore(1500),
    );
    expect(result.complete).toBe(false);
  });
});

describe('MatchScorer — standings, placement, and tiebreak', () => {
  it('orders sides by cumulative descending (fixed-deals)', () => {
    const result = MatchScorer(
      pad({ 0: 100, 1: 200, 2: 300 }, 9),
      handResult(0, true),
      {},
      SINGLE_DECK_CUTTHROAT,
    );

    expect(result.standings.map((s) => s.side)).toEqual([2, 1, 0]);
    expect(result.standings.map((s) => s.placement)).toEqual([1, 2, 3]);
  });

  it('breaks a cumulative tie by most hands made as bidder', () => {
    // Sides 0 and 1 tie at 500; side 0 made more hands as bidder → better placement.
    const result = MatchScorer(
      pad({ 0: 500, 1: 500, 2: 300 }, 9),
      handResult(0, true),
      { 0: 2, 1: 1 },
      SINGLE_DECK_CUTTHROAT,
    );

    expect(standingOf(result.standings, 0).placement).toBe(1);
    expect(standingOf(result.standings, 1).placement).toBe(2);
    expect(standingOf(result.standings, 2).placement).toBe(3);
  });

  it('shares a placement for fully-tied sides and skips the next placement', () => {
    // Sides 0 and 1 tie on cumulative and hands-made-as-bidder → share placement 1;
    // side 2 then skips to placement 3.
    const result = MatchScorer(
      pad({ 0: 500, 1: 500, 2: 300 }, 9),
      handResult(0, true),
      { 0: 1, 1: 1 },
      SINGLE_DECK_CUTTHROAT,
    );

    expect(standingOf(result.standings, 0).placement).toBe(1);
    expect(standingOf(result.standings, 1).placement).toBe(1);
    expect(standingOf(result.standings, 2).placement).toBe(3);
    // Both shared-first sides are wins.
    expect(standingOf(result.standings, 0).outcome).toBe('win');
    expect(standingOf(result.standings, 1).outcome).toBe('win');
  });
});

describe('MatchScorer — rating basis outcomes', () => {
  it('marks exactly one winner under team-win-loss (Partners)', () => {
    const result = MatchScorer(
      pad({ 0: 1550, 1: 1200 }, 8),
      handResult(0, true),
      {},
      SINGLE_DECK_PARTNERS,
    );

    expect(result.ratingBasis).toBe('team-win-loss');
    expect(result.standings.filter((s) => s.outcome === 'win')).toHaveLength(1);
    expect(standingOf(result.standings, 0).outcome).toBe('win');
    expect(standingOf(result.standings, 1).outcome).toBe('loss');
  });

  it('carries ordinal placements under individual-placement (Cutthroat)', () => {
    const result = MatchScorer(
      pad({ 0: 100, 1: 200, 2: 300 }, 9),
      handResult(2, true),
      {},
      SINGLE_DECK_CUTTHROAT,
    );

    expect(result.ratingBasis).toBe('individual-placement');
    expect(result.standings.map((s) => s.placement).sort()).toEqual([1, 2, 3]);
    expect(standingOf(result.standings, 2).outcome).toBe('win');
    expect(standingOf(result.standings, 1).outcome).toBe('loss');
    expect(standingOf(result.standings, 0).outcome).toBe('loss');
  });
});

describe('MatchScorer — purity and determinism', () => {
  it('does not mutate its inputs and is deep-equal on repeat', () => {
    const scorePad = pad({ 0: 1500, 1: 1600 }, 7);
    const result = handResult(0, true);
    const counter = { 0: 3, 1: 2 };
    const scorePadSnapshot = JSON.parse(JSON.stringify(scorePad)) as ScorePad;
    const resultSnapshot = JSON.parse(JSON.stringify(result)) as HandResult;
    const counterSnapshot = { ...counter };

    const a = MatchScorer(scorePad, result, counter, targetScore(1500));
    const b = MatchScorer(scorePad, result, counter, targetScore(1500));

    expect(a).toEqual(b);
    expect(scorePad).toEqual(scorePadSnapshot);
    expect(result).toEqual(resultSnapshot);
    expect(counter).toEqual(counterSnapshot);
  });
});
