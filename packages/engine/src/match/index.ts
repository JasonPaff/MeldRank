/**
 * The `match/` module: the §5 match-level scorer. `MatchScorer` reads the running
 * score pad, the just-finished hand result, and the per-side hands-made-as-bidder
 * counter to decide match-end and, when the match is over, produce final standings
 * (placement + win/loss) and the rating basis. Pure, deterministic, dependency-free
 * — the match-loop counterpart to `score/`'s per-hand `HandScorer`.
 */
export { MatchScorer, type MatchResult, type MatchStanding } from './match';
