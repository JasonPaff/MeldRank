# trick-resolver

## Purpose

Defines the pure `TrickResolver` in `@meldrank/engine` that determines the winning seat of a completed trick and the counter points it captures, per "Single-Deck Partners" §7. It applies the locked card ranking, the highest-trump / highest-led-suit precedence, and the first-played tie rule, and sums per-rank counter values for the trick's capture total.

## Requirements

### Requirement: Trick winner resolution

`@meldrank/engine` SHALL expose a pure `TrickResolver(trick, trump)` that returns the winning seat of a completed trick, per "Single-Deck Partners" §7: the highest trump wins; if no trump was played, the highest card of the **led** suit wins; cards neither trump nor of the led suit cannot win. The card ranking SHALL be the locked order `A > 10 > K > Q > J > 9`. On two identical winning cards the one played **first** wins (`identicalCardTie: 'first-played-wins'`). The resolver SHALL NOT mutate its inputs and SHALL be deterministic.

#### Scenario: Highest trump wins

- **WHEN** a completed trick contains one or more trumps
- **THEN** the seat that played the highest-ranked trump wins

#### Scenario: No trump — highest of the led suit wins

- **WHEN** a completed trick contains no trump
- **THEN** the seat that played the highest-ranked card of the led suit wins, and off-led-suit cards cannot win

#### Scenario: Identical winning cards — first played wins

- **WHEN** the two highest cards of the deciding suit are identical in rank and suit (the two copies)
- **THEN** the seat that played its copy earlier in the trick wins

### Requirement: Captured counters of a trick

`TrickResolver` (or a companion in the same module) SHALL compute the counter points a completed trick captures, summing the per-rank counter values from `scoring.counters` (A=11, 10=10, K=4, Q=3, J=2, 9=0 in the canonical table) over all cards in the trick. The last-trick bonus is NOT part of this per-trick total — it is applied by the lifecycle driver on the final trick.

#### Scenario: A trick's counters total its cards' counter values

- **WHEN** the captured counters of a completed trick are computed against the canonical counter values
- **THEN** the result equals the sum of each played card's counter value (e.g. an A, a 10, and two 9s total 21)

#### Scenario: A counter-less trick captures zero

- **WHEN** every card in a completed trick is a 9 (counter value 0)
- **THEN** the captured counters total 0
