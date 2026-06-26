## ADDED Requirements

### Requirement: Match scorer computation

`@meldrank/engine` SHALL expose a pure `MatchScorer(scorePad, handResult, handsMadeAsBidder, variant) → MatchResult` per "Game Engine — Abstract Model" §5. It SHALL read the running `ScorePad` (its per-hand lines and cumulative-by-side totals), the just-finished hand's `HandResult` (the bidding `side` and the made/set verdict), and the per-side `handsMadeAsBidder` tiebreak counter to decide whether the match has ended and, when it has, to produce final standings and the rating basis. `MatchScorer` SHALL NOT mutate its inputs and SHALL be deterministic (same inputs always yield a deep-equal `MatchResult`). The returned `MatchResult` SHALL carry a `complete` flag, the per-side `standings` ordered by placement, and the variant's `ratingBasis`.

#### Scenario: MatchScorer is pure and deterministic

- **WHEN** `MatchScorer` is called twice with the same `scorePad`, `handResult`, `handsMadeAsBidder`, and `variant`
- **THEN** the two `MatchResult` values are deep-equal and none of the inputs are mutated

#### Scenario: The rating basis is read from the variant

- **WHEN** a `MatchResult` is produced for a variant whose `ratingBasis` is `team-win-loss` (and again for `individual-placement`)
- **THEN** `MatchResult.ratingBasis` equals the variant's `ratingBasis` exactly, not inferred from the team structure

### Requirement: Match-end evaluation

`MatchScorer` SHALL evaluate the variant's `matchEnd` condition. Under `fixed-deals`, the match SHALL be `complete` once the number of recorded hands (`scorePad.hands.length`) reaches `matchEnd.deals`, and not before. Under `target-score`, the match SHALL be evaluated per "Single-Deck Partners" §9 with the **bidding side counted first**: it is `complete` if the just-finished hand's bidding side **made** its bid and that side's cumulative score is `>= matchEnd.target` (it wins even if another side also crossed the target that hand); otherwise it is `complete` if any other side's cumulative score is `>= matchEnd.target`; otherwise it is not `complete`. When not `complete`, `standings` MAY be empty and the caller continues the match.

#### Scenario: Fixed-deals completes on the last deal

- **WHEN** `MatchScorer` is called for a `fixed-deals` variant (e.g. Cutthroat, 9 deals) and `scorePad.hands.length` is below `deals`
- **THEN** `complete` is `false`; and when called again after the score pad reaches `deals` hands, `complete` is `true`

#### Scenario: Bidding side counts out first when both sides cross

- **WHEN** the bidding side made its bid and reaches the `target`, and the non-bidding side also crossed the `target` the same hand (with a higher cumulative)
- **THEN** `complete` is `true` and the bidding side is placed first (it wins despite the lower cumulative)

#### Scenario: Non-bidding side wins when the bidder did not count out

- **WHEN** only the non-bidding side's cumulative reaches the `target` (the bidding side was set or fell short)
- **THEN** `complete` is `true` and the non-bidding side is placed first

#### Scenario: Match continues below the target

- **WHEN** no side's cumulative has reached the `target` after the hand
- **THEN** `complete` is `false`

### Requirement: Standings, placement, and tiebreak

When the match is `complete`, `MatchScorer` SHALL produce one `MatchStanding` per side carrying the side id, its final cumulative score, its `handsMadeAsBidder`, a 1-based `placement`, and a win/loss `outcome`. Placement SHALL rank sides by the win determination (under `target-score` the counted-out winner is placement 1, remaining sides follow by cumulative descending; under `fixed-deals` sides rank by cumulative descending). Ties on cumulative SHALL break by **most hands made as bidder** (`handsMadeAsBidder` descending) per "Game Engine — Abstract Model" Ruling 2; sides still equal SHALL **share** a placement, and the next distinct placement SHALL skip the shared positions.

#### Scenario: Placement orders sides by score

- **WHEN** standings are produced for a completed `fixed-deals` match with distinct cumulative scores
- **THEN** the highest-scoring side has `placement` 1 and the rest follow in descending cumulative order

#### Scenario: Tie broken by hands made as bidder

- **WHEN** two sides finish with equal cumulative score and one has more `handsMadeAsBidder`
- **THEN** the side with more hands made as bidder gets the better (lower) placement

#### Scenario: Fully tied sides share a placement and the next placement skips

- **WHEN** two sides finish equal on both cumulative score and `handsMadeAsBidder`
- **THEN** both share the same `placement` number and the next side's `placement` skips by the number of tied sides (e.g. two firsts → the next is placement 3)

### Requirement: Rating basis outcomes

`MatchScorer` SHALL set each standing's `outcome` from the rating basis: `placement` 1 is `win` and every other placement is `loss`. Under `team-win-loss` the result distinguishes the single winning side from the losing side(s); under `individual-placement` every side additionally carries its ordinal `placement` (1st / 2nd / 3rd …). The rating basis itself SHALL be reported on `MatchResult.ratingBasis` for the rating system to consume.

#### Scenario: Team win/loss marks one winner

- **WHEN** a completed `team-win-loss` match (Partners) is scored
- **THEN** exactly the placement-1 side has `outcome: 'win'` and the other side has `outcome: 'loss'`

#### Scenario: Individual placement carries ordinals

- **WHEN** a completed `individual-placement` match (Cutthroat) is scored
- **THEN** each side carries its ordinal `placement` (1, 2, 3), the placement-1 side has `outcome: 'win'`, and `MatchResult.ratingBasis` is `individual-placement`
