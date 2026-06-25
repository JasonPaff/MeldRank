## Why

The Game Engine is the next step in the locked build order (scaffold → infra → **engine** → outward) and is the highest-leverage, lowest-risk place to start: per the locked Linear doc "Game Engine — Abstract Model" (Accepted v1.0), "correctness here *is* the product's integrity," and the same engine runs unchanged in the client, Match Service, and bots. Today `packages/engine` and `packages/shared` are stubs. This change lays the engine's foundation — the data model everything else is written against — without yet implementing rules logic, so later engine changes (Dealer/Auction, MeldDetector, LegalPlayValidator, scorers) have a typed, validated substrate to build on.

## What Changes

- Add the **Variant Definition schema** (Zod) to `@meldrank/shared` — the full parameter set that *is* a game (deck, players, teams, hand size, widow, bury, passing, bidding rules, trump declaration, who melds, meld table, trick/follow rules, counters, scoring mode, set penalty, match-end condition, rating basis), per "Game Engine — Abstract Model" §3. This is the keystone that drives one engine across many variants (ranked = frozen Variant Definitions; casual = the same schema exposed as configurable).
- Add the **core domain entities** to `@meldrank/engine` per §4: `Card { rank, suit, copyIndex }`, `Deck`, `Seat` (with team membership or none), `Hand`, `Bid`/`Contract`, `Meld { type, cards, value, class }`, `Trick`, `ScorePad`. Pure data + constructors/helpers only — no rules logic.
- Add the **hand-lifecycle state machine scaffold** per §2: the states (`Dealing → Auction → [WidowReveal] → DeclareTrump → [Passing] → Melding → [Bury] → TrickPlay → HandScoring → MatchComplete`) and the legal transitions between them, with bracketed states gated on/off by a Variant Definition. Types and transition table only; the module bodies that *drive* each phase (Dealer, AuctionManager, MeldDetector, …) arrive in later changes.
- Encode the **two canonical ranked rulesets as frozen Variant Definition fixtures** (Single-Deck Partners; Single-Deck Cutthroat / Auction Pinochle), each validating against the schema. These double as the first proof the schema generalizes and as fixtures for every later engine change.
- Replace the placeholder exports (`isTrump`, `HealthSchema`) with the real foundation surface; keep `@meldrank/engine` at **zero runtime dependencies** and Zod confined to `@meldrank/shared`.

## Capabilities

### New Capabilities
- `variant-definition`: The Zod schema (in `@meldrank/shared`) that parameterizes a pinochle game, plus the two frozen canonical ranked Variant Definitions and their validation rules.
- `game-domain-model`: The core engine domain entities (Card, Deck, Seat, Hand, Bid/Contract, Meld, Trick, ScorePad) and the deck-spec → deck construction, as pure dependency-free TypeScript.
- `hand-lifecycle-state-machine`: The hand-lifecycle states and legal-transition table, with optional states gated by a Variant Definition — structure only, no phase logic.

### Modified Capabilities
<!-- None. The engine and shared packages currently contain only scaffold placeholders, not specified behavior. -->

## Impact

- **Code:** `packages/shared/src` (new Variant Definition schema + canonical fixtures, exported from the isomorphic root); `packages/engine/src` (new domain-model and state-machine modules, replacing the `isTrump` placeholder). New Vitest suites in both packages.
- **Dependencies:** none added to `@meldrank/engine` (zero-runtime-deps invariant preserved); `@meldrank/shared` continues to use its existing Zod dependency.
- **Downstream:** unblocks the next ~4 engine changes (Dealer+Auction, MeldDetector, LegalPlayValidator+TrickResolver, HandScorer+MatchScorer+TimeoutMove). `apps/*` consume the Variant Definition type from `@meldrank/shared` but require no changes in this change.
- **Design source of truth:** Linear docs "Game Engine — Abstract Model" (Accepted v1.0), "Ranked Ruleset — Single-Deck Partners (Canonical)", and "Ranked Ruleset — Single-Deck Cutthroat / Auction Pinochle (Canonical)". No spec-level decisions are introduced here that those docs don't already lock.
