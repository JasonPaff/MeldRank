# meld-detector

## ADDED Requirements

### Requirement: MeldDetector pure function

`@meldrank/engine` SHALL expose a pure `MeldDetector` per "Game Engine — Abstract Model" §5: `(hand, trump, meldTable) → { melds, total }`, where `melds` is the seat's complete set of scored melds (each a domain `Meld` with `type`, `cards`, `value`, and `class`) and `total` is their summed value. It SHALL NOT mutate its inputs, SHALL be deterministic, and SHALL add no runtime dependency to the engine (meld table consumed type-only/as data). Meld is engine-computed, not chosen — the function computes the **maximum** legal meld set and there is no under-meld option (§3 Ruling 1).

#### Scenario: Detector is pure and deterministic

- **WHEN** `MeldDetector` is called twice with the same hand, trump, and meld table
- **THEN** it returns deep-equal results and the input hand is unchanged after each call

#### Scenario: A hand with no melds scores zero

- **WHEN** a hand containing no valid meld combination is evaluated
- **THEN** `melds` is empty and `total` is 0

### Requirement: Maximum legal meld computed

The MeldDetector SHALL compute the seat's maximum-scoring legal meld set, recognizing every Class A, B, and C meld present in the hand and summing their values into `total`. Trump-dependent melds (Run, Royal Marriage, Dix) SHALL be recognized against the declared `trump`; the same five trump cards under a different trump SHALL NOT score a Run.

#### Scenario: A full meld hand totals correctly

- **WHEN** a hand containing a trump Run, a Pinochle, and Queens around is evaluated against that trump
- **THEN** all three melds are returned and `total` equals 150 + 40 + 60 = 250

#### Scenario: Run is recognized only against the declared trump

- **WHEN** a hand holds A 10 K Q J of ♠ and trump is ♥
- **THEN** no Run is scored from those ♠ cards (a Run requires the five cards to be in trump)

#### Scenario: Dix tracks the declared trump

- **WHEN** a hand holds the 9 of trump
- **THEN** a Dix worth 10 is scored; a 9 of a non-trump suit scores nothing

### Requirement: Cross-class reuse allowed, within-class reuse forbidden

A single physical card MAY contribute to at most one meld per class, across at most one Class A, one Class B, and one Class C meld ("Single-Deck Partners" §6 melding rules). The detector SHALL allow a card to be reused across different classes but SHALL NOT reuse the same physical card for two melds within the same class.

#### Scenario: A queen serves three classes at once

- **WHEN** Q♠ participates in a non-trump Marriage (Class A), a Pinochle (Class B), and Queens around (Class C)
- **THEN** all three melds are scored and the single Q♠ is counted in each

#### Scenario: One physical card is not reused within a class

- **WHEN** a hand holds a single K♥ and Q♥ (trump ♥) such that the K–Q could form only one Class A meld
- **THEN** that K–Q scores at most one Class A meld, not two

### Requirement: Run does not also score a royal marriage from its own K–Q

The K and Q of trump that form part of a Run SHALL NOT additionally score a Royal Marriage; scoring both a Run and a Royal Marriage SHALL require a second K or Q of trump ("Single-Deck Partners" §6).

#### Scenario: Single trump K–Q inside a run yields no extra royal marriage

- **WHEN** a hand holds exactly one A 10 K Q J of trump (one copy each) forming a Run
- **THEN** the Run scores 150 and no separate Royal Marriage is scored

#### Scenario: A second trump K or Q enables the royal marriage

- **WHEN** a hand holds the Run plus a second K of trump
- **THEN** both the Run (150) and a Royal Marriage (40) are scored

### Requirement: Double meld scores instead of the two singles

When both copies of a doubleable meld are present (Double Run, Double Pinochle, or a double "around"), the detector SHALL score the listed double bonus **instead of**, not in addition to, the two single melds ("Single-Deck Partners" §6).

#### Scenario: Double run replaces two single runs

- **WHEN** a hand holds both copies of A 10 K Q J of trump
- **THEN** a single Double Run worth 1500 is scored, not two Runs worth 300

#### Scenario: Double pinochle replaces two single pinochles

- **WHEN** a hand holds both Q♠ and both J♦
- **THEN** a single Double Pinochle worth 300 is scored, not two Pinochles worth 80
