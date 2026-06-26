## 1. TimeoutMove module (`src/timeout/`)

- [x] 1.1 Create `packages/engine/src/timeout/timeout.ts` with a pure `TimeoutMove(state: State) → PlayerIntent | null` (D1), consuming only plain values and the `PlayerIntent`/`VariantDefinition` types (no runtime deps); return `null` when `state.public.seatToAct` is `null`.
- [x] 1.2 Implement the Ruling 5 dispatch (D2): `Auction` → a `pass` intent for the seat-to-act; `TrickPlay` → a `playCard` intent for the lowest-value legal card (task 1.3); every other phase → `null`.
- [x] 1.3 Implement lowest-value legal-card selection (D3): take the `LegalPlayValidator(hand, currentTrick, trump, variant.trick)` set and pick the minimum by card value (locked rank order `A > 10 > K > Q > J > 9`, lowest = weakest), then suit (index in `variant.deck.suits`), then `copyIndex`. Add/reuse a small rank-value helper rather than duplicating the `play/strength.ts` ordinal table.
- [x] 1.4 Add `packages/engine/src/timeout/index.ts` re-exporting `TimeoutMove`; wire it into `packages/engine/src/index.ts`.

## 2. Centralized timeout resolution in `reduce`

- [x] 2.1 In `src/state/reduce.ts`, add the pre-dispatch `timeout` branch (D4): if `event.type === 'timeout'`, compute `forced = event.seat === state.public.seatToAct ? TimeoutMove(state) : null` and return `forced === null ? state : reduce(state, forced)`.
- [x] 2.2 Remove the inline `'timeout'` case from `applyAuctionEvent` so the forced `pass` arrives as a normal `pass` intent (single resolution point); confirm the auction-timeout outcome is unchanged.
- [x] 2.3 Update the `reduce` doc comment to describe timeout resolution via `TimeoutMove` (replacing the auction-only description).

## 3. Tests

- [x] 3.1 Unit-test `TimeoutMove` purity/determinism (input unmutated, deep-equal on repeat) and the `null` cases (`seatToAct === null`; `DeclareTrump`).
- [x] 3.2 Unit-test the `Auction` arm: returns a `pass` for the seat-to-act.
- [x] 3.3 Unit-test the `TrickPlay` arm: leader plays the lowest-rank card; following-suit / must-beat restricts the pick to the legal subset; the suit-then-`copyIndex` tiebreak resolves equal-rank cards deterministically; the chosen card is always in the `LegalPlayValidator` set.
- [x] 3.4 `reduce` tests: a `timeout` for the seat-to-act during `Auction` passes the seat (same result as a `pass` intent) and during `TrickPlay` plays the forced legal card; a `timeout` for a non-acting seat and a `timeout` during `DeclareTrump` are no-ops; folding a log containing `timeout` events twice is deep-equal (deterministic replay).

## 4. Validate

- [x] 4.1 Run lint, typecheck, and tests via the validate agent and resolve any findings.
