import { assembleSeed, commit, rngFromSeed } from '@meldrank/fairness';
import type { State } from '@meldrank/engine';
import { dealHand, nextHandBase } from './deal';
import type { HandshakeContext } from './types';

/**
 * The per-hand provably-fair shuffle handshake (spec: match-shuffle-handshake).
 * Each hand: {@link openHand} commits a secret server seed and resets the engine to
 * a fresh `Dealing` state for the upcoming hand; seats then contribute; once the
 * window closes, {@link assembleAndDeal} mixes the committed seed with every seat's
 * contribution (deterministic fallback for absent seats), expands it to a full-width
 * `Rng`, and deals.
 */

/**
 * Open a hand's deal window: produce its commitment and the `Dealing` engine state
 * the deal will populate. The `serverSeed` is committed (its hash returned for
 * broadcast) but **not** revealed; the engine is reset to a fresh `Dealing` base for
 * the next hand when the prior hand has finished scoring, or used as-is for the very
 * first hand (already at `Dealing` from `createInitialState`).
 *
 * The returned `commit` hash is what the room broadcasts to every seat before any
 * card is dealt; the `serverSeed` stays inside the {@link HandshakeContext},
 * server-side only.
 */
export function openHand(engine: State, handNonce: number, serverSeed: Uint8Array): { engine: State; handshake: HandshakeContext } {
  const dealing = engine.public.phase === 'HandScoring' ? nextHandBase(engine) : engine;
  return {
    engine: dealing,
    handshake: { handNonce, serverSeed, commit: commit(serverSeed), contributions: [] },
  };
}

/**
 * Close the contribution window and deal: assemble the deal seed over the committed
 * server seed and the collected contributions (the fairness layer substitutes
 * `fallbackContribution` for any absent seat), expand it through `rngFromSeed`, and
 * feed the resulting `Rng` into the Dealer seam via {@link dealHand}. The deal is
 * fully determined by the committed seed plus the contributions, so it is
 * independently reproducible from the eventual reveal.
 */
export function assembleAndDeal(engine: State, handshake: HandshakeContext, seatCount: number): State {
  const seed = assembleSeed(handshake.serverSeed, handshake.handNonce, handshake.contributions, seatCount);
  const rng = rngFromSeed(seed);
  return dealHand(engine, rng);
}
