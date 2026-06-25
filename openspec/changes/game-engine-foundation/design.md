## Context

The Game Engine is the next change in the locked build order (scaffold → infra → **engine** → outward). `packages/engine` and `packages/shared` are scaffold stubs (`isTrump`, `HealthSchema`). Per "Game Engine — Abstract Model" (Accepted v1.0), the product is **one engine driven by a Variant Definition**, not N game implementations — ranked is two frozen Variant Definitions, casual is the same schema exposed as configurable. This change builds the *substrate* (schema, domain types, state-machine structure, canonical fixtures) that the four later engine changes — Dealer+Auction, MeldDetector, LegalPlayValidator+TrickResolver, HandScorer+MatchScorer+TimeoutMove — are all written against. No rules logic is implemented here.

Hard constraints from the locked stack: `@meldrank/engine` carries **zero runtime dependencies** (it runs unchanged in the web client, the Colyseus Match Service, and bot workers); Zod and other validation live in `@meldrank/shared`; TypeScript strict; exhaustive Vitest coverage.

## Goals / Non-Goals

**Goals:**
- A `VariantDefinitionSchema` (Zod) in `@meldrank/shared` covering every §3 axis, with an inferred `VariantDefinition` type consumed by the engine.
- Core engine domain entities (§4) as pure, dependency-free data types with thin constructors/helpers.
- The §2 hand-lifecycle states and a legal-transition table, with bracketed phases gated by the variant — structure only.
- The two canonical ranked rulesets encoded as deeply-frozen `VariantDefinition` fixtures that validate against the schema and exactly match the locked docs.
- Exhaustive unit tests proving deck composition, fixture↔doc fidelity, schema accept/reject, and transition legality.

**Non-Goals:**
- Any phase logic: dealing/shuffle, auction resolution, meld detection, legal-play validation, trick resolution, scoring, timeout moves. All deferred to later changes.
- The double-deck meld table values (schema slot reserved; §3 Ruling 3 defers the values).
- Realtime/online concerns (clocks, reconnection, hidden-info filtering, provably-fair shuffle) — owned by Match Runtime / Anti-Cheat, explicitly out of engine scope.
- Any `apps/*` wiring.

## Decisions

**1. Variant Definition schema lives in `@meldrank/shared`, the inferred type crosses into the engine.**
The engine must stay zero-dep, so Zod cannot live there. `@meldrank/shared` already owns Zod and is the designated home for the Variant Definition schema (Technical Architecture §7). The engine imports only the inferred `VariantDefinition` *type* (erased at build), preserving the invariant. *Alternative considered:* define the schema in the engine and re-export — rejected, it would pull Zod into the zero-dep package.

**2. Validation at the boundary, plain data inside.**
`VariantDefinitionSchema.parse` runs where variants enter the system (casual lobby config, fixture construction); the engine then operates on the validated plain object. The engine never re-validates at runtime. This keeps the hot path allocation-free and the engine framework-free. *Alternative:* engine guards on every call — rejected as redundant and dependency-inducing.

**3. Lifecycle states as a string-literal union + an explicit transition table; gating derived from the variant.**
A `LifecyclePhase` union plus a data-driven adjacency table (`Map`/record of phase → legal next phases) is the smallest thing that encodes §2 and is trivially testable. A `resolveActivePath(variant)` helper removes disabled bracketed phases (`WidowReveal`/`Passing`/`Bury`) so callers see the variant-specific sequence. *Alternative:* a full statechart library — rejected, it's a runtime dependency and overkill for a structure-only change.

**4. Canonical variants as deeply-frozen, hand-authored fixtures + a fidelity test.**
`SINGLE_DECK_PARTNERS` and `SINGLE_DECK_CUTTHROAT` are authored once in `@meldrank/shared`, `Object.freeze`d deeply, and exported. A dedicated test asserts each parses cleanly *and* that each axis equals the value in the locked ruleset doc (min bid, target/deals, players, hand size, widow, bury, scoring mode, rating basis…). This makes the fixtures the executable contract against the design docs. *Alternative:* generate variants programmatically — rejected, explicit literals are clearer and catch doc drift directly.

**5. `copyIndex` on every Card; identity vs. value separated.**
Pinochle has two physical copies of each card. Per §4 a `Card` is `{ rank, suit, copyIndex }`; value-equality (rank+suit) and identity/key (rank+suit+copyIndex) are distinct helpers. This is load-bearing for later meld and must-beat logic and is fixed now so all later modules share one representation.

## Risks / Trade-offs

- **[Schema under-models an axis a later change needs]** → The two canonical fixtures exercise the schema across both the partnership/all-score and free-for-all/bidder-vs-bid extremes, surfacing gaps now; the schema is additive, so later changes can extend axes without breaking these fixtures.
- **[Fixtures drift from the locked docs over time]** → The fidelity test pins every axis to the documented value; any doc change forces a deliberate fixture + test update (and the docs themselves require a version bump to change).
- **[Zero-dep invariant silently broken]** → A test/CI assertion that `@meldrank/engine`'s `package.json` declares no runtime `dependencies`, plus type-only imports from `@meldrank/shared`, guards it.
- **[Over-designing structure ahead of logic]** → Scope is deliberately types + transition table + fixtures only; no phase bodies. The state machine is data, not behavior, so later changes fill in modules without reshaping it.
