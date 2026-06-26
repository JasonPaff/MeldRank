## Why

The engine foundation (committed) gave us the domain model and a _structure-only_ hand-lifecycle machine — states, a legal-transition table, and a variant-aware active-path resolver — but nothing that **drives** it. This change adds the first phase drivers, per the locked build order (engine → outward) and "Game Engine — Abstract Model" §5 (Dealer, AuctionManager). It establishes the pure `reduce(state, event)` contract that all three engine consumers (Match Service authority, client optimistic validation, bots) call into and that a replay is a deterministic fold over — the spine every later phase (DeclareTrump, Melding, TrickPlay, scoring) plugs into.

## What Changes

- Add a **pure `reduce(state, event): State` state container** to `@meldrank/engine`. `State` is a **plain, serializable value** (so it folds for replay, filters per seat, and maps to a Colyseus schema — "Match Runtime" §3/§4, "Data Model" §5). `Event` is a closed union of the locked player **intents** (`bid`, `pass`, `declareTrump`, `playCard` — "API Surface" §4) plus **system events** (`deal` carrying the shuffle seed, `timeout`). `reduce` validates an event against the current phase, applies it via the relevant phase module, and advances the lifecycle using the existing transition table. Illegal/out-of-turn events are rejected without mutating state. This change wires only the `Dealing → Auction` slice; later events are accepted by the type but routed to a not-yet-implemented guard.
- Add the **Dealer** (`deal(deckSpec, handSize, widowSize, rng) → { hands, widow }`) per §5. Pure and deterministic given an **injected `rng`** — the engine owns the Fisher–Yates + deal-slice algorithm (so the client verifier reuses it), while the CSPRNG keying, commit–reveal, and seed assembly stay in Match Runtime / Anti-Cheat ("Match Runtime" §8, "Anti-Cheat" §2). Enforces the deal invariant `handSize × players + widowSize === deck size`.
- Add the **AuctionManager** phase module per §5 and both ranked rulesets §4. Tracks the high bid, the still-live seats, and whose turn it is (eldest = seat to the dealer's left, clockwise). A `bid` is legal when the seat is to-act, still live, and `value ≥ floor` (`highBid + increment`, or `minimumBid` when no bid yet); a `pass` puts the seat out for the hand. The auction terminates when one live seat remains, emitting a **won `Bid { seat, value }`** — including the Partners all-pass case where the dealer is forced in at `minimumBid`. Under the redeal all-pass rule (Cutthroat), it instead emits a **`redeal` outcome** that the room acts on by re-dealing with the **same dealer** and a fresh seed (not an engine lifecycle transition — a redeal needs a new commit–reveal round).
- Add the deterministic **`TimeoutMove` for the Auction phase** per "Game Engine — Abstract Model" Ruling 5: a clock expiry where passing is legal resolves to `pass`. (The general lowest-legal-card policy arrives with TrickPlay.)
- Exhaustive Vitest coverage focused on **Single-Deck Partners**, with Cutthroat exercising the widow-size deal split and the redeal outcome. No Zod or any runtime dependency enters `@meldrank/engine`.

## Capabilities

### New Capabilities

- `hand-state-container`: The pure `reduce(state, event)` engine driver — the serializable `State` value, the `Event` union (player intents + system events), event legality/phase-guarding, lifecycle advancement via the existing transition table, and the rejection contract. Wires the `Dealing → Auction` slice in this change.
- `dealer`: The deterministic, seed-injected Dealer that slices a shuffled deck into per-seat hands plus the widow, owning the deal algorithm (Fisher–Yates over an injected `rng`) while leaving entropy/commit–reveal to Match Runtime. Enforces the deal-size invariant.
- `auction-manager`: The auction phase module — bid/pass legality (to-act, live, floor), turn order from the dealer, and termination into a won `Bid` (incl. dealer-forced-at-minimum) or a `redeal` outcome — plus the Auction-phase deterministic timeout (pass).

### Modified Capabilities

<!-- None. This change consumes (does not alter the requirements of) the foundation's game-domain-model and hand-lifecycle-state-machine capabilities. -->

## Impact

- **Code:** `packages/engine/src` — new `state/` (the `reduce` container, `State`/`Event` types), `dealer/`, and `auction/` modules, exported from the engine root; consumes the existing `domain/` (Bid, Seat, Deck, Card) and `lifecycle/` (transition table, `resolveActivePath`) modules and the `VariantDefinition` _type_ from `@meldrank/shared`. New Vitest suites in `@meldrank/engine`.
- **Dependencies:** none added — `@meldrank/engine` stays at zero runtime dependencies (invariant test continues to hold); shared-package imports remain type-only.
- **Downstream:** establishes the `reduce`/`Event`/`State` contract that the next engine changes (DeclareTrump + WidowReveal/Passing/Bury, MeldDetector, LegalPlayValidator + TrickResolver, HandScorer + MatchScorer) extend rather than reshape; gives `apps/match` the authoritative apply function and `apps/web` the optimistic one, though neither app is wired in this change. The injected-`rng` boundary is the seam the Match Runtime provably-fair shuffle plugs into.
- **Design source of truth:** Linear "Game Engine — Abstract Model" (§2/§5, Ruling 5), "Match Runtime — Design v1" (§3/§4/§8), "Anti-Cheat & Moderation — Design v1" (§2), "API Surface & Contracts — Design v1" (§4), "Data Model — Design v1" (§5), and both canonical ranked ruleset docs. No spec-level decisions are introduced here that those locked docs don't already establish.
