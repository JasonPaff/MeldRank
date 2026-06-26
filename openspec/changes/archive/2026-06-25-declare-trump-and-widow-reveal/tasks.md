## 1. State shape — declared trump & revealed widow (`@meldrank/engine`)

- [x] 1.1 Extend `PublicState` (`state/state.ts`) with `trump: Suit | null` (the declared trump, public) and `revealedWidow: readonly Card[]` (the exposed widow once revealed); keep `contract: Bid | null` as the won bid (design D1)
- [x] 1.2 Initialize the new fields in `createInitialState` (`trump: null`, `revealedWidow: []`) and confirm `State` stays plain and JSON-round-trippable (no `Map`/`Set`, no behavior)
- [x] 1.3 Add a `getContract(state): Contract | null` selector that returns `makeContract(contract.seatIndex, contract.value, trump)` once both the won bid and trump are present, else `null`

## 2. WidowReveal transition (`@meldrank/engine`)

- [x] 2.1 Add a `widow/` module: a pure function that, given the state at auction conclusion and the contract-winning seat, returns the post-reveal hands + emptied widow + recorded `revealedWidow` (moves widow cards into the winner's `Hand`)
- [x] 2.2 Integrate into the auction-won path in `reduce` (`applyAuctionStep` 'won'): when the variant's next active phase is `WidowReveal`, perform the reveal and continue advancing through `WidowReveal → DeclareTrump`, honoring each transition-table hop and resting at `DeclareTrump`; no-widow variants advance `Auction → DeclareTrump` unchanged
- [x] 2.3 Unit tests: Cutthroat reveal grows the winner's hand 15→18 and empties the widow; `revealedWidow` is recorded publicly; hands ∪ widow stays a faithful multiset of the dealt cards; Partners performs no reveal and advances straight to `DeclareTrump`

## 3. DeclareTrump phase driver (`@meldrank/engine`)

- [x] 3.1 Add a `declare/` module: a pure function returning a step/result for a `declareTrump` — legal iff phase is `DeclareTrump`, `seat === contract.seatIndex`, and `trump` is one of the active deck's suits (no must-hold-trump rule, per design D3); reject otherwise
- [x] 3.2 Integrate into `reduce`: add the `DeclareTrump` case routing `declareTrump` to the declare module; on a legal declaration record `public.trump` and advance to the variant's next active phase (`Melding`); reject illegal declarations with state unchanged
- [x] 3.3 Route `playCard` (and any `Melding`-and-later event) to the not-yet-implemented guard so the wired slice is exactly `Dealing → … → DeclareTrump → (ready for Melding)`
- [x] 3.4 Unit tests: contract winner declaring a valid suit records trump and advances to `Melding`; non-winner, unknown-suit, and out-of-phase declarations are rejected with state unchanged

## 4. Wire-up & validation

- [x] 4.1 Export the `declare` and `widow` public surface plus the `getContract` selector from `@meldrank/engine`'s root
- [x] 4.2 Extend the integration test: a full Partners hand folds `deal → (auction) → declareTrump` to a recorded trump and the `Melding` phase marker; a Cutthroat hand folds through the widow reveal to `DeclareTrump`, then `declareTrump` to `Melding`; folding each event log twice is deep-equal (replay determinism)
- [x] 4.3 Confirm the zero-runtime-deps invariant still holds (engine `package.json` has no `dependencies`; `@meldrank/shared` imports remain type-only) — the existing invariant test must stay green
- [x] 4.4 Run lint, typecheck, and the full Vitest suite via the validate agent and resolve any findings
