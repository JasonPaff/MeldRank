## ADDED Requirements

### Requirement: Hand result computation

`@meldrank/engine` SHALL expose a pure `HandScorer(melds, captured, contract, buriedCounters, variant) → HandResult` per "Game Engine — Abstract Model" §5 and "Single-Deck Partners" §8. It SHALL fold each seat's recorded meld (`SeatMeld.total`) and captured counters (`SeatCapture.counters`, which already include the last-trick bonus) into per-**side** results, where the seat→side map is the variant's `seating.teams`: each partnership's seat-index group is one side (partnership variants), and each seat is its own side (free-for-all variants). The bidding side is the side containing `contract.seatIndex`, and `buriedCounters` SHALL be added to the bidding side's counters. `HandScorer` SHALL NOT mutate its inputs and SHALL be deterministic. The returned `HandResult` SHALL carry the per-side `HandScoreLine[]`, the bidding `side` id, and the made/set verdict.

#### Scenario: Seats fold into partnership sides

- **WHEN** `HandScorer` scores a hand for a partnership variant (e.g. `SINGLE_DECK_PARTNERS`, sides `[0,2]` and `[1,3]`)
- **THEN** each side's meld and counters equal the sum over its member seats, and the result carries exactly one `HandScoreLine` per side

#### Scenario: Each seat is its own side in a free-for-all variant

- **WHEN** `HandScorer` scores a hand for a free-for-all variant (`seating.teams` mode `free-for-all`)
- **THEN** the result carries one `HandScoreLine` per seat, keyed by seat index

#### Scenario: Buried counters are credited to the bidding side

- **WHEN** a non-zero `buriedCounters` is passed for a bury variant
- **THEN** that amount is added to the bidding side's counters before the made/set check, and to no other side

### Requirement: Meld needs a trick

When `scoring.meldNeedsATrick` is set, `HandScorer` SHALL count a side's meld **only if** that side took at least one trick that hand (any member seat has `tricksTaken > 0`); a side that took no trick SHALL score its counters with its meld forfeited to `0`. This gate SHALL be applied per side **before** the bidding side's made/set comparison, so a bidding side that took no trick cannot reach its bid on meld alone.

#### Scenario: A trickless side forfeits its meld

- **WHEN** a side with recorded meld took zero tricks and `meldNeedsATrick` is set
- **THEN** that side's `HandScoreLine` counts `0` meld (its counters are scored as captured)

#### Scenario: A side that took a trick keeps its meld

- **WHEN** a side with recorded meld took at least one trick and `meldNeedsATrick` is set
- **THEN** that side's `HandScoreLine` counts its full summed meld value

#### Scenario: The gate precedes the made/set check

- **WHEN** the bidding side's earned `meld + counters` would reach its bid but the side took no trick and `meldNeedsATrick` is set
- **THEN** the side's meld is forfeited first and the contract is evaluated as **set** against the gated total

### Requirement: Made and set evaluation with set penalty

`HandScorer` SHALL evaluate the bidding side against the contract per "Single-Deck Partners" §8: the bidding side is **made** when its gated `meld + counters ≥ contract.value`, otherwise **set**. On a made hand, the bidding side's `HandScoreLine.total` SHALL be its earned `meld + counters`. On a set hand, the bidding side's line SHALL apply `scoring.setPenalty`: `minus-bid-and-meld-lost` SHALL record `meld: 0`, `counters: 0`, and `total: -contract.value` (meld lost, bid subtracted); `minus-bid` SHALL record `total: -contract.value`. The made/set verdict SHALL be reported in the `HandResult`.

#### Scenario: Bidding side makes its bid at exactly the bid value

- **WHEN** the bidding side's gated `meld + counters` equals `contract.value`
- **THEN** the verdict is **made** and the bidding side's line total is its earned `meld + counters`

#### Scenario: Bidding side is set below its bid

- **WHEN** the bidding side's gated `meld + counters` is less than `contract.value` and `setPenalty` is `minus-bid-and-meld-lost`
- **THEN** the verdict is **set**, the bidding side's line records `meld: 0`, `counters: 0`, and `total: -contract.value`

#### Scenario: A set does not penalize the non-bidding side

- **WHEN** the bidding side is set under `all-sides-score`
- **THEN** the non-bidding side's line is unaffected and scores what it earned (subject to the meld-needs-a-trick gate)

### Requirement: Scoring mode gating

`HandScorer` SHALL honor `scoring.mode`. Under `all-sides-score` (Partners), every side scores what it earned (made hand) or per the set rules (set hand). Under `bidder-vs-bid` (Cutthroat), only the bidding side scores against its bid and every non-bidding (defender) side SHALL score `total: 0` regardless of the counters it captured.

#### Scenario: All sides score under all-sides-score

- **WHEN** a hand is scored under `scoring.mode` `all-sides-score`
- **THEN** the non-bidding side's line total reflects its earned meld + counters (gated), not zero

#### Scenario: Defenders score zero under bidder-vs-bid

- **WHEN** a hand is scored under `scoring.mode` `bidder-vs-bid`
- **THEN** every defender side's line total is `0`, and only the bidding side's line reflects its made/set outcome
