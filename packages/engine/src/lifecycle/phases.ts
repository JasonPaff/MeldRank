import type { VariantDefinition } from '@meldrank/shared';

/**
 * The hand-lifecycle state machine, per "Game Engine — Abstract Model" §2.
 * Structure only: the closed set of phases, the legal-transition table, and a
 * variant-aware active-path resolver. The logic that *drives* each phase
 * (Dealer, AuctionManager, MeldDetector, …) arrives in later engine changes.
 */

/** The ten hand-lifecycle phases. Bracketed phases (Widow/Passing/Bury) are optional per variant. */
export type LifecyclePhase =
  | 'Dealing'
  | 'Auction'
  | 'WidowReveal'
  | 'DeclareTrump'
  | 'Passing'
  | 'Melding'
  | 'Bury'
  | 'TrickPlay'
  | 'HandScoring'
  | 'MatchComplete';

/** The complete set of lifecycle phases, in documented order. */
export const LIFECYCLE_PHASES: readonly LifecyclePhase[] = [
  'Dealing',
  'Auction',
  'WidowReveal',
  'DeclareTrump',
  'Passing',
  'Melding',
  'Bury',
  'TrickPlay',
  'HandScoring',
  'MatchComplete',
] as const;

/** The optional, variant-gated phases (the bracketed states in §2). */
export const OPTIONAL_PHASES: readonly LifecyclePhase[] = ['WidowReveal', 'Passing', 'Bury'] as const;

/**
 * The full legal-transition table for the §2 machine, including every bracketed
 * phase. `Dealing → Auction → [WidowReveal] → DeclareTrump → [Passing] →
 * Melding → [Bury] → TrickPlay → HandScoring`, where `TrickPlay` loops on itself
 * and `HandScoring` branches to `Dealing` (next hand) or `MatchComplete`.
 *
 * Because the bracketed phases can be skipped per variant, the table also
 * carries the "skip" edges (e.g. `Auction → DeclareTrump`, `DeclareTrump →
 * Melding`, `Melding → TrickPlay`) so a transition is legal whenever it follows
 * the documented order with any subset of optional phases removed.
 */
const TRANSITIONS: Readonly<Record<LifecyclePhase, readonly LifecyclePhase[]>> = {
  Dealing: ['Auction'],
  Auction: ['WidowReveal', 'DeclareTrump'],
  WidowReveal: ['DeclareTrump'],
  DeclareTrump: ['Passing', 'Melding'],
  Passing: ['Melding'],
  Melding: ['Bury', 'TrickPlay'],
  Bury: ['TrickPlay'],
  TrickPlay: ['TrickPlay', 'HandScoring'],
  HandScoring: ['Dealing', 'MatchComplete'],
  MatchComplete: [],
};

/**
 * Report whether `from → to` is a legal transition in the full machine. This is
 * the variant-agnostic check; `resolveActivePath` narrows the path for a
 * specific variant.
 */
export function isLegalTransition(from: LifecyclePhase, to: LifecyclePhase): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Which bracketed phases a variant enables, derived from its axis values. */
function enabledOptionalPhases(variant: VariantDefinition): ReadonlySet<LifecyclePhase> {
  const enabled = new Set<LifecyclePhase>();
  if (variant.dealing.widow.size > 0) enabled.add('WidowReveal');
  if (variant.passing.count > 0) enabled.add('Passing');
  if (variant.dealing.bury.size > 0) enabled.add('Bury');
  return enabled;
}

/**
 * Resolve the variant-specific active path through a single hand: the documented
 * sequence with any disabled bracketed phase removed. `MatchComplete` is a
 * match-level terminal and is not part of a single hand's path.
 *
 * Partners (no widow/passing/bury) →
 *   `Dealing → Auction → DeclareTrump → Melding → TrickPlay → HandScoring`.
 * Cutthroat (widow + bury, no passing) →
 *   `Dealing → Auction → WidowReveal → DeclareTrump → Melding → Bury → TrickPlay → HandScoring`.
 */
export function resolveActivePath(variant: VariantDefinition): LifecyclePhase[] {
  const enabled = enabledOptionalPhases(variant);
  const handPath: readonly LifecyclePhase[] = [
    'Dealing',
    'Auction',
    'WidowReveal',
    'DeclareTrump',
    'Passing',
    'Melding',
    'Bury',
    'TrickPlay',
    'HandScoring',
  ];
  return handPath.filter((phase) => !OPTIONAL_PHASES.includes(phase) || enabled.has(phase));
}
