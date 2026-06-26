## MODIFIED Requirements

### Requirement: Phase-guarded event application

`reduce` SHALL validate each event against the current lifecycle phase and reject any event not legal in that phase, returning the state unchanged (or a typed rejection) without mutation. `TrickPlay` is a **resting, player-driven** phase: a `playCard` from the seat-to-act, naming a card that the `LegalPlayValidator` reports as legal, is **accepted** and folded into the current trick; a `playCard` out of turn, naming a card not held, or naming an illegal card is rejected and the state is unchanged. `HandScoring` is a **computed, resting** phase with no driving player intent: it is reached and scored deterministically when `TrickPlay` empties the hands (see the lifecycle-advancement requirement). When the match is not over, the lifecycle rests at `HandScoring` and a `deal` event (carrying a fresh seed) is **accepted** there to start the next hand; when the match is over, `HandScoring` advances deterministically to `MatchComplete` instead of resting. `deal` is therefore legal in both `Dealing` (the first hand) and `HandScoring` (subsequent hands) and rejected in every other phase. `MatchComplete` is **terminal**: every event is rejected and the state is unchanged. `Bury` remains accepted by the type but rejected by the guard until its phase is implemented.

#### Scenario: An event illegal for the current phase is rejected

- **WHEN** a `bid` event is reduced while the phase is `Dealing`
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal event drives the Dealing phase

- **WHEN** a `deal` event carrying a seed is reduced while the phase is `Dealing`
- **THEN** per-seat hands and the widow are populated and the phase advances to `Auction`

#### Scenario: declareTrump is driven and Melding is applied

- **WHEN** a `declareTrump` from the contract winner naming a valid suit is reduced while the phase is `DeclareTrump`
- **THEN** the trump is recorded, each melding seat's meld is computed and recorded, and the phase advances past `Melding` to the variant's next active phase

#### Scenario: A legal playCard is accepted during TrickPlay

- **WHEN** a `playCard` from the seat-to-act naming a card in the `LegalPlayValidator`'s legal set is reduced while the phase is `TrickPlay`
- **THEN** the card is removed from the seat's hand, appended to the current trick, and the turn passes to the next seat

#### Scenario: An illegal or out-of-turn playCard is rejected

- **WHEN** a `playCard` is reduced during `TrickPlay` from a seat that is not to act, or naming a card the seat does not hold, or naming a card excluded by the legal set
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal starts the next hand from a resting HandScoring

- **WHEN** a `deal` event carrying a fresh seed is reduced while the phase is `HandScoring` and the match is not over
- **THEN** the dealer is rotated one seat, the per-hand state is reset while the running score pad and match-scope counters are preserved, new hands and widow are dealt, and the phase advances to `Auction`

#### Scenario: MatchComplete rejects all events

- **WHEN** any event is reduced while the phase is `MatchComplete`
- **THEN** the event is rejected and the state is unchanged

### Requirement: Lifecycle advancement via the transition table

When an event concludes a phase, `reduce` SHALL advance the phase marker to the next phase using the foundation's legal-transition table and the variant's active path (`resolveActivePath`), skipping bracketed phases the variant disables. `reduce` SHALL NOT advance along a transition the table reports as illegal. Where an enabled phase has no driving player event (`WidowReveal`, `Melding`, `HandScoring`), `reduce` SHALL apply it deterministically within the concluding step and pass through to (or rest on) the next phase rather than awaiting an event for it. `TrickPlay` SHALL self-loop while hands hold cards and SHALL advance to `HandScoring` only once all hands are empty after a resolved trick; on that advance `reduce` SHALL deterministically compute the hand score (the `HandScorer` result and the appended score pad), update the per-side hands-made-as-bidder counter, and then evaluate the match-end condition via `MatchScorer`: if the match is over, `reduce` SHALL advance along the legal `HandScoring → MatchComplete` edge and record the `MatchResult`; otherwise `reduce` SHALL rest at `HandScoring` awaiting the next `deal`.

#### Scenario: DeclareTrump drives through Melding to TrickPlay (Partners)

- **WHEN** the contract winner declares trump for `SINGLE_DECK_PARTNERS`
- **THEN** the trump is recorded, all seats' melds are computed (Partners melds at all seats), and the phase advances through `Melding` to settle at `TrickPlay` (Partners skips `Bury`)

#### Scenario: TrickPlay self-loops until hands empty

- **WHEN** a trick is resolved during `TrickPlay` and at least one seat still holds cards
- **THEN** the phase remains `TrickPlay` and a fresh trick begins, led by the trick winner

#### Scenario: TrickPlay advances to a scored HandScoring when hands empty

- **WHEN** the final trick of the hand is resolved during `TrickPlay` (all hands now empty)
- **THEN** the phase advances along the legal-transition edge to `HandScoring`, the `HandScorer` result is recorded and its lines appended to the score pad, and (when the match is not over) the lifecycle rests at `HandScoring`

#### Scenario: HandScoring continues the match for another hand

- **WHEN** the hand score is computed at `HandScoring` and `MatchScorer` reports the match is not over
- **THEN** the lifecycle rests at `HandScoring` with the score pad and the updated hands-made-as-bidder counter recorded, and the next `deal` starts a new hand with the dealer rotated

#### Scenario: HandScoring ends the match at MatchComplete

- **WHEN** the hand score is computed at `HandScoring` and `MatchScorer` reports the match is over
- **THEN** the phase advances along the legal `HandScoring → MatchComplete` edge, the `MatchResult` (standings + rating basis) is recorded in public state, and the lifecycle rests terminally at `MatchComplete`

#### Scenario: An illegal transition is never taken

- **WHEN** the next-phase advance is computed
- **THEN** `reduce` only follows edges the legal-transition table reports as legal, skipping bracketed phases the active variant disables

## ADDED Requirements

### Requirement: Match-scope public state

`State.public` SHALL carry the match-scope data the match loop and `MatchScorer` need, kept plain and serializable like the rest of `State`: a per-side `handsMadeAsBidder` counter (initialized empty, incremented at each `HandScoring` for the bidding side when it made its bid) and a `matchResult` that is `null` until the match ends and holds the final `MatchResult` (standings + rating basis) once the lifecycle reaches `MatchComplete`. The running `scorePad` (already public) SHALL remain the per-hand and cumulative scoring record, and its hand count SHALL serve as the deals-played count for `fixed-deals` match-end. Across hands of one match, `reduce` SHALL preserve `scorePad`, `handsMadeAsBidder`, and the rotated `dealerSeat` when resetting per-hand state for the next `deal`.

#### Scenario: Hands made as bidder accumulate across hands

- **WHEN** the bidding side makes its bid in a hand and the lifecycle rests at `HandScoring`
- **THEN** that side's `handsMadeAsBidder` count increases by one, and a hand where the bidding side is set leaves the counter unchanged

#### Scenario: Match scope survives the next deal

- **WHEN** a `deal` starts the next hand from a resting `HandScoring`
- **THEN** the running `scorePad` and `handsMadeAsBidder` are carried forward unchanged into the new hand while the per-hand fields (auction, contract, trump, melds, tricks, capture tally, hand result) are reset

#### Scenario: The final match result is recorded at MatchComplete

- **WHEN** the lifecycle reaches `MatchComplete`
- **THEN** `public.matchResult` holds the `MatchResult` with per-side standings and the rating basis, and it is JSON-round-trippable like the rest of `State`
