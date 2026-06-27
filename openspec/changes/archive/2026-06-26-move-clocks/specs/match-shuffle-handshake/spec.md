## MODIFIED Requirements

### Requirement: Contribute-after-commit ordering

The room SHALL accept a seat's `clientSeed` contribution only after that hand's commit has been broadcast and before the hand's **contribution window** has closed. A contribution arriving before the commit, for a hand whose commit was not published, or after the contribution window has closed SHALL be rejected. The contribution window SHALL close on a server-authoritative deadline obtained through the injected clock seam rather than waiting indefinitely for every seat; when the deadline passes, the window closes and the deal proceeds with the deterministic fallback for any seat that has not contributed. Each seat's accepted contribution SHALL be a `SeatContribution` consumed by the fairness layer.

#### Scenario: Contribution before commit is rejected

- **WHEN** a seat submits a `clientSeed` contribution before the hand's commit has been broadcast
- **THEN** the room rejects the contribution

#### Scenario: Contribution after commit is accepted

- **WHEN** a seat submits a `clientSeed` contribution after the commit has been broadcast and before the contribution window closes
- **THEN** the room records the contribution for use in seed assembly

#### Scenario: Contribution window closes on deadline

- **WHEN** the contribution window's deadline passes with one or more seats not yet contributed
- **THEN** the room closes the window and proceeds to deal without waiting further
- **AND** each non-contributing seat is resolved with the deterministic fallback

#### Scenario: Late contribution after window close is rejected

- **WHEN** a seat submits a `clientSeed` contribution after the contribution window has closed for that hand
- **THEN** the room rejects the contribution
