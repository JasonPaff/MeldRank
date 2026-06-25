import { z } from 'zod';

/**
 * The Variant Definition schema — the full parameter set that *is* a pinochle
 * game, per "Game Engine — Abstract Model" §3.
 *
 * One engine is driven by a `VariantDefinition`; ranked play is two frozen
 * instances ({@link ./canonical}) and casual play is the same schema exposed as
 * configurable. The schema lives here in `@meldrank/shared` (the home of Zod) so
 * the engine can stay zero-runtime-dependency and consume only the inferred
 * `VariantDefinition` *type*.
 *
 * Each axis group below is its own sub-schema so the composition reads as a list
 * of the decisions that distinguish one variant from another.
 */

/** The six pinochle ranks, high to low. Double-deck variants drop the `9`. */
export const RankSchema = z.enum(['A', '10', 'K', 'Q', 'J', '9']);
export type Rank = z.infer<typeof RankSchema>;

/** The four suits. */
export const SuitSchema = z.enum(['spades', 'hearts', 'clubs', 'diamonds']);
export type Suit = z.infer<typeof SuitSchema>;

/**
 * Deck spec — the multiset a deck is built from: which ranks and suits, and how
 * many physical copies of each rank+suit. Single-deck is 6 ranks × 4 suits × 2
 * copies (48); double-deck is 5 ranks × 4 suits × 4 copies (80, dropping the 9s).
 */
export const DeckSpecSchema = z.object({
  ranks: z.array(RankSchema).nonempty(),
  suits: z.array(SuitSchema).nonempty(),
  copiesPerCard: z.number().int().positive(),
});
export type DeckSpec = z.infer<typeof DeckSpecSchema>;

/**
 * Team structure. `free-for-all` has no teams (Cutthroat); `partnerships` groups
 * seat indices into fixed teams (Partners: opposite seats `[[0, 2], [1, 3]]`).
 */
export const TeamStructureSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('free-for-all') }),
  z.object({
    mode: z.literal('partnerships'),
    partnerships: z.array(z.array(z.number().int().nonnegative()).nonempty()).nonempty(),
  }),
]);
export type TeamStructure = z.infer<typeof TeamStructureSchema>;

/** Seating: how many players sit and how (or whether) they are partnered. */
export const SeatingSchema = z.object({
  playerCount: z.number().int().min(2).max(4),
  teams: TeamStructureSchema,
});
export type Seating = z.infer<typeof SeatingSchema>;

/**
 * Widow: the kitty dealt face-to-the-table. `size: 0` disables the WidowReveal
 * phase. `visibility` decides whether the widow is exposed to the table or taken
 * blind.
 */
export const WidowSchema = z.object({
  size: z.number().int().nonnegative(),
  visibility: z.enum(['exposed', 'hidden']),
});
export type Widow = z.infer<typeof WidowSchema>;

/** A restriction on which cards may be buried (discarded) after taking the widow. */
export const BuryRestrictionSchema = z.enum(['no-melded', 'no-trump', 'no-dix']);
export type BuryRestriction = z.infer<typeof BuryRestrictionSchema>;

/**
 * Bury: cards the bid winner discards face-down after absorbing the widow.
 * `size: 0` disables the Bury phase. `restrictions` names cards that may not be
 * buried.
 */
export const BurySchema = z.object({
  size: z.number().int().nonnegative(),
  restrictions: z.array(BuryRestrictionSchema),
});
export type Bury = z.infer<typeof BurySchema>;

/** Dealing: hand size plus the optional widow and bury sub-phases. */
export const DealingSchema = z.object({
  handSize: z.number().int().positive(),
  widow: WidowSchema,
  bury: BurySchema,
});
export type Dealing = z.infer<typeof DealingSchema>;

/**
 * Passing: count of cards passed to a partner and whether the partner passes
 * back. `count: 0` disables the Passing phase.
 */
export const PassingSchema = z.object({
  count: z.number().int().nonnegative(),
  passBack: z.boolean(),
});
export type Passing = z.infer<typeof PassingSchema>;

/**
 * Bidding: the auction parameters. `passBehavior` is how a pass binds (in
 * pinochle a player who passes is out for the hand). `allPassRule` resolves an
 * auction where everyone passes — either the dealer is forced in at the minimum,
 * or the hand is redealt.
 */
export const BiddingSchema = z.object({
  minimumBid: z.number().int().positive(),
  increment: z.number().int().positive(),
  passBehavior: z.enum(['pass-out-for-hand']),
  allPassRule: z.enum(['dealer-forced-minimum', 'redeal']),
});
export type Bidding = z.infer<typeof BiddingSchema>;

/** Melding: who lays down meld, and which meld table values to score it against. */
export const MeldingSchema = z.object({
  whoMelds: z.enum(['all-seats', 'bidder-only']),
  /**
   * Identifier of the meld table to score against. The double-deck table's
   * values are reserved (§3 Ruling 3) — the identifier is accepted here; the
   * values are deferred to a later change.
   */
  meldTableId: z.enum(['standard-single-deck', 'standard-double-deck']),
});
export type Melding = z.infer<typeof MeldingSchema>;

/**
 * Trick rules: the follow/trump/must-beat obligations and how an identical-card
 * tie resolves. Strict pinochle is follow-suit, must-trump-when-void, and
 * must-beat; the first of two identical winning cards takes the trick.
 */
export const TrickRulesSchema = z.object({
  mustFollowSuit: z.boolean(),
  mustTrumpWhenVoid: z.boolean(),
  mustBeat: z.boolean(),
  identicalCardTie: z.enum(['first-played-wins']),
});
export type TrickRules = z.infer<typeof TrickRulesSchema>;

/**
 * The per-rank counter (point) values plus the last-trick bonus. Standard
 * pinochle counts A=11, 10=10, K=4, Q=3, J=2, 9=0 with +10 for the last trick.
 */
export const CounterValuesSchema = z.object({
  A: z.number().int().nonnegative(),
  '10': z.number().int().nonnegative(),
  K: z.number().int().nonnegative(),
  Q: z.number().int().nonnegative(),
  J: z.number().int().nonnegative(),
  '9': z.number().int().nonnegative(),
});
export type CounterValues = z.infer<typeof CounterValuesSchema>;

/**
 * Scoring: how counters are valued, whether meld must be "saved" by taking a
 * trick, how sides score (everyone, or just the bidder against the bid), and the
 * penalty for a set (failed) contract.
 */
export const ScoringSchema = z.object({
  counters: CounterValuesSchema,
  lastTrickBonus: z.number().int().nonnegative(),
  meldNeedsATrick: z.boolean(),
  mode: z.enum(['all-sides-score', 'bidder-vs-bid']),
  setPenalty: z.enum(['minus-bid-and-meld-lost', 'minus-bid']),
});
export type Scoring = z.infer<typeof ScoringSchema>;

/**
 * Match-end condition: race to a target cumulative score, or play a fixed number
 * of deals.
 */
export const MatchEndSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('target-score'), target: z.number().int().positive() }),
  z.object({ mode: z.literal('fixed-deals'), deals: z.number().int().positive() }),
]);
export type MatchEnd = z.infer<typeof MatchEndSchema>;

/**
 * The full Variant Definition: every §3 axis composed into one validated object.
 * `VariantDefinitionSchema.parse` runs at the boundary (casual lobby config,
 * fixture construction); the engine then operates on the plain validated object.
 */
export const VariantDefinitionSchema = z.object({
  /** Stable identifier for the variant (e.g. `single-deck-partners`). */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  deck: DeckSpecSchema,
  seating: SeatingSchema,
  dealing: DealingSchema,
  passing: PassingSchema,
  bidding: BiddingSchema,
  trumpDeclaredBy: z.enum(['bid-winner']),
  melding: MeldingSchema,
  trick: TrickRulesSchema,
  scoring: ScoringSchema,
  matchEnd: MatchEndSchema,
  ratingBasis: z.enum(['team-win-loss', 'individual-placement']),
});

/** The inferred, plain-data type the engine consumes (Zod erased at the boundary). */
export type VariantDefinition = z.infer<typeof VariantDefinitionSchema>;

/** True when the variant has a widow (WidowReveal phase active). */
export function widowEnabled(variant: VariantDefinition): boolean {
  return variant.dealing.widow.size > 0;
}

/** True when the variant buries cards (Bury phase active). */
export function buryEnabled(variant: VariantDefinition): boolean {
  return variant.dealing.bury.size > 0;
}

/** True when the variant passes cards (Passing phase active). */
export function passingEnabled(variant: VariantDefinition): boolean {
  return variant.passing.count > 0;
}
