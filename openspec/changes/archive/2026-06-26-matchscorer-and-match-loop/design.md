## Context

`reduce` drives a single hand from `deal` to a resting `HandScoring`, where it records the `HandScorer` result and appends the per-side lines to `public.scorePad` — then stops. The `HandScoring → Dealing (next hand) | MatchComplete` branch of the lifecycle ("Game Engine — Abstract Model" §2) is defined in `hand-lifecycle-state-machine` but not driven; `reduce` and the `hand-state-container` spec explicitly defer it to "the `MatchScorer`'s change." `MatchScorer` is the last §5 module besides `TimeoutMove` still unbuilt.

The pieces already in place: `ScorePad` with cumulative-by-side totals and `appendHand` (`domain/entities.ts`); `HandResult { lines, side, made }` from `HandScorer`; `variant.matchEnd` (`{ mode: 'target-score', target } | { mode: 'fixed-deals', deals }`) and `variant.ratingBasis` (`'team-win-loss' | 'individual-placement'`); `seating.teams` mapping seats to sides; `public.dealerSeat`. The count-out rule is fixed by "Single-Deck Partners" §9 and the placement tiebreak by "Game Engine — Abstract Model" Ruling 2.

## Goals / Non-Goals

**Goals:**

- A pure `MatchScorer` that decides match-end, produces final per-side standings, and reports the rating basis — serving both canonical variants (target-score/team-win-loss and fixed-deals/individual-placement).
- Close the match loop in `reduce`: after each `HandScoring`, either end the match (`MatchComplete` carrying the standings) or continue to the next hand on a fresh `deal` (dealer rotated, per-hand state reset, score pad and match-scope counters preserved).
- A complete Single-Deck Partners match playable end-to-end as a deterministic fold over an event log.
- Preserve the engine invariants: pure, non-mutating, deterministic, `State` JSON-round-trippable, zero runtime deps.

**Non-Goals:**

- Cutthroat's `Bury` phase (still undriven) and `TimeoutMove` — separate later changes. `MatchScorer` is written to serve Cutthroat's fixed-deals/placement axes, but a full Cutthroat match cannot be played until `Bury` lands.
- Rating-number math (Elo/Glicko etc.) — that is "Rating & Ranking" in `apps/api`. This change produces only the **rating basis** (win/loss or placement) the rating system consumes.
- Match-clock, reconnection, and pacing of the inter-hand pause — "Match Runtime" concerns.

## Decisions

### D1 — New `match-scorer` capability in `src/match/`

A pure `MatchScorer(scorePad, handResult, handsMadeAsBidder, variant) → MatchResult` mirroring the other §5 modules' shape (plain values + the `VariantDefinition` type only). It lives in its own `src/match/` folder with an `index.ts` re-export, consistent with `score/`, `play/`, `meld/`.

`MatchResult`:

```
interface MatchStanding {
  side: number;              // partnership index, or seat index for free-for-all
  cumulative: number;        // final cumulative score from the score pad
  handsMadeAsBidder: number; // tiebreak key (Ruling 2)
  placement: number;         // 1-based; tied sides share a placement
  outcome: 'win' | 'loss';   // win for placement 1, else loss
}
interface MatchResult {
  complete: boolean;                                  // has the match ended?
  standings: readonly MatchStanding[];               // ordered by placement (empty until complete)
  ratingBasis: 'team-win-loss' | 'individual-placement';
}
```

_Why this signature over the bare §5 `(scorePad, variant)`_: the count-out rule (§9) needs the last hand's bidding side + made verdict, and the Ruling 2 tiebreak needs hands-made-as-bidder — neither is recoverable from the `ScorePad` (its lines carry only `{side, meld, counters, total}`). Rather than thicken `ScorePad` with bidder/made provenance on every line, the two extra inputs are threaded in explicitly. `handResult` is already in `public.handResult`; `handsMadeAsBidder` is the one new match-scope counter.

### D2 — Match-end evaluation (the count-out)

- **`fixed-deals`**: complete once `scorePad.hands.length >= matchEnd.deals`.
- **`target-score`** (per "Single-Deck Partners" §9, bidding side counted first):
  1. If the last hand's bidding side **made** its bid and its cumulative `>= target` → complete, that side wins (even if another side also crossed).
  2. Else if any other side's cumulative `>= target` → complete, the highest-cumulative such side wins (tie broken by hands-made-as-bidder, then shared placement).
  3. Else → not complete; continue.

This faithfully encodes "no must-bid-to-go-out" while honoring "bidder counts out first." The rare residual case — a side already at/above target gets set this hand and no one else has reached — resolves to _continue play_ (it neither made-and-reached nor did an opponent reach), which matches the count-first framing; called out as a verify item below.

### D3 — Standings, placement, and rating basis

- **Placement**: sort sides by the win determination above (target-score: the counted-out winner first, then remaining sides by cumulative) or by cumulative descending (fixed-deals). Ties on cumulative break by `handsMadeAsBidder` desc; still-equal sides **share** a placement number (Ruling 2), and the next placement skips accordingly.
- **`ratingBasis: 'team-win-loss'`**: placement 1 → `win`, all others → `loss` (Partners: one winning partnership, one losing).
- **`ratingBasis: 'individual-placement'`**: every side gets its `placement`; `outcome` is `win` for placement 1, else `loss` (Cutthroat reports 1st/2nd/3rd).
- The basis is read straight from `variant.ratingBasis`; `MatchScorer` does not infer it from team structure.

### D4 — Match scope added to `State`

`public` gains two match-scope fields, both plain and serializable:

- `handsMadeAsBidder: Record<number, number>` — side → count of hands that side bid **and made**. Updated at each `HandScoring`: increment `handResult.side` when `handResult.made`. Initialized `{}` in `createInitialState`.
- `matchResult: MatchResult | null` — `null` until the match ends; set when entering `MatchComplete`.

`scorePad` (already present) carries the per-hand and cumulative scoring; `scorePad.hands.length` is the deals-played count. No private match-scope state is needed.

### D5 — The match loop in `reduce`

- **At `HandScoring`** (`passThroughHandScoring`): after recording `handResult` and the appended `scorePad`, compute the updated `handsMadeAsBidder`, then call `MatchScorer`. If `result.complete` → advance along the legal `HandScoring → MatchComplete` edge, set `public.matchResult`, `seatToAct = null`, and rest (terminal). If not complete → rest at `HandScoring` with the updated `handsMadeAsBidder`, exactly as today plus the counter.
- **Next hand**: a `deal` event is accepted at `HandScoring` (it is only ever reached when the match is _not_ over, since match-over diverts to `MatchComplete`). It rotates the dealer (`(dealerSeat + 1) % playerCount`), resets the per-hand public/private fields to their `Dealing` defaults while **preserving** `scorePad`, `handsMadeAsBidder`, and the rotated `dealerSeat`, then runs the existing deal logic (deal hands/widow, open auction → `Auction`). This reuses `applyDeal` after building the fresh next-hand base.
- **At `MatchComplete`**: terminal — every event is rejected unchanged.

_Alternative considered_: auto-advance `HandScoring → Dealing` (reset + rotate) within the scoring step and rest at `Dealing` awaiting `deal`, reusing the existing deal-in-Dealing guard unchanged. Rejected because it clears the just-scored `handResult` from the visible state (or forces preserving it under a `Dealing` phase), muddying "the scored hand result is visible at `HandScoring`." Resting at `HandScoring` keeps the scoreboard the natural inter-hand boundary and lets Match Runtime pace the next deal.

### D6 — `deal` is now legal in two phases

The phase guard accepts `deal` in `Dealing` (first hand, from `createInitialState`) and in `HandScoring` (subsequent hands). Both paths converge on the same dealing logic; the difference is only the fresh-base construction (rotate dealer, preserve match scope) for the `HandScoring` case.

## Risks / Trade-offs

- **Count-out edge cases (target-score)** → Encode §9 literally (bidder counted first; either side can reach target; no must-bid-to-go-out) and cover the both-sides-cross and only-defender-crosses cases with explicit scenarios + tests; the set-while-already-above-target residual is documented as continue-play.
- **Placement-tie sharing (Ruling 2)** → Shared placements must skip the next rank (e.g. two firsts → next is third). Unit-test the share-and-skip behavior directly.
- **Signature deviates from the bare §5 `(scorePad, variant)`** → Documented in D1; the extra inputs are the minimal data `ScorePad` cannot carry, avoiding a heavier score-pad schema change that would ripple into `Data Model`/replay.
- **`deal` legal in two phases could mask an out-of-phase deal** → It is constrained: at `HandScoring` the match is provably not over (over ⇒ `MatchComplete`), so a next-hand deal is always valid there; no other phase accepts `deal`.
- **Cutthroat not end-to-end playable yet** → `MatchScorer` is variant-general and unit-tested against both axes, but `Bury` is still undriven, so the _match-loop integration_ test is Partners-only this change; Cutthroat integration follows the `Bury` change.

## Open Questions

- None blocking. To verify against "Single-Deck Partners" §9 during implementation: the residual "already ≥ target, set this hand, no opponent reached" case resolving to continue-play (the chosen reading of "bidder counts out first").
