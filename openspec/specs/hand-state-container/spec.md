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

`reduce` SHALL validate each event against the current lifecycle phase and reject any event not legal in that phase, returning the state unchanged (or a typed rejection) without mutation. This change drives the `DeclareTrump → Melding → [Bury] → TrickPlay` slice: on entering `Melding` the engine computes and records each melding seat's meld deterministically (there is no player meld intent — meld is engine-computed, §3 Ruling 1) and advances. Events belonging to phases not yet wired (`playCard`, and any event in `Bury` / `TrickPlay` and later) SHALL be accepted by the type but rejected by the guard until their phases are implemented.

#### Scenario: An event illegal for the current phase is rejected

- **WHEN** a `bid` event is reduced while the phase is `Dealing`
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal event drives the Dealing phase

- **WHEN** a `deal` event carrying a seed is reduced while the phase is `Dealing`
- **THEN** per-seat hands and the widow are populated and the phase advances to `Auction`

#### Scenario: declareTrump is driven and Melding is applied

- **WHEN** a `declareTrump` from the contract winner naming a valid suit is reduced while the phase is `DeclareTrump`
- **THEN** the trump is recorded, each melding seat's meld is computed and recorded, and the phase advances past `Melding` to the variant's next active phase

#### Scenario: A later-phase event is not yet driven

- **WHEN** a `playCard` event is reduced in this change's wired slice
- **THEN** it is rejected by the phase guard (its phase logic arrives in a later change) and the state is unchanged

### Requirement: Lifecycle advancement via the transition table

When an event concludes a phase, `reduce` SHALL advance the phase marker to the next phase using the foundation's legal-transition table and the variant's active path (`resolveActivePath`), skipping bracketed phases the variant disables. `reduce` SHALL NOT advance along a transition the table reports as illegal. Where an enabled phase has no driving player event (`WidowReveal`, `Melding`), `reduce` SHALL apply it deterministically within the concluding step and pass through to the next resting phase rather than rest on it.

#### Scenario: DeclareTrump drives through Melding to TrickPlay (Partners)

- **WHEN** the contract winner declares trump for `SINGLE_DECK_PARTNERS`
- **THEN** the trump is recorded, all seats' melds are computed (Partners melds at all seats), and the phase advances through `Melding` to settle at `TrickPlay` (Partners skips `Bury`)

#### Scenario: DeclareTrump drives through Melding to Bury (Cutthroat)

- **WHEN** the contract winner declares trump for `SINGLE_DECK_CUTTHROAT`
- **THEN** the trump is recorded, only the bidder's meld is computed (Cutthroat melds bidder-only), and the phase advances through `Melding` to settle at `Bury`

#### Scenario: An illegal transition is never taken

- **WHEN** the next-phase advance is computed
- **THEN** `reduce` only follows edges the legal-transition table reports as legal, skipping bracketed phases the active variant disables

### Requirement: Deterministic replay fold

Folding `reduce` over an ordered event log from a given initial state SHALL be deterministic: the same initial state and the same event sequence SHALL always yield deep-equal resulting state, so a match reconstructs faithfully from its intent log plus revealed seeds ("Data Model" §5).

#### Scenario: Folding the same log twice is identical

- **WHEN** the same ordered event log (including the `deal` seed) is folded over `reduce` from the same initial state twice
- **THEN** the two resulting states are deep-equal

### Requirement: Public and private state separation

`State` SHALL separate per-seat private data (each seat's `Hand`, the unrevealed widow) from public data (phase, turn, auction standing, the recorded winning `Bid`, the declared trump, the revealed widow, and each melding seat's recorded meld) so the Match Service can mechanically derive a per-seat filtered view. Recorded melds SHALL be public (meld is laid face-up for the table, "Single-Deck Partners" §6). The engine SHALL structure the state for filtering; performing the filtering is Match Runtime's responsibility ("Match Runtime" §3).

#### Scenario: Private and public regions are distinguishable

- **WHEN** a `State` mid-hand is inspected
- **THEN** each seat's hand and the unrevealed widow are addressable as private, while the phase, whose-turn, auction bids, the declared trump, the revealed widow, and recorded melds are addressable as public

#### Scenario: Recorded melds are visible to the table

- **WHEN** the phase has advanced past `Melding`
- **THEN** each melding seat's computed meld set and total are present in public state
