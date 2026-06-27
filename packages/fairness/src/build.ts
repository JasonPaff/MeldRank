import type { DealResult } from '@meldrank/engine';
import type { SeatContribution } from './assemble';
import type { RevealBundle, SeatContributionReveal } from './bundle';
import { commit } from './commit';
import { dealtResultDigest } from './digest';
import { toHex } from './encoding';

/** The reveal-side inputs an orchestrator holds after a hand has been dealt and played. */
export interface RevealBundleInput {
  readonly handNonce: number;
  readonly serverSeed: Uint8Array;
  /** The contributions that actually arrived; absent seats become substitution markers. */
  readonly contributions: readonly SeatContribution[];
  /** Total seats for the hand — drives which seats are marked substituted. */
  readonly seatCount: number;
  /** The dealt result produced by the engine `deal` for this hand. */
  readonly result: DealResult;
}

/**
 * Assemble the replay-sufficient {@link RevealBundle} for a played hand. Mirrors
 * the assembly path: each seat `0..seatCount-1` is recorded with its supplied
 * `clientSeed`, or marked `substituted` when absent (the verifier re-derives the
 * substitute from the committed `serverSeed`). The published `commit` and the
 * dealt-result digest are computed here so the bundle stands alone. The result is
 * a plain serializable value conforming to `RevealBundleSchema`.
 */
export function buildRevealBundle(input: RevealBundleInput): RevealBundle {
  const { handNonce, serverSeed, contributions, seatCount, result } = input;
  const suppliedBySeat = new Map<number, Uint8Array>();
  for (const contribution of contributions) {
    if (suppliedBySeat.has(contribution.seat)) {
      throw new Error(`duplicate contribution for seat ${contribution.seat}`);
    }
    suppliedBySeat.set(contribution.seat, contribution.clientSeed);
  }

  const revealed: SeatContributionReveal[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    const clientSeed = suppliedBySeat.get(seat);
    revealed.push(clientSeed === undefined ? { seat, substituted: true } : { seat, substituted: false, clientSeed: toHex(clientSeed) });
  }

  return {
    handNonce,
    commit: toHex(commit(serverSeed)),
    serverSeed: toHex(serverSeed),
    contributions: revealed,
    dealtResultDigest: toHex(dealtResultDigest(result)),
  };
}
