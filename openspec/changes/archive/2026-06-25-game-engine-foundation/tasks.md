## 1. Variant Definition schema (`@meldrank/shared`)

- [x] 1.1 Add a `variant/` module to `packages/shared/src` with sub-schemas for each axis group: deck spec, seating/teams, dealing (hand size, widow, bury), passing, bidding (min bid, increment, pass behavior, all-pass rule), trump declaration, melding (who melds, meld table id), trick rules (follow/trump/must-beat, identical-card tie), counters (+ last-trick bonus), meld-needs-a-trick, scoring mode, set penalty, match-end condition, rating basis
- [x] 1.2 Compose the sub-schemas into `VariantDefinitionSchema` and export the inferred `VariantDefinition` type
- [x] 1.3 Reserve the double-deck meld-table slot per §3 Ruling 3 (identifier accepted; values deferred)
- [x] 1.4 Export `VariantDefinitionSchema` and `VariantDefinition` from the `@meldrank/shared` isomorphic root
- [x] 1.5 Unit tests: a fully specified variant parses; invalid enum/out-of-range values are rejected with field-level issues; zeroed widow/bury/passing parse and mark those phases disabled

## 2. Canonical ranked variant fixtures (`@meldrank/shared`)

- [x] 2.1 Author `SINGLE_DECK_PARTNERS` from the locked Partners doc (48-card, 4 players, 2 opposite teams, hand 12, no widow/bury/passing, min bid 250, inc 10, all-pass→dealer-forced-250, all-seats meld, strict must-beat, counters 11/10/4/3/2/0 + last 10, meld-needs-a-trick, all-sides-score, set −bid+meld-lost, target 1500, team-win/loss rating)
- [x] 2.2 Author `SINGLE_DECK_CUTTHROAT` from the locked Auction doc (48-card, 3 players, no teams, hand 15, widow 3 exposed, bury 3 restricted [no melded/trump/dix], no passing, min bid 300, inc 10, all-pass→redeal, bidder-only meld, strict must-beat, same counters, bidder-vs-bid [defenders 0], set −bid, fixed 9 deals, individual-placement rating)
- [x] 2.3 Deep-freeze both fixtures and export them from the `@meldrank/shared` root
- [x] 2.4 Fidelity tests: both fixtures pass `VariantDefinitionSchema.parse`; assert every axis equals the locked-doc value; assert deep-freeze prevents mutation

## 3. Core domain entities (`@meldrank/engine`)

- [x] 3.1 Define `Card` as `{ rank, suit, copyIndex }` with rank/suit union types; add value-equality and identity-key helpers (two `9♦` value-equal but distinct)
- [x] 3.2 Implement `Deck` construction from a deck spec — pure/deterministic, no shuffle; 48-card single-deck produces 2×6 ranks ×4 suits
- [x] 3.3 Define `Seat` with team-membership-or-none; derive seats+teams from a `VariantDefinition` (Partners→4 seats/2 opposite teams; Cutthroat→3 teamless seats)
- [x] 3.4 Define `Hand`, `Bid`, `Contract`, `Meld { type, cards, value, class }`, `Trick`, and `ScorePad` as pure data types with thin constructors/helpers (no rules logic)
- [x] 3.5 Import only the `VariantDefinition` _type_ from `@meldrank/shared`; replace the `isTrump` placeholder; keep engine `package.json` free of runtime dependencies
- [x] 3.6 Unit tests: card copy distinctness/value-equality; 48-card deck composition + determinism; seat/team derivation for both variants; entity constructors round-trip their fields

## 4. Hand-lifecycle state machine (`@meldrank/engine`)

- [x] 4.1 Define the `LifecyclePhase` union of the ten §2 states
- [x] 4.2 Define the legal-transition table (Dealing→Auction→[WidowReveal]→DeclareTrump→[Passing]→Melding→[Bury]→TrickPlay→HandScoring, with TrickPlay self-loop and HandScoring→Dealing|MatchComplete) and an `isLegalTransition` helper
- [x] 4.3 Implement `resolveActivePath(variant)` that removes disabled bracketed phases (WidowReveal/Passing/Bury) for a given `VariantDefinition`
- [x] 4.4 Unit tests: state set equals exactly the ten documented states; documented transitions legal and undocumented ones illegal; HandScoring branches to both Dealing and MatchComplete; Partners path skips widow/passing/bury; Cutthroat path includes widow+bury, skips passing

## 5. Wire-up & validation

- [x] 5.1 Export the engine domain-model and state-machine modules from `@meldrank/engine`'s root; ensure both packages build (`tsc --noEmit`)
- [x] 5.2 Run lint, typecheck, and the full Vitest suite via the validate agent and resolve any findings
- [x] 5.3 Confirm the zero-runtime-deps invariant: assert `@meldrank/engine` `package.json` declares no `dependencies` and imports from shared are type-only
