import { describe, expect, it } from 'vitest';
import { STANDARD_SINGLE_DECK_MELD_TABLE, getMeldTable, type MeldDefinition } from './meld-table';

/**
 * Pins the Standard single-deck meld table to the canonical values from
 * "Single-Deck Partners" §6 (the oracle) and the reserved-double-deck rule
 * (§3 Ruling 3). A wrong value here silently corrupts every later score.
 */

/** Find a meld definition by its `type` name. */
function defOf(type: string): MeldDefinition {
  const def = STANDARD_SINGLE_DECK_MELD_TABLE.melds.find((meld) => meld.type === type);
  if (def === undefined) throw new Error(`no meld definition for '${type}'`);
  return def;
}

describe('Standard single-deck meld table — accessor', () => {
  it('resolves the standard-single-deck id to the populated table', () => {
    const table = getMeldTable('standard-single-deck');
    expect(table).toBe(STANDARD_SINGLE_DECK_MELD_TABLE);
    expect(table?.melds.length).toBeGreaterThan(0);
  });

  it('returns null for the reserved-but-deferred double-deck table', () => {
    expect(getMeldTable('standard-double-deck')).toBeNull();
  });

  it('carries every Class A, B, and C definition', () => {
    const classes = new Set(STANDARD_SINGLE_DECK_MELD_TABLE.melds.map((meld) => meld.class));
    expect([...classes].sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('Standard single-deck meld table — Class A values', () => {
  it('runs, marriages, and dix score the canonical values', () => {
    const run = defOf('run');
    expect(run.class).toBe('A');
    expect(run.value).toBe(150);
    expect(run.double).toBe(1500);
    expect(run.pattern).toEqual({ kind: 'trump-run', ranks: ['A', '10', 'K', 'Q', 'J'] });

    expect(defOf('royal-marriage')).toMatchObject({ class: 'A', value: 40 });
    expect(defOf('marriage')).toMatchObject({ class: 'A', value: 20 });
    expect(defOf('dix')).toMatchObject({ class: 'A', value: 10 });
  });
});

describe('Standard single-deck meld table — Class B values', () => {
  it('pinochle scores 40 and double pinochle 300', () => {
    const pinochle = defOf('pinochle');
    expect(pinochle).toMatchObject({ class: 'B', value: 40, double: 300 });
    expect(pinochle.pattern).toEqual({
      kind: 'pinochle',
      cards: [
        { rank: 'Q', suit: 'spades' },
        { rank: 'J', suit: 'diamonds' },
      ],
    });
  });
});

describe('Standard single-deck meld table — Class C values', () => {
  it('arounds score their single and double (all-eight) values', () => {
    expect(defOf('aces-around')).toMatchObject({ class: 'C', value: 100, double: 1000 });
    expect(defOf('kings-around')).toMatchObject({ class: 'C', value: 80, double: 800 });
    expect(defOf('queens-around')).toMatchObject({ class: 'C', value: 60, double: 600 });
    expect(defOf('jacks-around')).toMatchObject({ class: 'C', value: 40, double: 400 });
  });
});
