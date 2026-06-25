# hand-lifecycle-state-machine

## Purpose

Defines the closed set of hand-lifecycle phases for a pinochle hand and the legal transitions between them, per "Game Engine — Abstract Model" §2. This capability supplies the state vocabulary and transition structure only — including how the active `VariantDefinition` gates optional (bracketed) phases — while the logic that drives each phase arrives in later engine changes.

## Requirements

### Requirement: Hand-lifecycle states

`@meldrank/engine` SHALL define the hand-lifecycle states per "Game Engine — Abstract Model" §2: `Dealing`, `Auction`, `WidowReveal`, `DeclareTrump`, `Passing`, `Melding`, `Bury`, `TrickPlay`, `HandScoring`, and `MatchComplete`. The states SHALL be a closed, typed set (e.g. a discriminated union or string-literal union) usable as the phase marker on a hand's state. This change provides the state vocabulary and transition structure only; the logic that drives each phase (Dealer, AuctionManager, MeldDetector, …) arrives in later engine changes.

#### Scenario: The state set is exactly the documented lifecycle

- **WHEN** the set of defined lifecycle states is enumerated
- **THEN** it equals exactly the ten states named in §2, with no extras and none missing

### Requirement: Legal transition table

`@meldrank/engine` SHALL define the legal transitions between lifecycle states matching the §2 machine: `Dealing → Auction → [WidowReveal] → DeclareTrump → [Passing] → Melding → [Bury] → TrickPlay → HandScoring`, where `HandScoring` loops back to `Dealing` for the next hand or terminates at `MatchComplete`, and `TrickPlay` loops on itself until hands are empty. A helper SHALL report whether a given transition is legal. Transitions into bracketed (optional) states SHALL only be legal when that state is enabled by the active `VariantDefinition`.

#### Scenario: A documented transition is legal

- **WHEN** the legality of `Dealing → Auction` is checked
- **THEN** the helper reports it as legal

#### Scenario: An undocumented transition is rejected

- **WHEN** the legality of `Auction → TrickPlay` (skipping DeclareTrump) is checked
- **THEN** the helper reports it as illegal

#### Scenario: HandScoring branches to next hand or match end

- **WHEN** a hand reaches `HandScoring`
- **THEN** transitions to both `Dealing` (next hand) and `MatchComplete` are legal, and the choice between them is left to later logic

### Requirement: Optional phases gated by the variant

For a given `VariantDefinition`, the engine SHALL compute which bracketed phases (`WidowReveal`, `Passing`, `Bury`) are active and SHALL route transitions to skip any disabled phase. The Partners variant SHALL skip all three (no widow, no passing, no bury); the Cutthroat variant SHALL include `WidowReveal` and `Bury` but skip `Passing`.

#### Scenario: Partners variant skips widow, passing, and bury

- **WHEN** the active path is computed for `SINGLE_DECK_PARTNERS`
- **THEN** the legal sequence is `Dealing → Auction → DeclareTrump → Melding → TrickPlay → HandScoring`, with `WidowReveal`, `Passing`, and `Bury` absent

#### Scenario: Cutthroat variant includes widow reveal and bury but not passing

- **WHEN** the active path is computed for `SINGLE_DECK_CUTTHROAT`
- **THEN** the legal sequence is `Dealing → Auction → WidowReveal → DeclareTrump → Melding → Bury → TrickPlay → HandScoring`, with `Passing` absent
