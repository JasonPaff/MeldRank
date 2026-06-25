## ADDED Requirements

### Requirement: Deterministic seeded deal

`@meldrank/engine` SHALL expose a Dealer — `deal(deckSpec, handSize, widowSize, rng) → { hands, widow }` per "Game Engine — Abstract Model" §5 — that distributes a deck into one `Hand` per seat plus a widow. The deal SHALL be pure and deterministic: the same deck spec and the same `rng` (seeded source) SHALL always produce the same hands and widow. The engine SHALL own the shuffle algorithm (a Fisher–Yates over the injected `rng`) and the deal slice; the `rng`'s entropy, CSPRNG keying, and commit–reveal are supplied by Match Runtime / Anti-Cheat and are out of engine scope ("Match Runtime" §8, "Anti-Cheat" §2). The Dealer SHALL NOT introduce any runtime dependency.

#### Scenario: The same seed deals identically

- **WHEN** the Dealer is run twice with the same deck spec and the same seeded `rng`
- **THEN** both runs produce identical hands and an identical widow

#### Scenario: Different seeds deal differently

- **WHEN** the Dealer is run with two different `rng` seeds over the same deck spec
- **THEN** the resulting deals differ (the shuffle consumes the injected randomness)

### Requirement: Deal-size invariant

The Dealer SHALL enforce `handSize × playerCount + widowSize === deck size`. A configuration that violates the invariant SHALL be rejected rather than producing a partial or overflowing deal.

#### Scenario: Partners deals four full hands and no widow

- **WHEN** the Dealer runs for `SINGLE_DECK_PARTNERS` (48 cards, 4 players, hand size 12, widow 0)
- **THEN** it produces 4 hands of 12 cards each and an empty widow (12 × 4 + 0 = 48)

#### Scenario: Cutthroat deals three hands plus a three-card widow

- **WHEN** the Dealer runs for `SINGLE_DECK_CUTTHROAT` (48 cards, 3 players, hand size 15, widow 3)
- **THEN** it produces 3 hands of 15 cards each and a 3-card widow (15 × 3 + 3 = 48)

#### Scenario: A size mismatch is rejected

- **WHEN** the Dealer is asked to deal with sizes that do not sum to the deck size
- **THEN** it rejects the configuration instead of dealing

### Requirement: Conservation of the deck

The union of all dealt hands plus the widow SHALL equal the built deck exactly as a multiset — every card dealt comes from the deck exactly once, with no card lost or duplicated.

#### Scenario: Hands plus widow reconstitute the deck

- **WHEN** a deal completes
- **THEN** the multiset of all hand cards plus widow cards equals the multiset of the deck built from the deck spec
