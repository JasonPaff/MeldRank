import type { MeldDefinition, MeldTable } from '@meldrank/shared/meld';
import { makeMeld, type Hand, type Meld } from '../domain/entities';
import type { Card, Rank, Suit } from '../domain/card';

/**
 * The MeldDetector, per "Game Engine — Abstract Model" §5 and design decision D5
 * of the `meld-detector` change. A pure `(hand, trump, meldTable) → { melds,
 * total }` that computes a seat's **maximum legal meld set** and its summed value.
 *
 * Meld is engine-computed, not chosen (§3 Ruling 1): there is no under-meld
 * option, so the detector simply constructs the maximum. The three scoring classes
 * are independent — a card may serve at most one meld per class but is freely
 * reused across classes — so the global maximum is the union of each class's
 * independently-computed best selection (D5). The detector mutates nothing, is
 * deterministic, and reads the meld table as plain data (no runtime dependency).
 */

/** The MeldDetector's result: the scored melds and their summed `total`. */
export interface MeldResult {
  readonly melds: readonly Meld[];
  readonly total: number;
}

/** The four suits, used to scan non-trump marriages and arounds. */
const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

/**
 * Compute the maximum legal meld set for `hand` against the declared `trump`,
 * scored by `meldTable`. Trump-dependent melds (Run, Royal Marriage, Dix) are
 * recognized against `trump`; the same cards under a different trump do not score.
 */
export function MeldDetector(hand: Hand, trump: Suit, meldTable: MeldTable): MeldResult {
  const { cards } = hand;
  const melds: Meld[] = [...detectClassA(cards, trump, meldTable), ...detectClassB(cards, meldTable), ...detectClassC(cards, meldTable)];
  const total = melds.reduce((sum, meld) => sum + meld.value, 0);
  return { melds, total };
}

/** The cards in `hand` of a given rank+suit (length 0, 1, or 2 in single-deck). */
function copiesOf(cards: readonly Card[], rank: Rank, suit: Suit): Card[] {
  return cards.filter((card) => card.rank === rank && card.suit === suit);
}

/** Find the single table definition whose pattern matches `kind` (and optional suit). */
function findDef(
  table: MeldTable,
  kind: MeldDefinition['pattern']['kind'],
  marriageSuit?: 'trump' | 'non-trump',
): MeldDefinition | undefined {
  return table.melds.find((def) => {
    if (def.pattern.kind !== kind) return false;
    if (marriageSuit !== undefined && def.pattern.kind === 'marriage') {
      return def.pattern.suit === marriageSuit;
    }
    return true;
  });
}

/**
 * Class A — runs, marriages, dix (design D5). The trump Run is detected first and
 * consumes its trump K–Q for run purposes; a Royal Marriage needs a *second*
 * trump K or Q, so it is scored from the trump K–Q material left over (or borrowed)
 * once the run is accounted for. Non-trump K–Q pairs score Marriages; each trump 9
 * scores a Dix. Both copies of the run collapse to one Double Run.
 */
function detectClassA(cards: readonly Card[], trump: Suit, table: MeldTable): Meld[] {
  const melds: Meld[] = [];

  // Run (and double run). `runCount` is how many complete runs the hand holds.
  let runCount = 0;
  const runDef = findDef(table, 'trump-run');
  if (runDef && runDef.pattern.kind === 'trump-run') {
    const runRanks = runDef.pattern.ranks;
    const perRank = runRanks.map((rank) => copiesOf(cards, rank, trump));
    runCount = Math.min(...perRank.map((copies) => copies.length));
    if (runCount >= 2 && runDef.double !== undefined) {
      const runCards = perRank.flatMap((copies) => copies.slice(0, 2));
      melds.push(makeMeld('double-run', runCards, runDef.double, runDef.class));
    } else if (runCount >= 1) {
      const runCards = perRank.map((copies) => copies[0]!);
      melds.push(makeMeld(runDef.type, runCards, runDef.value, runDef.class));
      runCount = 1;
    }
  }

  // Royal marriages: trump K–Q pairs the run did not already account for. A single
  // run leaves no royal marriage from its own K–Q; a second trump K or Q does
  // (the extra card borrows the run's partner), and any wholly separate trump K–Q
  // pair scores too.
  const royalDef = findDef(table, 'marriage', 'trump');
  if (royalDef) {
    const kTrump = copiesOf(cards, 'K', trump);
    const qTrump = copiesOf(cards, 'Q', trump);
    const kRemaining = kTrump.length - runCount;
    const qRemaining = qTrump.length - runCount;
    const pairs = Math.max(0, Math.min(kRemaining, qRemaining));
    const leftoverSingles = Math.max(0, kRemaining) + Math.max(0, qRemaining) - 2 * pairs;
    const borrow = runCount >= 1 && leftoverSingles >= 1 ? 1 : 0;
    const royalCount = pairs + borrow;
    for (let i = 0; i < royalCount; i++) {
      const king = kTrump[Math.min(i, kTrump.length - 1)]!;
      const queen = qTrump[Math.min(i, qTrump.length - 1)]!;
      melds.push(makeMeld(royalDef.type, [king, queen], royalDef.value, royalDef.class));
    }
  }

  // Non-trump marriages: each suit's K–Q pairs, one Marriage per pair.
  const marriageDef = findDef(table, 'marriage', 'non-trump');
  if (marriageDef) {
    for (const suit of SUITS) {
      if (suit === trump) continue;
      const kings = copiesOf(cards, 'K', suit);
      const queens = copiesOf(cards, 'Q', suit);
      const pairs = Math.min(kings.length, queens.length);
      for (let i = 0; i < pairs; i++) {
        melds.push(makeMeld(marriageDef.type, [kings[i]!, queens[i]!], marriageDef.value, marriageDef.class));
      }
    }
  }

  // Dix: each trump 9 scores independently (no double bonus — two 9s are two dix).
  const dixDef = findDef(table, 'dix');
  if (dixDef) {
    for (const nine of copiesOf(cards, '9', trump)) {
      melds.push(makeMeld(dixDef.type, [nine], dixDef.value, dixDef.class));
    }
  }

  return melds;
}

/**
 * Class B — pinochle (Q♠ + J♦). Both copies of each collapse to one Double
 * Pinochle scored instead of two singles.
 */
function detectClassB(cards: readonly Card[], table: MeldTable): Meld[] {
  const def = findDef(table, 'pinochle');
  if (!def || def.pattern.kind !== 'pinochle') return [];

  const perCard = def.pattern.cards.map((pattern) => copiesOf(cards, pattern.rank, pattern.suit));
  const count = Math.min(...perCard.map((copies) => copies.length));
  if (count >= 2 && def.double !== undefined) {
    const cardsUsed = perCard.flatMap((copies) => copies.slice(0, 2));
    return [makeMeld('double-pinochle', cardsUsed, def.double, def.class)];
  }
  if (count >= 1) {
    const cardsUsed = perCard.map((copies) => copies[0]!);
    return [makeMeld(def.type, cardsUsed, def.value, def.class)];
  }
  return [];
}

/**
 * Class C — arounds (one named rank in each of the four suits). All eight copies
 * collapse to one double "around" scored instead of two singles.
 */
function detectClassC(cards: readonly Card[], table: MeldTable): Meld[] {
  const melds: Meld[] = [];
  for (const def of table.melds) {
    if (def.pattern.kind !== 'around') continue;
    const { rank } = def.pattern;
    const perSuit = SUITS.map((suit) => copiesOf(cards, rank, suit));
    const count = Math.min(...perSuit.map((copies) => copies.length));
    if (count >= 2 && def.double !== undefined) {
      const cardsUsed = perSuit.flatMap((copies) => copies.slice(0, 2));
      melds.push(makeMeld(`double-${def.type}`, cardsUsed, def.double, def.class));
    } else if (count >= 1) {
      const cardsUsed = perSuit.map((copies) => copies[0]!);
      melds.push(makeMeld(def.type, cardsUsed, def.value, def.class));
    }
  }
  return melds;
}
