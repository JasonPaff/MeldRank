import type { Rank, Suit } from './schema';

/**
 * The Standard single-deck meld table — the canonical meld definitions and point
 * values shared by both ranked rulesets ("Ranked Ruleset — Single-Deck Partners"
 * §6; "Single-Deck Cutthroat" §7 inherits it identically), per design decision
 * D1/D2 of the `meld-detector` change.
 *
 * This module is **plain, Zod-free data**: it carries no runtime import (only the
 * type-only rank/suit vocabulary from the schema, erased at build), so the engine
 * can read the table — `@meldrank/shared/meld` — without dragging Zod or any other
 * runtime dependency into its zero-dependency surface. The table is declarative:
 * each meld names its `type`, `class`, point `value`, optional `double` bonus, and
 * a small tagged-union `pattern` the MeldDetector interprets. The values are the
 * single source of truth, validated against the ruleset oracle by the unit tests.
 */

/** The meld tables the variant schema can reference (`melding.meldTableId`). */
export type MeldTableId = 'standard-single-deck' | 'standard-double-deck';

/** A meld's scoring class — mirrors the engine domain's `MeldClass`. */
export type MeldTableClass = 'A' | 'B' | 'C';

/** A concrete rank+suit a pattern requires (e.g. the Q♠/J♦ of a pinochle). */
export interface MeldCardPattern {
  readonly rank: Rank;
  readonly suit: Suit;
}

/**
 * The five closed pattern kinds the MeldDetector knows how to interpret (design
 * D2). The table supplies each pattern's parameters; the detector knows the kinds.
 *
 * - `trump-run` — the named ranks, all of the declared trump suit.
 * - `marriage` — a K+Q of the trump suit (`'trump'` → Royal Marriage) or of any
 *   one non-trump suit (`'non-trump'` → Marriage).
 * - `dix` — the 9 of the declared trump suit.
 * - `pinochle` — a fixed set of off-suit cards (Q♠ + J♦).
 * - `around` — one of the named rank in each of the four suits.
 */
export type MeldPattern =
  | { readonly kind: 'trump-run'; readonly ranks: readonly Rank[] }
  | { readonly kind: 'marriage'; readonly suit: 'trump' | 'non-trump' }
  | { readonly kind: 'dix' }
  | { readonly kind: 'pinochle'; readonly cards: readonly MeldCardPattern[] }
  | { readonly kind: 'around'; readonly rank: Rank };

/**
 * One meld definition: its `type` name, scoring `class`, single `value`, optional
 * `double` bonus (scored *instead of* two singles when both copies are present),
 * and the structural `pattern` that recognizes it.
 */
export interface MeldDefinition {
  readonly type: string;
  readonly class: MeldTableClass;
  readonly value: number;
  readonly double?: number;
  readonly pattern: MeldPattern;
}

/** A resolved meld table: its id and the full set of meld definitions. */
export interface MeldTable {
  readonly id: MeldTableId;
  readonly melds: readonly MeldDefinition[];
}

/**
 * The Standard single-deck meld definitions, in Class A → B → C order, with the
 * exact canonical values from "Single-Deck Partners" §6.
 */
const STANDARD_SINGLE_DECK_MELDS: readonly MeldDefinition[] = [
  // Class A — runs, marriages, dix.
  {
    type: 'run',
    class: 'A',
    value: 150,
    double: 1500,
    pattern: { kind: 'trump-run', ranks: ['A', '10', 'K', 'Q', 'J'] },
  },
  { type: 'royal-marriage', class: 'A', value: 40, pattern: { kind: 'marriage', suit: 'trump' } },
  { type: 'marriage', class: 'A', value: 20, pattern: { kind: 'marriage', suit: 'non-trump' } },
  { type: 'dix', class: 'A', value: 10, pattern: { kind: 'dix' } },
  // Class B — pinochles.
  {
    type: 'pinochle',
    class: 'B',
    value: 40,
    double: 300,
    pattern: {
      kind: 'pinochle',
      cards: [
        { rank: 'Q', suit: 'spades' },
        { rank: 'J', suit: 'diamonds' },
      ],
    },
  },
  // Class C — arounds (one of the named rank in each of the four suits).
  {
    type: 'aces-around',
    class: 'C',
    value: 100,
    double: 1000,
    pattern: { kind: 'around', rank: 'A' },
  },
  {
    type: 'kings-around',
    class: 'C',
    value: 80,
    double: 800,
    pattern: { kind: 'around', rank: 'K' },
  },
  {
    type: 'queens-around',
    class: 'C',
    value: 60,
    double: 600,
    pattern: { kind: 'around', rank: 'Q' },
  },
  {
    type: 'jacks-around',
    class: 'C',
    value: 40,
    double: 400,
    pattern: { kind: 'around', rank: 'J' },
  },
];

/** The Standard single-deck meld table — resolved by `meldTableId: 'standard-single-deck'`. */
export const STANDARD_SINGLE_DECK_MELD_TABLE: MeldTable = {
  id: 'standard-single-deck',
  melds: STANDARD_SINGLE_DECK_MELDS,
};

/**
 * Resolve a meld table by its `meldTableId`. The `standard-single-deck` table is
 * fully populated; `standard-double-deck` is reserved and deferred ("Game Engine
 * — Abstract Model" §3 Ruling 3), so this returns `null` for it — signalling the
 * reserved-but-unpopulated state rather than a partial table.
 */
export function getMeldTable(id: MeldTableId): MeldTable | null {
  return id === 'standard-single-deck' ? STANDARD_SINGLE_DECK_MELD_TABLE : null;
}
