# standard-meld-table

## Purpose

Defines the Standard single-deck meld table in `@meldrank/shared` — the canonical meld definitions and point values shared by both ranked rulesets ("Single-Deck Partners" §6; "Single-Deck Cutthroat" §7) — as plain validated data resolved from `meldTableId: 'standard-single-deck'`, consumable by `@meldrank/engine` as types/data without adding a runtime dependency. It enumerates the exact Class A, B, and C meld values used by the MeldDetector.

## Requirements

### Requirement: Standard single-deck meld table data

`@meldrank/shared` SHALL provide the Standard single-deck meld table — the canonical meld definitions and point values shared by both ranked rulesets ("Ranked Ruleset — Single-Deck Partners" §6; "Single-Deck Cutthroat" §7 inherits it identically) — as plain validated data resolved from `meldTableId: 'standard-single-deck'`. The table SHALL be consumable by `@meldrank/engine` as types/data without introducing any runtime dependency into the engine. The `standard-double-deck` table's values remain reserved and out of scope ("Game Engine — Abstract Model" §3 Ruling 3).

#### Scenario: The table is resolvable by its id

- **WHEN** the meld table for `meldTableId: 'standard-single-deck'` is requested
- **THEN** the Standard single-deck meld table is returned, carrying every Class A, B, and C meld definition with its point value

#### Scenario: The double-deck table is not yet populated

- **WHEN** the meld table for `meldTableId: 'standard-double-deck'` is requested
- **THEN** the reserved-but-deferred status is honored (no populated value set is returned), consistent with §3 Ruling 3

### Requirement: Class A meld values (runs, marriages, dix)

The table SHALL define the Class A melds with these exact values: Run/Flush (A 10 K Q J of trump) = 150; Double Run (both copies of the run) = 1500; Royal Marriage (K + Q of trump) = 40; Marriage (K + Q of one non-trump suit) = 20; Dix (9 of trump) = 10 each. Each Class A meld definition SHALL carry its `class` as `A`.

#### Scenario: Run and royal marriage values

- **WHEN** the Class A definitions are read
- **THEN** a Run scores 150, a Double Run scores 1500, a Royal Marriage scores 40, a non-trump Marriage scores 20, and a Dix scores 10

### Requirement: Class B meld values (pinochles)

The table SHALL define the Class B melds with these exact values: Pinochle (Q♠ + J♦) = 40; Double Pinochle (both Q♠ + both J♦) = 300. Each Class B meld definition SHALL carry its `class` as `B`.

#### Scenario: Pinochle values

- **WHEN** the Class B definitions are read
- **THEN** a Pinochle scores 40 and a Double Pinochle scores 300

### Requirement: Class C meld values (arounds)

The table SHALL define the Class C "around" melds (one of the named rank in each of the four suits) with these exact single and double (all eight copies) values: Aces around 100 / 1000; Kings around 80 / 800; Queens around 60 / 600; Jacks around 40 / 400. Each Class C meld definition SHALL carry its `class` as `C`.

#### Scenario: Arounds single and double values

- **WHEN** the Class C definitions are read
- **THEN** Aces around scores 100 (double 1000), Kings 80 (800), Queens 60 (600), and Jacks 40 (400)
