## 1. HandScorer module (`@meldrank/engine`)

- [x] 1.1 Add a `score/` module with the `HandResult` shape (per-side `HandScoreLine[]`, the bidding `side` id, a `made: boolean` verdict) and a pure `HandScorer(melds, captured, contract, buriedCounters, variant) → HandResult`; no input mutation, deterministic, zero runtime deps (design D1, D2)
- [x] 1.2 Fold seats into sides from `seating.teams`: partnership groups → one side each, free-for-all → each seat its own side; sum each side's meld (`SeatMeld.total`) and counters (`SeatCapture.counters`), mark a side as having taken a trick when any member seat has `tricksTaken > 0`, and credit `buriedCounters` to the bidding side (the side holding `contract.seatIndex`) (design D3)
- [x] 1.3 Apply the meld-needs-a-trick gate per side **before** the made/set check: when `scoring.meldNeedsATrick` is set, a side that took no trick counts `0` meld (design D4)
- [x] 1.4 Evaluate made/set: bidding side **made** when gated `meld + counters ≥ contract.value`, else **set**; on a set apply `scoring.setPenalty` (`minus-bid-and-meld-lost` → `meld: 0`, `counters: 0`, `total: -value`; `minus-bid` → `total: -value`); non-bidding sides unaffected by the penalty (design D5)
- [x] 1.5 Honor `scoring.mode`: `all-sides-score` scores every side; `bidder-vs-bid` forces every defender side's line `total` to `0` (design D5)
- [x] 1.6 Build each side's line via the existing `makeHandScoreLine` so `total` derives from meld + counters (except the explicit set-penalty / zero-defender overrides)

## 2. State shape — hand result & score pad (`@meldrank/engine`)

- [x] 2.1 Extend `PublicState` (`state/state.ts`) with `handResult: HandResult | null` and `scorePad: ScorePad` (design D7)
- [x] 2.2 Seed both in `createInitialState` (`handResult: null`, `scorePad: createScorePad()`) and confirm `State` stays plain and JSON-round-trippable (no `Map`/`Set`, no behavior)

## 3. HandScoring pass-through wiring (`@meldrank/engine`)

- [x] 3.1 Add a `passThroughHandScoring` step that calls `HandScorer` with the recorded `public.melds`, `public.captured`, the assembled `Contract` (`getContract`), `buriedCounters: 0` on the Partners path, and the `variant`; write `public.handResult` and append the result's lines to `public.scorePad` via `appendHand` (design D6)
- [x] 3.2 Route the `TrickPlay` final-trick transition (`resolveCompletedTrick`, hands-empty branch) through `passThroughHandScoring` when the next active phase is `HandScoring`, so the lifecycle rests at a **scored** `HandScoring` (design D6)
- [x] 3.3 Keep the `HandScoring → Dealing` / `MatchComplete` branch rejected: no event advances the rested `HandScoring` state in this slice
- [x] 3.4 Unit tests: entering `HandScoring` records a `handResult` and an appended `scorePad`; a made Partners hand scores both sides; a set bidding side records `-bid` with meld lost while opponents are unaffected; the meld-needs-a-trick gate forfeits a trickless side's meld; the lifecycle rests at `HandScoring` (no further advance)

## 4. Wire-up & validation

- [x] 4.1 Export the `score` public surface (`HandScorer`, `HandResult`) from `@meldrank/engine`'s root
- [x] 4.2 Extend the integration test: a full Partners hand folds `deal → (auction) → declareTrump → (melding) → 12× playCard` to a scored `HandScoring` carrying the per-side result and the appended score pad; folding the same log twice is deep-equal (replay determinism)
- [x] 4.3 Add targeted pure-module unit tests for the variant-driven axes not on the wired path: `bidder-vs-bid` defenders score `0`, and free-for-all side folding keys lines by seat index
- [x] 4.4 Confirm the zero-runtime-deps invariant still holds (engine `package.json` has no `dependencies`; `@meldrank/shared` imports remain type-only) — the existing invariant test must stay green
- [x] 4.5 Run lint, typecheck, and the full Vitest suite via the validate agent and resolve any findings
