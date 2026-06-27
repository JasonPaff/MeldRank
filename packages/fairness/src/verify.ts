import { deal, type DealResult, type DeckSpec } from '@meldrank/engine';
import { assembleSeed, type SeatContribution } from './assemble';
import { type RevealBundle, RevealBundleSchema } from './bundle';
import { commit } from './commit';
import { dealtResultDigest } from './digest';
import { bytesEqual, fromHex, toHex } from './encoding';
import { rngFromSeed } from './rng';

/**
 * The public deal configuration needed to replay a deal: the deck spec plus the
 * per-hand sizes the engine `deal` requires. These are non-secret variant
 * parameters, so a verifier supplies them alongside the reveal bundle — together
 * they are replay-sufficient (design D7).
 */
export interface DealSpec {
  readonly deckSpec: DeckSpec;
  readonly handSize: number;
  readonly widowSize: number;
}

/**
 * The outcome of {@link verify}: `ok` is whether every check passed; on failure
 * `reason` names the first check that did not hold, for auditing. Verification
 * returns a typed result rather than throwing on a mismatch — a failed audit is
 * an expected outcome, not an exceptional one.
 */
export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?: VerifyFailureReason;
}

/** Why a {@link verify} failed: the first check that did not hold. */
export type VerifyFailureReason = 'malformed-bundle' | 'commit-mismatch' | 'result-digest-mismatch';

/** Re-derive the dealt result a bundle attests to: reassemble the seed, rebuild the `Rng`, re-run `deal`. */
function replayDeal(bundle: RevealBundle, dealSpec: DealSpec): { serverSeed: Uint8Array; result: DealResult } {
  const serverSeed = fromHex(bundle.serverSeed);
  const present: SeatContribution[] = [];
  for (const contribution of bundle.contributions) {
    if (!contribution.substituted) {
      present.push({ seat: contribution.seat, clientSeed: fromHex(contribution.clientSeed) });
    }
  }
  const seed = assembleSeed(serverSeed, bundle.handNonce, present, bundle.contributions.length);
  const result = deal(dealSpec.deckSpec, dealSpec.handSize, dealSpec.widowSize, rngFromSeed(seed));
  return { serverSeed, result };
}

/**
 * Verify a reveal bundle, per design D7 and the "Post-hand reveal and
 * verification" requirement. Given only the bundle and the public deck/deal
 * spec, this:
 *   1. validates the bundle shape;
 *   2. recomputes `commit(serverSeed)` and confirms it equals the published commit;
 *   3. reassembles the seed (substituted seats re-derived via the committed seed);
 *   4. rebuilds the `Rng` and re-runs the real engine `deal`;
 *   5. confirms the re-run result matches the bundle's `dealtResultDigest`.
 *
 * Any failed check returns `{ ok: false, reason }`; all passing returns
 * `{ ok: true }`. No additional server state is consulted.
 */
export function verify(bundle: RevealBundle, dealSpec: DealSpec): VerifyResult {
  const parsed = RevealBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    return { ok: false, reason: 'malformed-bundle' };
  }
  const valid = parsed.data;

  const { serverSeed, result } = replayDeal(valid, dealSpec);

  if (!bytesEqual(commit(serverSeed), fromHex(valid.commit))) {
    return { ok: false, reason: 'commit-mismatch' };
  }
  if (toHex(dealtResultDigest(result)) !== valid.dealtResultDigest) {
    return { ok: false, reason: 'result-digest-mismatch' };
  }
  return { ok: true };
}
