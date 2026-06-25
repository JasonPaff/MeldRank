# variant-definition

## Purpose

Defines the `VariantDefinition` schema — the full parameter set that configures a pinochle game per "Game Engine — Abstract Model" §3 — as a Zod schema and inferred type living in `@meldrank/shared`, along with the two frozen canonical ranked variants (`SINGLE_DECK_PARTNERS`, `SINGLE_DECK_CUTTHROAT`). It is the single home of game parameterization for both ranked (frozen) and casual (configurable) play, and preserves the engine's zero-runtime-dependency invariant by keeping Zod out of `@meldrank/engine`.

## Requirements

### Requirement: Variant Definition schema

`@meldrank/shared` SHALL export a Zod schema, `VariantDefinitionSchema`, that captures the full parameter set that defines a pinochle game per "Game Engine — Abstract Model" §3, and an inferred TypeScript type `VariantDefinition`. The schema SHALL cover, at minimum, these axes: deck spec, player count, team structure, hand size, widow (size + visibility), bury (size + restrictions), passing (count + pass-back), minimum bid, bid increment, pass behavior, all-pass rule, trump-declared-by, who-melds, meld table identifier, follow/trump/must-beat rules, identical-card tie rule, counter values + last-trick bonus, meld-needs-a-trick flag, scoring mode, set penalty, match-end condition, and rating basis. The schema SHALL be the home of game parameterization for both ranked (frozen instances) and casual (configurable) play.

#### Scenario: A fully specified variant parses

- **WHEN** an object specifying every required axis with valid values is passed to `VariantDefinitionSchema.parse`
- **THEN** parsing succeeds and returns a typed `VariantDefinition`

#### Scenario: An out-of-range or unknown axis value is rejected

- **WHEN** an object with an invalid enum value or out-of-range number for any axis is passed to `VariantDefinitionSchema.safeParse`
- **THEN** `success` is `false` and the issue identifies the offending field

#### Scenario: Bracketed-state axes are optional and gate phases

- **WHEN** a variant sets widow size to 0, bury size to 0, and passing count to 0
- **THEN** the schema accepts it and the resulting definition marks the WidowReveal, Bury, and Passing phases as disabled

### Requirement: Schema lives in shared, not engine

The `VariantDefinitionSchema` and its inferred type SHALL be defined in `@meldrank/shared` and exported from its isomorphic root. `@meldrank/engine` SHALL consume the inferred `VariantDefinition` type only and SHALL NOT import Zod or any runtime dependency, preserving the engine's zero-runtime-dependency invariant.

#### Scenario: Engine imports the type without runtime deps

- **WHEN** `@meldrank/engine` references a `VariantDefinition`
- **THEN** it imports the type from `@meldrank/shared` and the engine package declares no runtime dependencies in its `package.json`

### Requirement: Canonical ranked variants are frozen fixtures

`@meldrank/shared` SHALL export two frozen `VariantDefinition` instances — `SINGLE_DECK_PARTNERS` and `SINGLE_DECK_CUTTHROAT` — that exactly encode the locked canonical ruleset docs. The Partners variant SHALL specify: 48-card deck, 4 players, two opposite partnerships, hand size 12, no widow, no bury, no passing, minimum bid 250, increment 10, pass-out-for-hand, all-pass→dealer-forced-at-minimum, trump declared by bid winner, all seats meld, standard meld table, strict must-beat, identical-card-first-wins, counters 11/10/4/3/2/0 with +10 last trick, meld-needs-a-trick, all-sides-score, set penalty −bid with meld lost, match end at target 1500, team-win/loss rating basis. The Cutthroat variant SHALL specify: 48-card deck, 3 players, no teams, hand size 15, widow size 3 (exposed), bury size 3 (restricted: no melded cards, no trump, no dix), no passing, minimum bid 300, increment 10, pass-out-for-hand, all-pass→redeal, trump declared by bid winner, bidder-only meld, standard meld table, strict must-beat, identical-card-first-wins, the same counters, bidder-vs-bid scoring (defenders score 0), set penalty −bid, match end at fixed 9 deals, individual-placement rating basis.

#### Scenario: Both canonical variants validate against the schema

- **WHEN** `SINGLE_DECK_PARTNERS` and `SINGLE_DECK_CUTTHROAT` are each passed to `VariantDefinitionSchema.parse`
- **THEN** both parse successfully with no errors

#### Scenario: Canonical fixtures match the locked ruleset values

- **WHEN** the encoded values for the Partners and Cutthroat variants are checked against the canonical ruleset docs
- **THEN** every axis matches (e.g. Partners min bid 250 / target 1500 / 4 players / hand size 12; Cutthroat min bid 300 / 9 deals / 3 players / hand size 15 / widow 3)

#### Scenario: Frozen fixtures cannot be mutated

- **WHEN** code attempts to reassign a property of `SINGLE_DECK_PARTNERS` or `SINGLE_DECK_CUTTHROAT`
- **THEN** the attempt has no effect (the objects are deeply frozen) and TypeScript reports the properties as readonly
