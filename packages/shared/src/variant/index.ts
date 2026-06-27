/**
 * Variant Definition surface: the Zod schema that parameterizes a pinochle game,
 * its inferred type and axis sub-types, the phase-gating predicates, and the two
 * frozen canonical ranked fixtures.
 */
export {
  RankSchema,
  SuitSchema,
  DeckSpecSchema,
  TeamStructureSchema,
  SeatingSchema,
  WidowSchema,
  BuryRestrictionSchema,
  BurySchema,
  DealingSchema,
  PassingSchema,
  BiddingSchema,
  MeldingSchema,
  TrickRulesSchema,
  CounterValuesSchema,
  ScoringSchema,
  MatchEndSchema,
  VariantDefinitionSchema,
  widowEnabled,
  buryEnabled,
  passingEnabled,
  type Rank,
  type Suit,
  type DeckSpec,
  type TeamStructure,
  type Seating,
  type Widow,
  type BuryRestriction,
  type Bury,
  type Dealing,
  type Passing,
  type Bidding,
  type Melding,
  type TrickRules,
  type CounterValues,
  type Scoring,
  type MatchEnd,
  type VariantDefinition,
} from './schema';

export { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT } from './canonical';

/** Stable canonical-JSON content hash of a variant — the `matches.variant_hash` producer (design D4). */
export { canonicalJson, hashVariant } from './hash';

/**
 * The Standard meld table: the canonical Class A/B/C meld definitions and point
 * values (plus double bonuses) resolved from `melding.meldTableId`. Plain,
 * Zod-free data the engine reads via `@meldrank/shared/meld` without a runtime dep.
 */
export {
  STANDARD_SINGLE_DECK_MELD_TABLE,
  getMeldTable,
  type MeldTableId,
  type MeldTableClass,
  type MeldCardPattern,
  type MeldPattern,
  type MeldDefinition,
  type MeldTable,
} from './meld-table';
