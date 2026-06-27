## ADDED Requirements

### Requirement: Pre-deal commit broadcast

Before each hand is dealt, the room SHALL produce a server seed commitment via `@meldrank/shared/fairness` `commit` and broadcast the resulting `commit` hash to every seated connection. The room SHALL NOT reveal the server seed at commit time, and SHALL NOT deal the hand until the commit has been published to all seats.

#### Scenario: Commit precedes every deal

- **WHEN** the room is about to deal a hand
- **THEN** it broadcasts the hand's `commit` hash to all seated connections
- **AND** only then proceeds toward dealing

#### Scenario: Server seed is not revealed at commit

- **WHEN** the room broadcasts a hand's commit
- **THEN** the payload carries only the commitment hash, not the underlying server seed

### Requirement: Contribute-after-commit ordering

The room SHALL accept a seat's `clientSeed` contribution only after that hand's commit has been broadcast. A contribution arriving before the commit, or for a hand whose commit was not published, SHALL be rejected. Each seat's accepted contribution SHALL be a `SeatContribution` consumed by the fairness layer.

#### Scenario: Contribution before commit is rejected

- **WHEN** a seat submits a `clientSeed` contribution before the hand's commit has been broadcast
- **THEN** the room rejects the contribution

#### Scenario: Contribution after commit is accepted

- **WHEN** a seat submits a `clientSeed` contribution after the commit has been broadcast for that hand
- **THEN** the room records the contribution for use in seed assembly

### Requirement: Seed assembly drives the deal

After collecting seat contributions for a hand, the room SHALL assemble the deal seed with `assembleSeed`, substituting `fallbackContribution` for any seat that did not contribute, expand it through `rngFromSeed`, and feed the resulting `Rng` into the engine Dealer's injected `rng` seam. The deal SHALL be fully determined by the committed server seed plus the collected contributions, so the hand is independently reproducible from the eventual reveal.

#### Scenario: Absent contribution uses deterministic fallback

- **WHEN** a hand is dealt and one or more seats did not contribute a `clientSeed`
- **THEN** the room substitutes the deterministic `fallbackContribution` for each absent seat
- **AND** the deal proceeds without granting the server any additional control over the outcome

#### Scenario: Deal is seeded from the committed handshake

- **WHEN** the room deals a hand
- **THEN** the Dealer's `rng` is derived from `assembleSeed` over the committed server seed and the seat contributions for that hand
- **AND** the same inputs reproduce the identical deal
