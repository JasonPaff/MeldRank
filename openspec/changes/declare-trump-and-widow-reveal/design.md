## Context

`dealer-and-auction-manager` (archived) established the pure `reduce(state, event): State` container, the closed `Event` union, the `Dealer`, and the `AuctionManager`, and wired exactly `Dealing → Auction`. The auction concludes by recording a won `Bid` on `state.public.contract` and advancing to the variant's next active phase via `resolveActivePath` + the transition table — `DeclareTrump` for Partners, `WidowReveal` for Cutthroat. There the lifecycle currently rests: `declareTrump` and `playCard` are in the union but rejected by the default phase guard, and `WidowReveal` has no driver.

This change drives the **contract-completion** stretch — `Auction → [WidowReveal] → DeclareTrump → (ready for Melding)` — so the next change (MeldDetector) has a declared trump to compute against. Constraints carried in from the foundation: `reduce` stays pure/total/deterministic with typed rejection (no throw on the hot path); `State` stays plain and JSON-round-trippable with public/private separation; `@meldrank/engine` stays at zero runtime dependencies (`@meldrank/shared` imported type-only); the `Event` union is **closed** and tied to the locked "API Surface" §4 intents plus `deal`/`timeout`.

The relevant domain types already exist: `DeclareTrumpIntent { seat, trump }` (shared), and `Contract { seatIndex, value, trump }` + `makeContract` (engine domain). Both canonical variants set `trumpDeclaredBy: 'bid-winner'`; Cutthroat's widow is `{ size: 3, visibility: 'exposed' }`, Partners' is `{ size: 0 }`.

## Goals / Non-Goals

**Goals:**

- Drive `declareTrump` during `DeclareTrump`: legal only for the contract winner, with a real suit; record the declared trump on `State`; advance to the next active phase (`Melding`).
- Drive the automatic `WidowReveal` transition for widow variants without adding to the closed `Event` union: expose the widow publicly and fold it into the bidder's hand.
- Extend the wired slice to settle at "ready for `Melding`"; keep `Melding` / `playCard` rejected.
- Exhaustive Vitest coverage (Partners-focused; Cutthroat for the widow path). Preserve every foundation invariant (purity, JSON round-trip, replay determinism, zero deps).

**Non-Goals:**

- `Melding`, `Bury`, `Passing`, `TrickPlay`, and scoring — later changes. (`Passing` is disabled by both ranked variants regardless.)
- A deterministic forced move (`TimeoutMove`) for `DeclareTrump` — Ruling 5 defines a default only where passing is legal or a card is played; a trump-declaration default belongs with the broader timeout policy that lands alongside TrickPlay. See Open Questions.
- Any Zod schema for `declareTrump`, and any `apps/match` / `apps/web` wiring.

## Decisions

### D1 — Record the declared trump as a new `public.trump: Suit | null`, leaving `public.contract` the won `Bid`

`reduce`'s auction-won step records a `Bid` (seat + value) on `public.contract`. On a legal `declareTrump`, set a new public field `trump: Suit | null` rather than mutating `contract`. The full `Contract { seatIndex, value, trump }` is the pair `(public.contract, public.trump)`; downstream consumers (MeldDetector, scorers) assemble it (a small `getContract(state)` selector can return `makeContract(...)` once both are present).

- **Why:** purely additive to `PublicState`, filter-friendly (public, never per-seat), and it avoids a `Bid | Contract` union whose members differ only by an optional `trump` (awkward to discriminate). It also keeps the auction's output type stable.
- **Alternative considered:** promote `public.contract` to `Contract | null`, set only after declaration, holding the interim won bid elsewhere (e.g. in the auction sub-state or a `wonBid` field). Rejected as more churn for the same information; the domain `Contract` type still gets used at the consumer boundary. Reversible — flagged for ruling.

### D2 — `WidowReveal` is a deterministic _transient_ transition, not a resting phase

The closed `Event` union has no intent or system event that targets `WidowReveal`, so the engine cannot _rest_ there and wait to be advanced. On auction conclusion, when the next active phase is `WidowReveal`, `reduce` performs the reveal in the same step and continues advancing to `DeclareTrump`:

- move the `private.widow` cards into the bidder's `Hand` (the seat in `public.contract`), emptying `private.widow`;
- record the revealed cards in a new public field `revealedWidow: readonly Card[]` (the canonical widow is `exposed`, so all seats — and the replay — must see what the bidder received);
- advance `Auction → WidowReveal → DeclareTrump`, honoring each hop in the transition table; the resting phase is `DeclareTrump`.

- **Why:** keeps `reduce` total over the _closed_ union and fully deterministic/auditable; the rules-relevant fact (the exposed widow) lands in public state, so Match Runtime can animate the reveal as a distinct beat (detecting `revealedWidow` set with `trump` still null) without the engine needing a bespoke event.
- **Alternatives considered:** (a) add a system `revealWidow` event so the engine rests at `WidowReveal` — rejected: expands the locked union for a step with no decision in it. (b) make `declareTrump` legal in `WidowReveal` too for widow variants — rejected: conflates two phases and breaks phase-guard clarity.

### D3 — `declareTrump` legality: contract winner + real suit, no holding requirement

A `declareTrump` is legal iff `phase === 'DeclareTrump'`, `event.seat === public.contract.seatIndex`, and `event.trump` is one of the active deck's suits. A legal declaration sets `public.trump` and advances to the next active phase. Out-of-turn (non-winner) seats, declarations in any other phase, and unknown suits are rejected with state unchanged.

- **Why:** both canonical rulesets specify only "bid winner names trump"; neither requires the bidder to hold a card in the named suit. A "must hold trump" rule, if a future variant wants it, is a Variant Definition axis, not engine-hardcoded.

### D4 — Module layout mirrors `auction/` and `dealer/`

Add `packages/engine/src/declare/` and `packages/engine/src/widow/`, each a small pure module exposing a function the reducer folds (mirroring `AuctionStep` / `applyAuctionStep`). `reduce` gains a `DeclareTrump` case routing to the declare module, and the auction-won path routes through the widow module when the variant enables `WidowReveal`. Export the public surface from the engine root.

## Risks / Trade-offs

- **`WidowReveal` is never the resting phase marker** → A consumer that keys purely off `phase` won't see `WidowReveal`. Mitigation: the reveal is recorded in `public.revealedWidow`, so the beat is reconstructable from state and replay; document that widow-variant runtimes render the reveal from that field, not from a resting phase.
- **Split contract (`contract` + `trump`)** → Two reads needed for a full `Contract`, and a consumer could read `trump` before it's set. Mitigation: `trump` is explicitly `Suit | null`; provide/agree a `getContract` selector that returns `null` until trump is declared.
- **No `DeclareTrump` timeout policy** → A `timeout` during `DeclareTrump` has no defined forced move in this slice and is rejected (no-op). Mitigation: the Match Runtime does not emit a timeout it cannot resolve in this slice; the policy lands with the TrickPlay timeout work. Tracked in Open Questions.

## Open Questions

- **Trump storage shape (D1):** keep the additive `public.trump` field (recommended, reversible), or promote `public.contract` to the domain `Contract` type? Defaulting to the additive field; open to a ruling.
- **`DeclareTrump` forced move:** what deterministic default should a clock expiry pick when declaring trump (e.g. the bidder's longest/strongest suit)? Deferred to the broader `TimeoutMove` work alongside TrickPlay; flagged here so it isn't lost.
