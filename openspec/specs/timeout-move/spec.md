# timeout-move

## Purpose

Defines the pure `TimeoutMove(state) → PlayerIntent | null` function in `@meldrank/engine`, per "Game Engine — Abstract Model" §5 / Ruling 5. It computes the deterministic forced move for the seat-to-act when that seat's clock expires, so a timeout resolves to a reproducible, legal intent that the `reduce` state container applies through its normal guarded path.

## Requirements

### Requirement: Timeout-move computation

`@meldrank/engine` SHALL expose a pure `TimeoutMove(state) → PlayerIntent | null` per "Game Engine — Abstract Model" §5. Given the current `State`, it SHALL compute the deterministic forced move for the seat currently to act (`state.public.seatToAct`) when that seat's clock expires, returning the forced `PlayerIntent`, or `null` when no forced move is defined for the current phase or no seat is to act. `TimeoutMove` SHALL NOT mutate its input and SHALL be deterministic (the same `state` always yields a deep-equal result), so the forced move is reproducible from the replay. It SHALL read only plain data and the `VariantDefinition` type (zero runtime dependencies).

#### Scenario: TimeoutMove is pure and deterministic

- **WHEN** `TimeoutMove` is called twice with the same `state`
- **THEN** the two results are deep-equal and the input `state` is not mutated

#### Scenario: No forced move when no seat is to act

- **WHEN** `TimeoutMove` is called on a `state` whose `seatToAct` is `null` (e.g. a resting `HandScoring` or a terminal `MatchComplete`)
- **THEN** it returns `null`

### Requirement: Pass-legal phases force a pass

In any phase where passing is a legal action, `TimeoutMove` SHALL return a `pass` intent for the seat to act, per "Game Engine — Abstract Model" Ruling 5. The driven pass-legal phase is `Auction`; future discard-pass phases follow the same rule.

#### Scenario: A timeout during the auction forces a pass

- **WHEN** `TimeoutMove` is called while the phase is `Auction` and a seat is to act
- **THEN** it returns a `pass` intent naming that seat

### Requirement: Card-play phases force the lowest-value legal card

In a card-play phase (`TrickPlay`), `TimeoutMove` SHALL return a `playCard` intent for the **lowest-value legal card** the seat may play, drawn from the `LegalPlayValidator` set for the in-progress trick, per "Game Engine — Abstract Model" Ruling 5. Card value SHALL be the locked rank ordering `A > 10 > K > Q > J > 9` (the lowest-value card is the weakest rank, regardless of whether it is trump). Ties SHALL be broken by a fixed ordering: first by suit (the suit's index in the variant deck's suit order), then by `copyIndex`. The chosen card SHALL always be a member of the `LegalPlayValidator` set, so the forced play is legal under the same rules a human play is checked against.

#### Scenario: A timeout while leading plays the weakest card

- **WHEN** `TimeoutMove` is called while the phase is `TrickPlay`, the seat to act is the leader (the trick is empty), and the seat holds cards of varying rank
- **THEN** it returns a `playCard` intent naming the lowest-rank card in the seat's hand (`9` before `J` before `Q` before `K` before `10` before `A`), ties broken by suit order then `copyIndex`

#### Scenario: A timeout when following suit plays the lowest legal card

- **WHEN** `TimeoutMove` is called while the phase is `TrickPlay` and the `LegalPlayValidator` restricts the seat to a subset of its hand (e.g. must follow suit, or must beat the current winner)
- **THEN** the returned `playCard` names the lowest-value card **within that legal subset**, never a card excluded by the validator

#### Scenario: The forced card is always legal

- **WHEN** a `playCard` produced by `TimeoutMove` during `TrickPlay` is itself reduced
- **THEN** it is accepted by the trick-play guard (it is a card the seat holds and a member of the legal set)

### Requirement: Phases without a defined forced move

For any phase that has no Ruling 5 forced move — notably `DeclareTrump`, and any non-acting phase (`Dealing`, `WidowReveal`, `Melding`, `HandScoring`, `MatchComplete`) — `TimeoutMove` SHALL return `null` rather than invent a move. The forced-declaration policy for a `DeclareTrump` timeout is outside the scope of Ruling 5 and is deferred to a dedicated ruling.

#### Scenario: DeclareTrump has no forced move yet

- **WHEN** `TimeoutMove` is called while the phase is `DeclareTrump`
- **THEN** it returns `null` (no forced declaration is invented)
