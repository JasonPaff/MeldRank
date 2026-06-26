## Why

The engine drives a single pinochle hand from `deal` to a resting `HandScoring`, then stops — `reduce` never crosses the `HandScoring → Dealing (next hand) | MatchComplete` branch, so no full game can be played. This is the last engine piece needed to make a complete Single-Deck Partners match playable end-to-end: hand after hand until the match-end condition is met, then a final standings + rating basis. It also adds the final scoring module named in "Game Engine — Abstract Model" §5 (`MatchScorer`), the only §5 module besides `TimeoutMove` still unbuilt.

## What Changes

- Add a pure `MatchScorer(scorePad, variant) → MatchResult` to `@meldrank/engine`, per "Game Engine — Abstract Model" §5: it reads the running score pad's cumulative-by-side totals and the variant's `matchEnd` / `ratingBasis` to decide whether the match is over and, when it is, produce final standings and the rating basis.
- Implement the match-end decision: `matchEnd.mode === 'target-score'` ends once a side reaches `target` cumulative; `fixed-deals` ends once `deals` hands have been recorded.
- Produce the rating basis per variant: `team-win-loss` (winning vs. losing partnership) and `individual-placement` (placement 1..N), applying the Ruling 2 tiebreak — equal cumulative score breaks on **most hands made as bidder**, else a shared placement.
- Drive the match loop in `reduce`: on reaching `HandScoring`, deterministically evaluate the match-end condition. If met, advance to `MatchComplete` carrying the `MatchScorer` standings; if not, continue the match for another hand (rotate the dealer, reset per-hand state, preserve the running score pad and match-scope counters) so the next `deal` starts the next hand.
- Extend `State` with the minimal **match scope** the loop and `MatchScorer` need (e.g. hands-played count, per-side hands-made-as-bidder for the tiebreak, and the final `MatchResult` once at `MatchComplete`), keeping `State` plain and JSON-round-trippable.

## Capabilities

### New Capabilities

- `match-scorer`: the pure `MatchScorer(scorePad, variant) → MatchResult` module — match-end evaluation, final per-side standings, and the rating basis (team-win-loss / individual-placement) with the most-hands-made-as-bidder tiebreak.

### Modified Capabilities

- `hand-state-container`: `reduce` now drives the previously-undriven `HandScoring → Dealing (next hand) | MatchComplete` branch (match-end check, dealer rotation + per-hand reset for the next hand, `MatchComplete` terminal carrying standings) and `State` gains the match-scope fields this requires. (Previously `HandScoring` rested with no advance — the spec called this out as "the `MatchScorer`'s" branch.)

## Impact

- **`packages/engine`** — new `src/match/` module (`MatchScorer`, `MatchResult`, exports via `index.ts`); changes to `src/state/reduce.ts` (HandScoring branch, dealer rotation, per-hand reset, next-hand `deal` re-entry) and `src/state/state.ts` (match-scope fields, `MatchComplete` handling). Engine's zero-runtime-dependency invariant is preserved (consumes the `VariantDefinition` type only).
- **Downstream (design-only for now)** — the `MatchResult` standings + rating basis are the payload "Match Runtime" §9 and "Rating & Ranking" consume to end a match and update ratings. No code in those apps changes here.
- No breaking changes to existing public engine functions; `reduce`'s signature is unchanged and prior single-hand behavior is preserved up to `HandScoring`.
