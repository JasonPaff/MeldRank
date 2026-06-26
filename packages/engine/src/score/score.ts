import type { TeamStructure, VariantDefinition } from '@meldrank/shared';
import { makeHandScoreLine, type Contract, type HandScoreLine } from '../domain/entities';
import type { SeatCapture, SeatMeld } from '../state/state';

/**
 * The HandScorer, per "Game Engine — Abstract Model" §5 and "Single-Deck
 * Partners" §8 (design D1, D2). A pure `(melds, captured, contract,
 * buriedCounters, variant) → HandResult` that folds each seat's recorded meld and
 * captured counters into per-**side** results, applies the meld-needs-a-trick
 * gate, and evaluates the bidding side's made/set verdict and set penalty against
 * the contract — all gated by the variant's scoring axes so one function serves
 * both ranked variants. It mutates nothing, is deterministic, and reads only
 * plain values and the `VariantDefinition` *type* (no runtime dependency).
 */

/**
 * The HandScorer's result: the per-side scored lines, the bidding `side` id (the
 * side containing `contract.seatIndex`), and the made/set verdict for the hand.
 */
export interface HandResult {
  readonly lines: readonly HandScoreLine[];
  readonly side: number;
  readonly made: boolean;
}

/** A side's accumulated raw tallies before the gate and made/set evaluation. */
interface SideAccumulator {
  meld: number;
  counters: number;
  tookTrick: boolean;
}

/**
 * The side a seat belongs to (design D3): the partnership's index in
 * `seating.teams.partnerships` for `partnerships`, or the seat index itself for
 * `free-for-all`. For the canonical Partners layout `[[0, 2], [1, 3]]` the
 * partnership index coincides with each group's lead seat (`0` and `1`).
 */
function sideOfSeat(seatIndex: number, teams: TeamStructure): number {
  if (teams.mode === 'free-for-all') {
    return seatIndex;
  }
  return teams.partnerships.findIndex((group) => group.includes(seatIndex));
}

/**
 * Score one finished hand. Folds seats into sides via `seating.teams`, sums each
 * side's meld (`SeatMeld.total`) and counters (`SeatCapture.counters`, which
 * already include the last-trick bonus), credits `buriedCounters` to the bidding
 * side, applies the meld-needs-a-trick gate **before** the made/set check, then
 * evaluates the bidding side against `contract.value` and applies the set penalty
 * / scoring-mode overrides. Returns the per-side lines (ordered by side id), the
 * bidding side id, and the made verdict.
 */
export function HandScorer(
  melds: readonly SeatMeld[],
  captured: readonly SeatCapture[],
  contract: Contract,
  buriedCounters: number,
  variant: VariantDefinition,
): HandResult {
  const { teams } = variant.seating;
  const { meldNeedsATrick, mode, setPenalty } = variant.scoring;
  const biddingSide = sideOfSeat(contract.seatIndex, teams);

  // Fold each seat's captured tally and meld into its side. `captured` carries
  // every dealt seat; `melds` carries only the melding seats. Ensure the bidding
  // side exists even in the degenerate case where it recorded nothing.
  const sides = new Map<number, SideAccumulator>();
  const sideOf = (side: number): SideAccumulator => {
    let entry = sides.get(side);
    if (entry === undefined) {
      entry = { meld: 0, counters: 0, tookTrick: false };
      sides.set(side, entry);
    }
    return entry;
  };
  sideOf(biddingSide);
  for (const capture of captured) {
    const entry = sideOf(sideOfSeat(capture.seatIndex, teams));
    entry.counters += capture.counters;
    if (capture.tricksTaken > 0) {
      entry.tookTrick = true;
    }
  }
  for (const seatMeld of melds) {
    sideOf(sideOfSeat(seatMeld.seatIndex, teams)).meld += seatMeld.total;
  }
  // Buried counters are credited to the bidding side alone (design D3).
  sideOf(biddingSide).counters += buriedCounters;

  // Apply the meld-needs-a-trick gate per side (design D4): a trickless side
  // forfeits its meld. This precedes the made/set check so a bidding side that
  // took no trick cannot make on meld alone.
  const gatedMeld = (entry: SideAccumulator): number =>
    meldNeedsATrick && !entry.tookTrick ? 0 : entry.meld;

  // Evaluate the bidding side against the contract (design D5).
  const bidder = sideOf(biddingSide);
  const made = gatedMeld(bidder) + bidder.counters >= contract.value;

  // Build each side's line in a deterministic side-id order, applying the set
  // penalty (bidding side, set hand) and the `bidder-vs-bid` defender override.
  const lines: HandScoreLine[] = [...sides.entries()]
    .sort(([a], [b]) => a - b)
    .map(([side, entry]) => {
      const meld = gatedMeld(entry);
      const earned = makeHandScoreLine(side, meld, entry.counters);

      if (side === biddingSide && !made) {
        // Set: apply the configured penalty to the bidding side's line.
        return setPenalty === 'minus-bid-and-meld-lost'
          ? { side, meld: 0, counters: 0, total: -contract.value }
          : { ...earned, total: -contract.value };
      }
      if (side !== biddingSide && mode === 'bidder-vs-bid') {
        // Cutthroat defenders score nothing against the bid (design D5).
        return { ...earned, total: 0 };
      }
      return earned;
    });

  return { lines, side: biddingSide, made };
}
