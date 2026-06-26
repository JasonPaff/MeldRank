## 1. MatchScorer module (`src/match/`)

- [x] 1.1 Create `packages/engine/src/match/match.ts` with the `MatchStanding` and `MatchResult` types (D1) and a pure `MatchScorer(scorePad, handResult, handsMadeAsBidder, variant) → MatchResult` skeleton consuming only plain values and the `VariantDefinition` type (no runtime deps).
- [x] 1.2 Implement match-end evaluation: `fixed-deals` completes when `scorePad.hands.length >= matchEnd.deals`; `target-score` applies the §9 count-out (bidding side counted first via `handResult.side`/`handResult.made`, then any other side `>= target`, else not complete).
- [x] 1.3 Implement standings + placement: order sides (counted-out winner first for target-score; cumulative desc for fixed-deals), break cumulative ties by `handsMadeAsBidder` desc, share placements for fully-tied sides and skip the next placement (Ruling 2).
- [x] 1.4 Implement rating-basis outcomes: read `variant.ratingBasis` onto `MatchResult.ratingBasis`; set `outcome` (`win` for placement 1, else `loss`); carry ordinal placements for `individual-placement`.
- [x] 1.5 Add `packages/engine/src/match/index.ts` re-exporting `MatchScorer`, `MatchResult`, `MatchStanding`; wire it into `packages/engine/src/index.ts`.

## 2. Match-scope state

- [x] 2.1 Extend `PublicState` in `src/state/state.ts` with `handsMadeAsBidder: Record<number, number>` and `matchResult: MatchResult | null` (D4); document both as match scope.
- [x] 2.2 Initialize the new fields in `createInitialState` (`{}` and `null`) and confirm `State` stays JSON-round-trippable (no Maps/Sets/class instances).

## 3. Match loop in `reduce`

- [x] 3.1 In `passThroughHandScoring` (`src/state/reduce.ts`): after recording `handResult` and the appended `scorePad`, compute the updated `handsMadeAsBidder` (increment `handResult.side` when `handResult.made`).
- [x] 3.2 Call `MatchScorer` from `passThroughHandScoring`; on `complete`, advance along the legal `HandScoring → MatchComplete` edge, set `public.matchResult`, `seatToAct = null`, and rest terminally; otherwise rest at `HandScoring` with the updated counter.
- [x] 3.3 Accept `deal` at `HandScoring` in `reduce`: build the fresh next-hand base (rotate `dealerSeat` by `(dealerSeat + 1) % playerCount`, reset per-hand public/private fields to `Dealing` defaults, preserve `scorePad` + `handsMadeAsBidder`), then run the existing deal logic to land at `Auction` (reuse `applyDeal`).
- [x] 3.4 Ensure `MatchComplete` is terminal in `reduce` (every event rejected unchanged) and that `deal` is rejected in all phases except `Dealing` and `HandScoring`.

## 4. Tests

- [x] 4.1 Unit-test `MatchScorer` match-end: fixed-deals boundary (below/at `deals`); target-score below target (continue); both-sides-cross with bidder made (bidder counts out first); only-defender-reaches (defender wins).
- [x] 4.2 Unit-test `MatchScorer` standings: cumulative ordering, hands-made-as-bidder tiebreak, fully-tied share-and-skip placement, and rating-basis outcomes for both `team-win-loss` and `individual-placement`.
- [x] 4.3 Unit-test `MatchScorer` purity/determinism (inputs unmutated, deep-equal on repeat).
- [x] 4.4 `reduce` tests: `handsMadeAsBidder` accumulates on a made hand and is unchanged on a set hand; `deal` at resting `HandScoring` rotates the dealer, preserves `scorePad`/`handsMadeAsBidder`, resets per-hand fields, and lands at `Auction`; `MatchComplete` rejects all events.
- [x] 4.5 Integration test: fold a full Single-Deck Partners match (multiple hands to target 1500) over `reduce` from an event log; assert it terminates at `MatchComplete` with a correct `MatchResult`, and that folding the same log twice is deep-equal (deterministic replay).

## 5. Validate

- [x] 5.1 Run lint, typecheck, and tests via the validate agent and resolve any findings.
