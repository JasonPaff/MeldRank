# game-domain-model

## Purpose

Defines the core, pure-data domain entities of the MeldRank pinochle engine — cards, decks, seats/teams, hands, bids/contracts, melds, tricks, and score pads — as expressive value types with constructors and helpers but no rules logic. These types form the vocabulary that later engine modules (Dealer, AuctionManager, MeldDetector, etc.) read and produce, per "Game Engine — Abstract Model" §4.

## Requirements

### Requirement: Card entity

`@meldrank/engine` SHALL define a `Card` as `{ rank, suit, copyIndex }` per "Game Engine — Abstract Model" §4, where `rank` is one of the six pinochle ranks (A, 10, K, Q, J, 9), `suit` is one of the four suits, and `copyIndex` distinguishes the two physical copies of the same rank+suit. Two cards with identical rank and suit but different `copyIndex` SHALL be distinct objects that compare as equal in value but not in identity.

#### Scenario: The two copies of a card are distinct but value-equal

- **WHEN** the two `9♦` cards (copyIndex 0 and 1) are compared
- **THEN** a value-equality helper reports the same value, and an identity/key helper reports them as distinct cards

#### Scenario: Card rank and suit are constrained

- **WHEN** a card is constructed with a rank or suit outside the pinochle set
- **THEN** the type system rejects it (the rank/suit are union-typed, not arbitrary strings)

### Requirement: Deck construction from a deck spec

`@meldrank/engine` SHALL build a `Deck` as an ordered multiset from a deck spec derived from the `VariantDefinition`. For the 48-card single-deck spec the engine SHALL produce exactly two copies each of the six ranks in all four suits (48 cards), and for the 80-card double-deck spec it SHALL produce the documented double-deck multiset. Deck construction SHALL be pure and deterministic — no shuffling occurs here (shuffle is owned by Match Runtime).

#### Scenario: 48-card single deck has the correct composition

- **WHEN** a deck is built from the single-deck spec
- **THEN** it contains exactly 48 cards: two copies of each of A, 10, K, Q, J, 9 in each of the four suits

#### Scenario: Deck construction is deterministic

- **WHEN** the deck is built twice from the same spec
- **THEN** both decks contain the same cards in the same order

### Requirement: Seat and team membership

`@meldrank/engine` SHALL define a `Seat` as a table position carrying team membership or none, per §4. A `VariantDefinition` with partnerships SHALL yield seats grouped into teams (e.g. Partners: opposite seats partnered); a free-for-all variant SHALL yield seats with no team. The number of seats SHALL equal the variant's player count.

#### Scenario: Partners variant produces two opposite partnerships

- **WHEN** seats are derived for the `SINGLE_DECK_PARTNERS` variant
- **THEN** there are 4 seats grouped into 2 teams with partners seated opposite

#### Scenario: Cutthroat variant produces teamless seats

- **WHEN** seats are derived for the `SINGLE_DECK_CUTTHROAT` variant
- **THEN** there are 3 seats, each with no team membership

### Requirement: Hand, Bid/Contract, Meld, Trick, and ScorePad entities

`@meldrank/engine` SHALL define the remaining core domain entities per §4 as pure data types with constructors/helpers and no rules logic: `Hand` (the cards a seat holds), `Bid` and `Contract` (auction result: winning seat, value, declared trump), `Meld` (`{ type, cards[], value, class }`), `Trick` (led suit, ordered plays, resolved winner), and `ScorePad` (per-side running totals, per-hand and cumulative). These types SHALL be expressive enough to represent any state the later engine modules produce, without encoding how those states are computed.

#### Scenario: Entities are pure data with no behavior dependencies

- **WHEN** the domain-model module is imported
- **THEN** it exposes the entity types and simple constructors/helpers only, and pulls in no rules-logic modules (Dealer, AuctionManager, MeldDetector, etc.)

#### Scenario: A Contract captures bidder, value, and trump

- **WHEN** a `Contract` is constructed from a winning seat, a bid value, and a declared trump suit
- **THEN** all three are retrievable from the contract and the trump is one of the four suits

#### Scenario: A Meld records its class for cross-class reuse rules

- **WHEN** a `Meld` is constructed
- **THEN** it carries its `type`, contributing `cards`, `value`, and meld `class` (A, B, or C) so later scoring can enforce within-class no-reuse and cross-class reuse
