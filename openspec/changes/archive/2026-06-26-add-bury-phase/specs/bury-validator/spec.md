## ADDED Requirements

### Requirement: Buryable-card eligibility

`@meldrank/engine` SHALL expose a pure `buryableCards(hand, melds, trump, restrictions) → Card[]` that returns the subset of the bidder's hand eligible to be buried under the variant's bury restrictions, per "Single-Deck Cutthroat / Auction Pinochle" §6 and Ruling 5. It SHALL apply each restriction in `dealing.bury.restrictions`: `no-melded` excludes any card (by identity — rank, suit, and `copyIndex`) that appears in the bidder's recorded `melds`; `no-trump` excludes any card of the `trump` suit; `no-dix` excludes the `9` of the `trump` suit. A card is buryable only if it violates none of the active restrictions. The function SHALL mutate nothing, be deterministic, and read only plain data (zero runtime dependencies — `Suit`/`BuryRestriction` are type-only).

#### Scenario: Melded, trump, and dix cards are excluded

- **WHEN** `buryableCards` is called for a bidder whose hand contains cards used in meld, cards of the trump suit (including the trump `9`), and other cards, with restrictions `no-melded`, `no-trump`, `no-dix`
- **THEN** the returned set excludes every melded card, every trump card, and the trump `9`, and includes the remaining cards

#### Scenario: An unused copy of a melded value is still buryable

- **WHEN** the bidder holds two copies of a non-trump card and only one copy is used in a meld
- **THEN** the copy used in the meld is excluded by `no-melded` but the unused copy (distinct `copyIndex`) remains buryable

#### Scenario: Eligibility is deterministic and non-mutating

- **WHEN** `buryableCards` is called twice with the same inputs
- **THEN** the two results are deep-equal and the input hand and melds are not mutated

### Requirement: Legal bury composition

A proposed bury SHALL be legal only when it names exactly `dealing.bury.size` cards, every named card is currently held by the bidder (resolved by identity), the named cards are all distinct, and every named card is a member of the `buryableCards` set. Any proposed bury that is the wrong size, names a card the bidder does not hold, repeats a card, or names an ineligible card SHALL be illegal.

#### Scenario: A correctly composed bury is legal

- **WHEN** the bidder proposes exactly `bury.size` distinct cards, all held and all in the `buryableCards` set
- **THEN** the bury is legal

#### Scenario: A bury naming an ineligible card is illegal

- **WHEN** the bidder proposes a bury that includes a trump card, a melded card, the trump dix, or a card not held
- **THEN** the bury is illegal

#### Scenario: A wrong-sized or duplicate bury is illegal

- **WHEN** the bidder proposes fewer or more than `bury.size` cards, or repeats the same card
- **THEN** the bury is illegal
