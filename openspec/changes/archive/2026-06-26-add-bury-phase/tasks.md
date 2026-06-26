## 1. The `bury` intent (`@meldrank/shared`)

- [x] 1.1 Add `BuryIntent { type: 'bury', seat, cards: readonly CardRef[] }` to `packages/shared/src/intent/types.ts` and include it in the `PlayerIntent` union and `PlayerIntentKind` (D1); update the doc comment listing the locked intents.
- [x] 1.2 Export `BuryIntent` from the intent barrel (`packages/shared/src/intent/index.ts`).
- [x] 1.3 Add `'bury'` to the engine `Event` union and `EVENT_KINDS` in `packages/engine/src/state/events.ts`, keeping the compile-time exhaustiveness guard satisfied.

## 2. Bury-validator module (`src/bury/`)

- [x] 2.1 Create `packages/engine/src/bury/bury.ts` with a pure `buryableCards(hand, melds, trump, restrictions) → Card[]` (D2): apply `no-melded` (exclude cards matching the bidder's meld cards by identity), `no-trump` (exclude trump-suit cards), and `no-dix` (exclude the trump `9`); a card is buryable only if it violates no active restriction. No runtime deps.
- [x] 2.2 Add `packages/engine/src/bury/index.ts` re-exporting `buryableCards`; wire it into `packages/engine/src/index.ts`.

## 3. Buried pile in `State`

- [x] 3.1 Extend `PrivateState` in `src/state/state.ts` with `buried: readonly Card[]` (D3); document it as the face-down bury pile.
- [x] 3.2 Initialize `buried: []` in `createInitialState` and confirm `State` stays JSON-round-trippable.

## 4. Drive `Bury` in `reduce`

- [x] 4.1 In `passThroughMelding` (`src/state/reduce.ts`), set `seatToAct` to the bidder (`contract.seatIndex`) on the bury-enabled rest at `Bury` (D4); leave the Partners `enterTrickPlay` path unchanged.
- [x] 4.2 Add a `case 'Bury'` to `reduce` that routes a `bury` event to a new `applyBury` (and rejects every other event); remove the "`Bury` rejected until implemented" note from the `default` branch.
- [x] 4.3 Implement `applyBury`: reject unless `event.seat` is the bidder and the seat-to-act; resolve each proposed `CardRef` to a held card by identity; reject unless the bury is legal (count `=== bury.size`, distinct, all in `buryableCards`). On acceptance, remove the cards from the bidder's hand, set `private.buried`, advance `Bury → TrickPlay` via `nextActivePhase`, and call `enterTrickPlay`.
- [x] 4.4 Update the `reduce` doc comment to describe the `Bury` phase being driven.

## 5. Buried counters at `HandScoring`

- [x] 5.1 In `passThroughHandScoring`, compute `buriedCounters` by summing `variant.scoring.counters[rank]` over `state.private.buried` and pass it to `HandScorer` in place of the hard-coded `0` (D5); confirm the Partners path (empty buried pile) still yields `0`.

## 6. Tests

- [x] 6.1 Unit-test `buryableCards`: melded/trump/dix cards excluded; an unused copy of a melded value still buryable; determinism + non-mutation.
- [x] 6.2 Unit-test bury legality composition: correct size/held/eligible bury is legal; wrong size, duplicate, unheld, or ineligible card is illegal.
- [x] 6.3 `reduce` Bury tests: entry to `Bury` sets the bidder to act; a legal `bury` removes the cards, fills `private.buried`, and advances to a seeded `TrickPlay` (bidder leads); an out-of-turn / wrong-size / ineligible bury is a no-op; a `bury` is rejected in non-`Bury` phases.
- [x] 6.4 `reduce` scoring test: a Cutthroat hand credits the buried cards' counter values to the bidding side at `HandScoring`; the Partners path is unchanged (`buriedCounters` is `0`).
- [x] 6.5 Integration test: fold a full Single-Deck Cutthroat hand (deal → auction → widow → declare → meld → bury → 15 tricks → score) over `reduce`, and a full 9-deal Cutthroat match to `MatchComplete` with a correct placement-based `MatchResult`; assert folding the same log twice is deep-equal.

## 7. Validate

- [x] 7.1 Run lint, typecheck, and tests via the validate agent and resolve any findings.
