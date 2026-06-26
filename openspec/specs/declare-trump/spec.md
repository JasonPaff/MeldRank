# declare-trump

## Purpose

Defines how `@meldrank/engine` drives the `DeclareTrump` lifecycle phase: validating the contract winner's `declareTrump` intent, recording the declared trump in public `State`, and advancing to the variant's next active phase, per "Match Runtime" §3/§4 and the canonical rulesets.

## Requirements

### Requirement: DeclareTrump phase driver

`@meldrank/engine` SHALL drive the `DeclareTrump` phase: a `declareTrump` intent SHALL be legal if and only if the current phase is `DeclareTrump`, the intent's `seat` equals the recorded contract winner's seat (`public.contract.seatIndex`), and the intent's `trump` is one of the suits in the active variant's deck. A legal declaration SHALL record the declared trump on the state and advance to the variant's next active phase; an illegal declaration SHALL be rejected with the state unchanged (typed rejection, no throw), consistent with `reduce`'s rejection contract. Per both canonical rulesets (`trumpDeclaredBy: 'bid-winner'`), there SHALL be no requirement that the declaring seat hold a card of the named suit.

#### Scenario: The contract winner declares a valid trump

- **WHEN** a `declareTrump` from the contract-winning seat naming one of the deck's suits is reduced during `DeclareTrump`
- **THEN** the declared trump is recorded on public state and the phase advances to the variant's next active phase (`Melding` for both canonical variants)

#### Scenario: A non-winner declaration is rejected

- **WHEN** a `declareTrump` from a seat other than the contract winner is reduced during `DeclareTrump`
- **THEN** the event is rejected and the state is unchanged (no trump recorded, phase not advanced)

#### Scenario: An unknown trump suit is rejected

- **WHEN** a `declareTrump` naming a suit not present in the active deck is reduced during `DeclareTrump`
- **THEN** the event is rejected and the state is unchanged

#### Scenario: declareTrump outside its phase is rejected

- **WHEN** a `declareTrump` is reduced while the phase is not `DeclareTrump` (e.g. `Auction`)
- **THEN** the event is rejected by the phase guard and the state is unchanged

### Requirement: Declared trump recorded on State

The engine SHALL record the declared trump in the **public** region of `State` (visible to all seats) as a suit value once a legal `declareTrump` is applied, and it SHALL be absent (null) before declaration. The recorded contract value and the recorded trump together SHALL be sufficient to assemble the domain `Contract` (`{ seatIndex, value, trump }`) for downstream consumers, without a side channel.

#### Scenario: Trump is public and unset before declaration

- **WHEN** the state is inspected after the auction concludes but before trump is declared
- **THEN** the recorded trump is null and addressable as public state

#### Scenario: Trump is readable after declaration

- **WHEN** a legal `declareTrump` has been applied
- **THEN** the declared suit is readable from public state alongside the recorded contract seat and value
