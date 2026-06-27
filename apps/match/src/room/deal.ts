import {
  createInitialState,
  deal,
  isLegalTransition,
  openAuction,
  resolveActivePath,
  type LifecyclePhase,
  type Rng,
  type State,
} from '@meldrank/engine';
import type { VariantDefinition } from '@meldrank/shared';

/**
 * The room's deal **orchestration** — the one place that distributes cards.
 *
 * It deliberately re-implements the engine's internal `applyDeal` *orchestration*
 * (deal → open auction → advance to the next active phase) rather than going
 * through `reduce({ type: 'deal', seed })`. The reason is the provably-fair
 * handshake (spec: match-shuffle-handshake): the engine's `deal` event accepts only
 * a 32-bit numeric seed and builds its own `createSeededRng`, which bottlenecks the
 * reachable permutation space to 2³². The fairness layer instead produces a
 * **full-width** `Rng` via `rngFromSeed`, explicitly designed to plug straight into
 * the Dealer's injected `rng` seam (`deal(deckSpec, …, rng)`). So the live room
 * deals with that `Rng` here.
 *
 * This is deal *setup* only — no game **rule legality** lives here. Every player
 * move (auction, declare, bury, play, scoring, match-end) still flows exclusively
 * through the engine `reduce`, which remains the single rules authority (design D3).
 */

/**
 * The variant's next active phase after `phase`, mirroring the engine's own
 * `nextActivePhase`: the active path (optional phases the variant disables already
 * skipped) guarded by the legal-transition table.
 */
function nextActivePhase(variant: VariantDefinition, phase: LifecyclePhase): LifecyclePhase | null {
  const path = resolveActivePath(variant);
  const index = path.indexOf(phase);
  if (index < 0 || index + 1 >= path.length) {
    return null;
  }
  const candidate = path[index + 1]!;
  return isLegalTransition(phase, candidate) ? candidate : null;
}

/**
 * Build the fresh `Dealing` base for the **next** hand of a match (mirrors the
 * engine's `startNextHand`): the dealer rotated one seat, every per-hand field
 * reset, and the running score pad plus the match-scope hands-made-as-bidder
 * counter preserved across the hand boundary. `prev` is the state resting at
 * `HandScoring`.
 */
export function nextHandBase(prev: State): State {
  const { variant } = prev;
  const nextDealer = (prev.public.dealerSeat + 1) % variant.seating.playerCount;
  const base = createInitialState(variant, nextDealer);
  return {
    ...base,
    public: { ...base.public, scorePad: prev.public.scorePad, handsMadeAsBidder: prev.public.handsMadeAsBidder },
  };
}

/**
 * Deal a hand into a `Dealing` engine state using the injected `rng`: distribute
 * the hands and widow through the Dealer's `rng` seam, open the auction at the seat
 * left of the dealer, and advance to the variant's next active phase (`Auction`).
 * The resulting state is identical in shape to what `reduce` would have produced
 * for a deal — only the entropy source differs.
 */
export function dealHand(state: State, rng: Rng): State {
  const { variant } = state;
  const next = nextActivePhase(variant, 'Dealing');
  if (next === null) {
    throw new Error('deal orchestration: no active phase after Dealing');
  }
  const { hands, widow } = deal(variant.deck, variant.dealing.handSize, variant.dealing.widow.size, rng);
  const auction = openAuction(variant.seating.playerCount, state.public.dealerSeat);
  return {
    variant,
    public: { ...state.public, phase: next, seatToAct: auction.toAct, auction },
    private: { hands, widow, buried: [] },
  };
}
