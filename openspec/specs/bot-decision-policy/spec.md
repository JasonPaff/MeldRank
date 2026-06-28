# bot-decision-policy Specification

## Purpose

Defines the in-process bot "brain" that decides a seat's move behind the same human intent interface the room already uses: a pure, IO-free `brain(view, ctx) → PlayerIntent` function living in `@meldrank/bots`, deciding only from the seat's `FilteredView`, the v1 random-legal policy across bidding, trump choice, and trick play, a difficulty seam for later heuristic tiers, and the guarantee that bot randomness never threatens deterministic replay.

## Requirements

### Requirement: The bot brain decides behind the human intent interface

The bot decision logic SHALL live in a pure, in-process package (`@meldrank/bots`) and expose a brain function of the form `brain(view, ctx) → PlayerIntent`, where `view` is the seat's `FilteredView` (capability `seat-view-projector`) and `ctx` carries at least the acting seat index and a difficulty selector. The brain SHALL be a pure function of its inputs (any randomness supplied through an injected source in `ctx`), performing no IO, so it is exhaustively unit-testable and is the same code a future extracted Bot Worker would wrap with no change to the room protocol (Match Runtime — Design v1 §7 R5). The package SHALL depend only on `@meldrank/engine` and `@meldrank/shared`.

#### Scenario: The brain returns an intent for the acting seat

- **WHEN** the brain is called with a seat's filtered view and that seat as the acting seat
- **THEN** it returns a `PlayerIntent` whose seat is the acting seat

#### Scenario: The brain is pure and IO-free

- **WHEN** the brain is called twice with identical inputs and an identical injected randomness source
- **THEN** it returns the same intent
- **AND** it performs no network, disk, or clock access

### Requirement: The brain decides only from the filtered view

The brain SHALL decide using only the information present in the seat's `FilteredView` — its own hand and the public state a human in that seat would see — and SHALL NOT access hidden information (other seats' hands, undealt stock, or unrevealed widow before reveal). A bot SHALL therefore be exactly as informed as a human in the same seat.

#### Scenario: No hidden information is consulted

- **WHEN** the brain produces a decision
- **THEN** it references only fields present in the seat's filtered view
- **AND** it never reads another seat's concealed cards or undealt cards

### Requirement: The v1 brain chooses a legal move at every decision point

For v1 the brain SHALL implement a **random-legal** policy across all three pinochle decision surfaces — bidding (bid or pass), trump choice when it wins the contract, and trick play — by enumerating the moves the engine permits from the seat's filtered view (the engine's legality, the same one the optimistic client uses) and selecting one. The returned intent SHALL always be a legal move for the current phase, so the room never rejects a bot's intent under normal operation. The brain SHALL make no meld decision (meld is engine-computed). When the only legal action is forced, the brain SHALL return that action.

#### Scenario: A legal trick-play card is chosen

- **WHEN** it is the bot's turn to play a card
- **THEN** the brain returns a play intent for one of the engine-legal cards from its filtered hand

#### Scenario: A bidding decision is legal

- **WHEN** it is the bot's turn in the auction
- **THEN** the brain returns either a legal bid or a pass per the engine's legal options

#### Scenario: Trump is named when the contract is won

- **WHEN** the bot has won the contract and must declare trump
- **THEN** the brain returns a legal trump declaration

#### Scenario: A forced action is returned

- **WHEN** exactly one action is legal for the bot
- **THEN** the brain returns that action

### Requirement: Difficulty is a seam for later tiers

The brain interface SHALL accept a difficulty selector so later heuristic tiers (Easy / Medium / Hard, Bots & AI — Design v1 §5) can vary behavior without changing the room protocol or the brain's call site. The v1 random-legal brain MAY treat all difficulties identically; the seam SHALL exist so a heuristic brain can replace the policy behind the same interface.

#### Scenario: The brain accepts a difficulty without protocol change

- **WHEN** the brain is called with any supported difficulty selector
- **THEN** it returns a legal intent
- **AND** swapping in a heuristic policy requires no change to the room or the brain's call site

### Requirement: Bot randomness does not threaten replay determinism

Any randomness the brain uses (move selection now, difficulty noise later) SHALL NOT compromise deterministic match replay, because the room captures the bot's actual emitted intents in the ordered intent log (capability `match-persistence`). A match SHALL replay faithfully from the captured intents regardless of how the bot chose.

#### Scenario: Replay reconstructs bot moves from the intent log

- **WHEN** a completed match containing bot seats is replayed from its captured intent log
- **THEN** the bot's moves reconstruct exactly from the logged intents
- **AND** the replay does not depend on reproducing the brain's internal randomness
