## 1. State container & event union (`@meldrank/engine`)

- [ ] 1.1 Add a `state/` module with the `Event` union: player intents `bid` / `pass` / `declareTrump` / `playCard` and system events `deal` (carrying the seed) / `timeout`; consume intent payload *types* from `@meldrank/shared` as type-only imports (no Zod, no runtime dep)
- [ ] 1.2 Define the `State` type as a plain, JSON-round-trippable value with explicit public regions (phase marker, seat-to-act, auction standing, recorded winning `Bid`) and per-seat private regions (each seat's `Hand`, the unrevealed widow); represent the live-seat set as a serializable structure (ordered list / per-seat flags), not a `Set`
- [ ] 1.3 Implement `reduce(state, event): State` as a pure, non-mutating, deterministic function that phase-guards each event and returns the state unchanged (typed rejection, no throw on the hot path) when the event is illegal for the current phase
- [ ] 1.4 Wire lifecycle advancement through the foundation's transition table + `resolveActivePath` (skip variant-disabled bracketed phases); never advance along an illegal transition
- [ ] 1.5 Route `declareTrump` / `playCard` to a not-yet-implemented phase guard (accepted by type, rejected at runtime) so the wired slice is exactly `Dealing → Auction`
- [ ] 1.6 Unit tests: `reduce` does not mutate input; `State` survives JSON round-trip; the event-kind set equals exactly the six documented kinds; a `bid` during `Dealing` is rejected with state unchanged; a later-phase event is rejected by the guard

## 2. Dealer (`@meldrank/engine`)

- [ ] 2.1 Add a `dealer/` module: `deal(deckSpec, handSize, widowSize, rng) → { hands, widow }` — pure Fisher–Yates over the injected `rng` plus the deal slice into one `Hand` per seat and the widow; define the `rng` source interface (numeric/byte source + how Fisher–Yates consumes it)
- [ ] 2.2 Enforce the deal-size invariant `handSize × playerCount + widowSize === deck size`; reject a violating configuration rather than dealing
- [ ] 2.3 Unit tests: same seed → identical deal; different seeds → different deals; Partners deals 4×12 with empty widow; Cutthroat deals 3×15 with a 3-card widow; a size mismatch is rejected; hands ∪ widow equals the built deck as a multiset (no loss/duplication)

## 3. AuctionManager (`@meldrank/engine`)

- [ ] 3.1 Add an `auction/` module holding the auction sub-state (high bid, live seats, seat-to-act) and an initializer that opens the turn at the seat left of the dealer, clockwise, over live seats only
- [ ] 3.2 Implement `bid` legality: seat is to-act ∧ still live ∧ value ≥ floor (`highBid + increment`, else `minimumBid`) ∧ value aligned to the increment grid (`minimumBid + k × increment`); a legal bid becomes the high bid and advances the turn; illegal bids are rejected without change
- [ ] 3.3 Implement `pass` as out-for-hand (remove from live set, advance turn to next live seat); reject any later bid from a passed seat
- [ ] 3.4 Implement termination: when one live seat remains, conclude with a won `Bid { seat, value }`
- [ ] 3.5 Implement all-pass resolution by `allPassRule`: `dealer-forced-minimum` → won `Bid { seat: dealerSeat, value: minimumBid }`; `redeal` → a `redeal` outcome carrying no contract (room re-deals, same dealer, fresh seed)
- [ ] 3.6 Implement the Auction-phase deterministic `TimeoutMove` (Ruling 5): a `timeout` for the seat to act resolves to a `pass`
- [ ] 3.7 Integrate the auction module into `reduce`: `bid` / `pass` / `timeout` during `Auction` drive the sub-state; on conclusion record the won `Bid` on `State` and advance the phase, or surface the `redeal` outcome
- [ ] 3.8 Unit tests (Partners-focused): turn opens left of dealer; bid at floor accepted; below-floor, off-grid, out-of-turn, and passed-seat bids rejected; last-seat-standing wins at the high bid; Partners all-pass forces the dealer in at 250; Cutthroat all-pass yields a `redeal`; timeout during the auction passes the seat and advances the turn

## 4. Wire-up & validation

- [ ] 4.1 Export the `state`, `dealer`, and `auction` public surface (`reduce`, `State`, `Event`, `deal`) from `@meldrank/engine`'s root
- [ ] 4.2 Add a `Dealing → Auction` integration test: a `deal` event populates hands + widow and advances to `Auction`; a full Partners auction (bids + passes) folds to a recorded winning `Bid` and the `DeclareTrump` phase marker; folding the same event log twice is deep-equal (replay determinism)
- [ ] 4.3 Confirm the zero-runtime-deps invariant still holds (engine `package.json` has no `dependencies`; `@meldrank/shared` imports are type-only) — the existing invariant test must stay green
- [ ] 4.4 Run lint, typecheck, and the full Vitest suite via the validate agent and resolve any findings
