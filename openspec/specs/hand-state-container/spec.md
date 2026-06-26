# hand-state-container

## Purpose

Defines the pure `reduce(state, event): State` state container in `@meldrank/engine` and its serializable `State` shape, per "Match Runtime" §3/§4 and "Data Model" §5. It establishes the closed event union, phase-guarded application, transition-table-driven lifecycle advancement, deterministic replay, and the public/private separation that lets the Match Service derive per-seat views. This change wires only the `Dealing → Auction` slice.

## Requirements

### Requirement: Pure reduce state container

`@meldrank/engine` SHALL expose `reduce(state, event): State` as a pure function: it SHALL NOT perform I/O, SHALL NOT mutate its inputs, and SHALL be deterministic (same `state` and `event` always yield the same result). `State` SHALL be a plain, serializable value — structurally cloneable and JSON round-trippable, carrying no class instances with behavior — so it can be folded for replay, filtered per seat, and mapped to a Colyseus schema, per "Match Runtime" §3/§4 and "Data Model" §5.

#### Scenario: reduce does not mutate its input

- **WHEN** `reduce(state, event)` is called
- **THEN** the passed-in `state` is unchanged after the call and the result is a distinct value

#### Scenario: State round-trips through serialization

- **WHEN** a `State` is serialized to JSON and parsed back
- **THEN** the parsed value deep-equals the original (no information lost, no behavior-bearing fields)

### Requirement: Closed event union

The engine SHALL define `Event` as a closed, typed union of the locked player intents (`bid`, `pass`, `declareTrump`, `playCard`, per "API Surface" §4) and the system events (`deal`, carrying the shuffle seed; `timeout`). Intent payload _types_ SHALL be consumed from `@meldrank/shared` as types only; no Zod or runtime dependency enters the engine.

#### Scenario: The event kinds are exactly the documented set

- **WHEN** the set of `Event` kinds is enumerated
- **THEN** it equals exactly `bid`, `pass`, `declareTrump`, `playCard`, `deal`, and `timeout`, with no extras and none missing

### Requirement: Phase-guarded event application

`reduce` SHALL validate each event against the current lifecycle phase and reject any event not legal in that phase, returning the state unchanged (or a typed rejection) without mutation. This change drives the `Dealing → Auction → [WidowReveal] → DeclareTrump → (ready for Melding)` slice: `declareTrump` is now driven during `DeclareTrump`; events belonging to phases not yet wired (`playCard`, and any event in `Melding` and later) SHALL be accepted by the type but rejected by the guard until their phases are implemented.

#### Scenario: An event illegal for the current phase is rejected

- **WHEN** a `bid` event is reduced while the phase is `Dealing`
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal event drives the Dealing phase

- **WHEN** a `deal` event carrying a seed is reduced while the phase is `Dealing`
- **THEN** per-seat hands and the widow are populated and the phase advances to `Auction`

#### Scenario: declareTrump is driven during its phase

- **WHEN** a `declareTrump` from the contract winner naming a valid suit is reduced while the phase is `DeclareTrump`
- **THEN** the trump is recorded and the phase advances to the variant's next active phase (no longer rejected as not-yet-driven)

#### Scenario: A later-phase event is not yet driven

- **WHEN** a `playCard` event is reduced in this change's wired slice
- **THEN** it is rejected by the phase guard (its phase logic arrives in a later change) and the state is unchanged

### Requirement: Lifecycle advancement via the transition table

When an event concludes a phase, `reduce` SHALL advance the phase marker to the next phase using the foundation's legal-transition table and the variant's active path (`resolveActivePath`), skipping bracketed phases the variant disables. `reduce` SHALL NOT advance along a transition the table reports as illegal. Where an enabled bracketed phase has no driving event (`WidowReveal`), `reduce` SHALL pass through it deterministically within the concluding step rather than rest on it.

#### Scenario: A concluded auction advances and DeclareTrump is driven (Partners)

- **WHEN** the auction concludes with a winning bid for `SINGLE_DECK_PARTNERS` and the contract winner then declares trump
- **THEN** the winning `Bid` is recorded, the phase advances to `DeclareTrump` (Partners skips `WidowReveal`), and the subsequent `declareTrump` advances to `Melding`

#### Scenario: Bracketed WidowReveal is passed through (Cutthroat)

- **WHEN** the auction concludes for `SINGLE_DECK_CUTTHROAT`
- **THEN** the widow is revealed and the phase settles at `DeclareTrump` (the enabled `WidowReveal` hop is honored in the transition table and passed through deterministically, not rested on)

### Requirement: Deterministic replay fold

Folding `reduce` over an ordered event log from a given initial state SHALL be deterministic: the same initial state and the same event sequence SHALL always yield deep-equal resulting state, so a match reconstructs faithfully from its intent log plus revealed seeds ("Data Model" §5).

#### Scenario: Folding the same log twice is identical

- **WHEN** the same ordered event log (including the `deal` seed) is folded over `reduce` from the same initial state twice
- **THEN** the two resulting states are deep-equal

### Requirement: Public and private state separation

`State` SHALL separate per-seat private data (each seat's `Hand`, the unrevealed widow) from public data (phase, turn, auction standing, the recorded winning `Bid`, the declared trump, and the revealed widow) so the Match Service can mechanically derive a per-seat filtered view. The engine SHALL structure the state for filtering; performing the filtering is Match Runtime's responsibility ("Match Runtime" §3).

#### Scenario: Private and public regions are distinguishable

- **WHEN** a `State` mid-hand is inspected
- **THEN** each seat's hand and the unrevealed widow are addressable as private, while the phase, whose-turn, auction bids, the declared trump, and the revealed widow are addressable as public
