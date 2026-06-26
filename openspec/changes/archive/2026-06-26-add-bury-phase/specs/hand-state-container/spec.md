## MODIFIED Requirements

### Requirement: Closed event union

The engine SHALL define `Event` as a closed, typed union of the locked player intents (`bid`, `pass`, `declareTrump`, `playCard`, `bury`, per "API Surface" §4) and the system events (`deal`, carrying the shuffle seed; `timeout`). The `bury` intent carries the seat and the cards the bidder discards face-down (`{ type: 'bury', seat, cards }`). Intent payload _types_ SHALL be consumed from `@meldrank/shared` as types only; no Zod or runtime dependency enters the engine.

#### Scenario: The event kinds are exactly the documented set

- **WHEN** the set of `Event` kinds is enumerated
- **THEN** it equals exactly `bid`, `pass`, `declareTrump`, `playCard`, `bury`, `deal`, and `timeout`, with no extras and none missing

### Requirement: Phase-guarded event application

`reduce` SHALL validate each event against the current lifecycle phase and reject any event not legal in that phase, returning the state unchanged (or a typed rejection) without mutation. `TrickPlay` is a **resting, player-driven** phase: a `playCard` from the seat-to-act, naming a card that the `LegalPlayValidator` reports as legal, is **accepted** and folded into the current trick; a `playCard` out of turn, naming a card not held, or naming an illegal card is rejected and the state is unchanged. `Bury` is a **resting, player-driven** phase for bury-enabled variants: on entry the **bidder** (the recorded contract seat) is set to act, and a `bury` from the bidder naming exactly `dealing.bury.size` distinct, held, eligible cards (per the bury-validator) is **accepted** — the named cards leave the bidder's hand into the buried pile and the phase advances to `TrickPlay`; a `bury` out of turn, of the wrong size, or naming an ineligible or unheld card is rejected and the state is unchanged. `HandScoring` is a **computed, resting** phase with no driving player intent: it is reached and scored deterministically when `TrickPlay` empties the hands (see the lifecycle-advancement requirement). When the match is not over, the lifecycle rests at `HandScoring` and a `deal` event (carrying a fresh seed) is **accepted** there to start the next hand; when the match is over, `HandScoring` advances deterministically to `MatchComplete` instead of resting. `deal` is therefore legal in both `Dealing` (the first hand) and `HandScoring` (subsequent hands) and rejected in every other phase. `MatchComplete` is **terminal**: every event is rejected and the state is unchanged.

A `timeout` system event SHALL be resolved uniformly through `TimeoutMove`: when its `seat` is the current seat-to-act, `reduce` SHALL compute the forced intent via `TimeoutMove(state)` and apply it through the **identical** path the equivalent player intent would take (so the forced move passes the same phase, turn, and legality guards as a human move). When the `timeout` names a seat that is not to act, or `TimeoutMove` defines no forced move for the current phase (returns `null`), `reduce` SHALL leave the state unchanged. This is the single resolution point for `timeout` in every phase; no phase branch handles `timeout` inline.

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

#### Scenario: A legal bury is accepted during Bury

- **WHEN** a `bury` from the bidder naming exactly `bury.size` distinct, held, eligible cards is reduced while the phase is `Bury`
- **THEN** those cards are removed from the bidder's hand into the buried pile and the phase advances to `TrickPlay`

#### Scenario: An illegal or out-of-turn bury is rejected

- **WHEN** a `bury` is reduced during `Bury` from a seat other than the bidder, or naming the wrong number of cards, a duplicate, an unheld card, or a card excluded by the bury-validator
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A timeout for the seat-to-act applies the forced move

- **WHEN** a `timeout` naming the seat-to-act is reduced while the phase is `Auction` (and again while the phase is `TrickPlay`)
- **THEN** the forced intent from `TimeoutMove` is applied — the seat passes during `Auction`, and during `TrickPlay` the seat's lowest-value legal card is played — exactly as if that intent had been submitted by the seat

#### Scenario: A timeout for a non-acting seat or undefined-policy phase is a no-op

- **WHEN** a `timeout` naming a seat that is not the seat-to-act is reduced, or a `timeout` is reduced while the phase defines no forced move (e.g. `DeclareTrump`)
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal starts the next hand from a resting HandScoring

- **WHEN** a `deal` event carrying a fresh seed is reduced while the phase is `HandScoring` and the match is not over
- **THEN** the dealer is rotated one seat, the per-hand state is reset while the running score pad and match-scope counters are preserved, new hands and widow are dealt, and the phase advances to `Auction`

#### Scenario: MatchComplete rejects all events

- **WHEN** any event is reduced while the phase is `MatchComplete`
- **THEN** the event is rejected and the state is unchanged

### Requirement: Lifecycle advancement via the transition table

When an event concludes a phase, `reduce` SHALL advance the phase marker to the next phase using the foundation's legal-transition table and the variant's active path (`resolveActivePath`), skipping bracketed phases the variant disables. `reduce` SHALL NOT advance along a transition the table reports as illegal. Where an enabled phase has no driving player event (`WidowReveal`, `Melding`, `HandScoring`), `reduce` SHALL apply it deterministically within the concluding step and pass through to (or rest on) the next phase rather than awaiting an event for it. For a bury-enabled variant, `Melding` SHALL pass through to rest at `Bury` with the bidder set to act, and a valid `bury` SHALL advance `Bury → TrickPlay`, seeding the trick loop (the bidder leads the first trick). `TrickPlay` SHALL self-loop while hands hold cards and SHALL advance to `HandScoring` only once all hands are empty after a resolved trick; on that advance `reduce` SHALL deterministically compute the hand score (the `HandScorer` result and the appended score pad), crediting the buried counters to the bidding side for a bury-enabled variant, update the per-side hands-made-as-bidder counter, and then evaluate the match-end condition via `MatchScorer`: if the match is over, `reduce` SHALL advance along the legal `HandScoring → MatchComplete` edge and record the `MatchResult`; otherwise `reduce` SHALL rest at `HandScoring` awaiting the next `deal`.

#### Scenario: DeclareTrump drives through Melding to TrickPlay (Partners)

- **WHEN** the contract winner declares trump for `SINGLE_DECK_PARTNERS`
- **THEN** the trump is recorded, all seats' melds are computed (Partners melds at all seats), and the phase advances through `Melding` to settle at `TrickPlay` (Partners skips `Bury`)

#### Scenario: DeclareTrump drives through Melding to Bury (Cutthroat)

- **WHEN** the contract winner declares trump for `SINGLE_DECK_CUTTHROAT`
- **THEN** the trump is recorded, only the bidder's meld is computed (Cutthroat melds bidder-only), and the phase advances through `Melding` to settle at `Bury` with the bidder set to act

#### Scenario: A valid bury advances Bury to a seeded TrickPlay

- **WHEN** the bidder submits a legal `bury` at a resting `Bury` for `SINGLE_DECK_CUTTHROAT`
- **THEN** the buried cards leave the bidder's hand, the phase advances to `TrickPlay`, and the bidder is set to lead the first trick with an empty current trick

#### Scenario: TrickPlay self-loops until hands empty

- **WHEN** a trick is resolved during `TrickPlay` and at least one seat still holds cards
- **THEN** the phase remains `TrickPlay` and a fresh trick begins, led by the trick winner

#### Scenario: TrickPlay advances to a scored HandScoring when hands empty

- **WHEN** the final trick of the hand is resolved during `TrickPlay` (all hands now empty)
- **THEN** the phase advances along the legal-transition edge to `HandScoring`, the `HandScorer` result is recorded and its lines appended to the score pad, and (when the match is not over) the lifecycle rests at `HandScoring`

#### Scenario: Buried counters are credited at HandScoring

- **WHEN** a Cutthroat hand reaches `HandScoring` with cards in the buried pile
- **THEN** the buried cards' counter values are summed and credited to the bidding side as `buriedCounters` in the `HandScorer` result

#### Scenario: HandScoring continues the match for another hand

- **WHEN** the hand score is computed at `HandScoring` and `MatchScorer` reports the match is not over
- **THEN** the lifecycle rests at `HandScoring` with the score pad and the updated hands-made-as-bidder counter recorded, and the next `deal` starts a new hand with the dealer rotated

#### Scenario: HandScoring ends the match at MatchComplete

- **WHEN** the hand score is computed at `HandScoring` and `MatchScorer` reports the match is over
- **THEN** the phase advances along the legal `HandScoring → MatchComplete` edge, the `MatchResult` (standings + rating basis) is recorded in public state, and the lifecycle rests terminally at `MatchComplete`

#### Scenario: An illegal transition is never taken

- **WHEN** the next-phase advance is computed
- **THEN** `reduce` only follows edges the legal-transition table reports as legal, skipping bracketed phases the active variant disables

### Requirement: Public and private state separation

`State` SHALL separate per-seat private data (each seat's `Hand`, the unrevealed widow, the bidder's buried pile) from public data (phase, turn, auction standing, the recorded winning `Bid`, the declared trump, the revealed widow, each melding seat's recorded meld, the in-progress trick, the resolved tricks, the per-seat captured-counter / tricks-taken tally, the scored hand result, and the running score pad) so the Match Service can mechanically derive a per-seat filtered view. The buried pile SHALL be private (buried cards are face-down, "Single-Deck Cutthroat" §6). Recorded melds and trick plays SHALL be public (meld is laid face-up, "Single-Deck Partners" §6; each play is face-up, §7); the scored hand result and the running score pad SHALL be public (§8/§9, the table sees the score). The engine SHALL structure the state for filtering; performing the filtering is Match Runtime's responsibility ("Match Runtime" §3).

#### Scenario: Private and public regions are distinguishable

- **WHEN** a `State` mid-hand is inspected
- **THEN** each seat's hand, the unrevealed widow, and the buried pile are addressable as private, while the phase, whose-turn, auction bids, the declared trump, the revealed widow, recorded melds, the current trick, resolved tricks, the capture tally, the hand result, and the score pad are addressable as public

#### Scenario: Recorded melds are visible to the table

- **WHEN** the phase has advanced past `Melding`
- **THEN** each melding seat's computed meld set and total are present in public state

#### Scenario: The scored hand result is visible at HandScoring

- **WHEN** the lifecycle has computed the hand score and rests at `HandScoring`
- **THEN** the per-side hand result (the scored lines and the made/set verdict) and the running score pad with cumulative-by-side totals are present in public state

#### Scenario: The trick in progress is visible to the table

- **WHEN** one or more cards have been played into the current trick during `TrickPlay`
- **THEN** the in-progress trick (its led suit and ordered plays) is present in public state
