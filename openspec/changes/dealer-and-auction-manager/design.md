## Context

The engine foundation gave `@meldrank/engine` its domain model (`Card`, `Deck`, `Seat`, `Hand`, `Bid`/`Contract`, …) and a *structure-only* hand-lifecycle machine (`LifecyclePhase` union, legal-transition table, `resolveActivePath`). Nothing drives that machine yet. This change adds the first two phase drivers — Dealer and AuctionManager — and, with them, the runtime spine they hang on: a pure `reduce(state, event)` state container.

Per "Game Engine — Abstract Model" §5 the engine is "pure functions over state"; per "Technical Architecture" §3 one engine runs in three consumers (Match Service authority, client optimistic validation, bots); per "Data Model" §5 a replay is the ordered intent log + revealed seeds, deterministically rebuilding the match. Together these fix hard constraints: the driver must be a single pure, deterministic, serializable-state function so all three consumers agree and a replay is a clean fold. `@meldrank/engine` stays at **zero runtime dependencies**; the `VariantDefinition` and intent payload types cross from `@meldrank/shared` as types only.

## Goals / Non-Goals

**Goals:**
- A pure `reduce(state, event): State` container with a closed `Event` union (player intents `bid`/`pass`/`declareTrump`/`playCard` + system events `deal`/`timeout`), phase-guarding, and lifecycle advancement via the existing transition table. Only the `Dealing → Auction` slice is driven.
- A deterministic, seed-injected `Dealer` that owns the Fisher–Yates + deal-slice algorithm and enforces the deal-size invariant.
- An `AuctionManager` phase module: turn order from the dealer, bid/pass legality, termination into a won `Bid` (incl. dealer-forced-at-minimum) or a `redeal` outcome, plus the Auction-phase deterministic timeout (pass).
- `State` as a plain serializable value with public/private separation, so replay-fold, per-seat filtering, and Colyseus-schema mapping are mechanical.
- Exhaustive Vitest coverage centred on Single-Deck Partners; Cutthroat exercises the widow split and the redeal outcome.

**Non-Goals:**
- `DeclareTrump`, `WidowReveal`, `Passing`, `Melding`, `Bury`, `TrickPlay`, `HandScoring`, `MatchComplete` phase logic — accepted by the `Event` type, rejected by the guard until later changes.
- The CSPRNG, commit–reveal, seed assembly, and per-seat view *filtering* — owned by Match Runtime / Anti-Cheat. The engine only exposes the injected-`rng` seam and structures state so filtering is trivial.
- Bot bidding strategy ("Bots & AI" — bots merely emit intents `reduce` validates); move clocks (Match Runtime owns the clock, the engine owns only the deterministic forced move).
- Any `apps/*` wiring or Colyseus schema definition.

## Decisions

**1. The engine's public contract is a single `reduce(state, event)`, not a per-phase function toolkit.**
Replay-as-a-single-fold ("Data Model" §5) and "one entry point, three consumers" ("Technical Architecture" §3) make a single reducer the safest surface: the Match Service, the client, and the replay reconstructor all call the identical function, so they cannot diverge. Per-phase logic still lives in **internal pure modules** (`dealer`, `auction`) that `reduce` delegates to and that are unit-tested directly — so the toolkit benefit (isolated, exhaustive tests) is kept without exposing a composition seam that each consumer would have to re-implement identically. *Alternative considered:* expose `deal()`, `auctionReduce()`, … as the public surface with a thin interpreter — rejected, because the interpreter would still have to be shared to keep replay/client parity, so it belongs inside the engine anyway; one public `reduce` is the simpler equivalent.

**2. `Event` is a union of player intents *and* system events; dealing is seed-driven, not intent-driven.**
The four locked wire intents ("API Surface" §4) are player actions, but two state transitions have no player intent: the deal (driven by a shuffle **seed**, which the replay log stores separately from intents) and a clock **timeout**. Modelling these as system events keeps `reduce` total over everything that mutates a hand, so the replay fold needs no side channel beyond `(intents ∪ seeds)`. *Alternative:* a synthetic "deal intent" — rejected, it would conflate player actions with system-injected entropy and muddy the intent log.

**3. The Dealer owns the shuffle *algorithm*; the entropy is injected.**
"Game Engine — Abstract Model" §5 gives the Dealer signature `(…, rng)`, and the client-side fair-deal verifier ("Anti-Cheat" §2) must reproduce the exact permutation — so the Fisher–Yates and the byte→index consumption must be the one shared implementation in the engine. But a CSPRNG needs crypto, which the zero-dep engine cannot hold, and the commit–reveal entropy is Match Runtime's. Resolution: the engine takes an injected `rng` (a deterministic numeric/byte source) and runs the pure shuffle; Match Runtime keys the CSPRNG from the combined seed and supplies it. *Alternative:* Match Runtime does Fisher–Yates and hands the engine an ordered deck — rejected, it splits the verifiable shuffle across two codebases and breaks "one engine, three consumers" for the deal.

**4. Redeal is an auction *outcome*, not a lifecycle transition.**
Cutthroat all-pass redeals "by the same dealer," which requires a fresh commit–reveal round — impossible inside the pure engine. So `AuctionManager` emits a `redeal` outcome and the room restarts the hand (same dealer, new seed); the lifecycle transition table is left untouched (it has no `Auction → Dealing` edge, matching §2). The Partners all-pass case is different — "dealer forced at the minimum" is just a won `Bid { seat: dealer, value: minimumBid }` that flows onward normally. *Alternative:* add an `Auction → Dealing` redeal edge — rejected as dishonest to the §2 machine and unworkable given the engine cannot mint a new seed.

**5. `State` is a plain serializable value with explicit public/private regions.**
It must fold (replay), filter (per-seat views), and map to a Colyseus schema, so no class instances/methods, and — at the serialization boundary — JSON-round-trippable structures (avoid `Map`/`Set` leaking into `State`). Private regions (each seat's hand, the unrevealed widow) are kept structurally distinct from public regions (phase, turn, auction standing, recorded `Bid`) so Match Runtime's filtering is a mechanical projection, not a bespoke walk. The engine does not filter; it only makes filtering trivial.

**6. Rejection is non-mutating and uniform.**
An illegal/out-of-turn/out-of-phase event returns the state unchanged (a typed rejection rather than a thrown exception on the hot path), matching Match Runtime's "validate every intent… an illegal intent never mutates state" (§2). This keeps the optimistic client and the authoritative server reconciling on identical rules.

## Risks / Trade-offs

- **[The `State`/`Event` shape ossifies early and later phases need to reshape it]** → This change deliberately wires only `Dealing → Auction` but designs `Event` as the *full* locked union and `State` with the public/private split all phases need, so later changes *extend* (add phase sub-state, implement a guard branch) rather than reshape. The reducer is data-driven off the existing transition table, so adding a phase is additive.
- **[Injected-`rng` contract drifts from what Match Runtime's CSPRNG provides]** → Fix the `rng` interface (the numeric/byte source shape and how Fisher–Yates consumes it) in this change and cover it with determinism tests; Match Runtime adapts its CSPRNG to that interface. The verifier reuses the same engine code, so drift surfaces as a failing reproduce test.
- **[Serialization-unsafe values sneak into `State` (e.g. a `Set` of live seats)]** → A round-trip test asserts `State` survives JSON; the live-seat set is represented as a serializable structure (e.g. an ordered seat list / boolean-per-seat), not a `Set`, at the `State` boundary.
- **[Auction edge cases diverge from the locked rulesets]** → The legality, termination, all-pass (both rules), and timeout scenarios are pinned to the canonical ruleset §4 values (Partners min 250 / dealer-forced; Cutthroat min 300 / redeal) as executable tests; any rules change requires a doc version bump plus a deliberate test update.
- **[Zero-dep invariant silently broken]** → The existing invariant test (no runtime `dependencies`, type-only `@meldrank/shared` imports) continues to guard the new modules; the injected-`rng` decision is precisely what keeps crypto out of the engine.
