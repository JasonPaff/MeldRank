## ADDED Requirements

### Requirement: Server seed commitment binds before the deal

The system SHALL provide a pure function that, given a `serverSeed`, produces a `commit` value such that publishing `commit` binds the server to that exact `serverSeed`. The commitment MUST be a domain-separated SHA-256 of the `serverSeed`, MUST be deterministic, and MUST be infeasible to satisfy with any `serverSeed` other than the committed one. The function MUST NOT reveal the `serverSeed`.

#### Scenario: Commit is deterministic for a given seed

- **WHEN** the commit function is called twice with the same `serverSeed`
- **THEN** it returns the same `commit` value both times

#### Scenario: Different seeds produce different commits

- **WHEN** the commit function is called with two distinct `serverSeed` values
- **THEN** it returns two distinct `commit` values

#### Scenario: Commit does not expose the seed

- **WHEN** a `commit` is produced from a `serverSeed`
- **THEN** the `commit` is a fixed-width hash digest that does not contain the `serverSeed` bytes

### Requirement: Multi-party seed assembly

The system SHALL assemble a single `seed` from the `serverSeed`, a per-hand nonce, and an ordered set of per-seat `clientSeed` contributions, using a domain-separated SHA-256 over a canonical, length-prefixed, fixed-seat-order encoding. The assembly MUST be deterministic, MUST depend on every contribution, and MUST be order-stable (contributions are encoded in ascending seat order regardless of arrival order).

#### Scenario: Assembly is deterministic

- **WHEN** the seed is assembled twice from the same `serverSeed`, nonce, and contributions
- **THEN** both assemblies yield the same `seed`

#### Scenario: Every contribution affects the seed

- **WHEN** any single `clientSeed`, the `serverSeed`, or the hand nonce changes
- **THEN** the assembled `seed` changes

#### Scenario: Contribution order does not matter

- **WHEN** the same set of seat contributions is supplied in a different arrival order
- **THEN** the assembled `seed` is identical, because contributions are encoded in fixed seat order

#### Scenario: No single party controls the seed

- **WHEN** all-but-one contributions are fixed and the remaining party varies its input
- **THEN** that party cannot drive the `seed` to a chosen target value without finding a SHA-256 preimage

### Requirement: Full-width Rng derivation feeds the engine Dealer

The system SHALL derive, from an assembled `seed`, a randomness source conforming to the engine's `Rng` interface (`nextUint32()`), suitable to pass directly into the engine `deal` function. The derivation MUST key off the full assembled seed (a hash-stream construction), MUST NOT reduce the seed to a single 32-bit word, MUST be deterministic, and MUST extract uint32 words with a fixed, specified byte order.

#### Scenario: Same seed yields the same stream

- **WHEN** two `Rng` instances are derived from the same `seed`
- **THEN** they emit identical sequences of `nextUint32()` values

#### Scenario: Different seeds yield different streams

- **WHEN** two `Rng` instances are derived from distinct seeds
- **THEN** their emitted sequences differ

#### Scenario: Drives a real engine deal

- **WHEN** the derived `Rng` is passed to the engine `deal` for a given deck spec
- **THEN** `deal` produces a valid deal and the same `seed` always reproduces the same hands and widow

#### Scenario: Full permutation space is reachable

- **WHEN** the derivation is inspected
- **THEN** it consumes the entire assembled seed rather than a 32-bit reduction, so it is not limited to a 32-bit space of outcomes

### Requirement: Post-hand reveal and verification

The system SHALL provide a replay-sufficient reveal bundle and a pure `verify` function. The bundle MUST contain the hand nonce, the published `commit`, the revealed `serverSeed`, the per-seat contributions (each a `clientSeed` or a substitution marker), and a digest of the dealt result. The `verify` function MUST: recompute the commit from the revealed `serverSeed` and confirm it equals the published `commit`; reassemble the `seed`; rebuild the `Rng`; re-run the engine `deal`; and confirm the resulting hands and widow match the bundle's digest. `verify` MUST return failure if any check does not hold.

#### Scenario: Honest bundle verifies

- **WHEN** `verify` is given a bundle produced from an honest deal
- **THEN** it confirms the commit binds the revealed seed and the re-run deal reproduces the recorded result, and returns success

#### Scenario: Tampered server seed is rejected

- **WHEN** a bundle's revealed `serverSeed` is altered so it no longer hashes to the published `commit`
- **THEN** `verify` returns failure

#### Scenario: Tampered result digest is rejected

- **WHEN** a bundle's dealt-result digest does not match the deal reproduced from its seeds
- **THEN** `verify` returns failure

#### Scenario: Reveal is replay-sufficient

- **WHEN** a third party is given only the reveal bundle and the public deck spec
- **THEN** it can reproduce the seed, the `Rng`, and the deal without any additional server state

### Requirement: Missing-reveal fallback

When a seat supplies no contribution for a hand, the system SHALL substitute a deterministic value derived solely from the already-committed `serverSeed` and that seat index, via a domain-separated SHA-256. The substitution MUST be recorded in the reveal bundle for that seat, MUST be reproducible by `verify`, and MUST NOT give the server any control beyond what it fixed at commit time.

#### Scenario: Missing contribution is substituted deterministically

- **WHEN** the seed is assembled for a hand in which one seat provided no `clientSeed`
- **THEN** that seat's slot uses the substitute derived from the committed `serverSeed` and seat index, and the same inputs always yield the same substitute

#### Scenario: Substitution is recorded and verifiable

- **WHEN** a hand assembled with a substituted seat is later verified
- **THEN** the reveal bundle marks that seat as substituted and `verify` reproduces the same seed and deal

#### Scenario: Server gains no new control from a drop-out

- **WHEN** a seat goes missing after the server has published its `commit`
- **THEN** the substitute is a fixed function of the pre-committed `serverSeed`, so the server cannot use the drop-out to influence the resulting deal

### Requirement: Uniform contribution interface for all participants

A seat contribution SHALL be represented as a `clientSeed` of fixed width tagged with its seat index, with no distinction between human- and bot-supplied contributions. The assembler MUST treat every contribution identically regardless of its origin.

#### Scenario: Bot and human contributions are interchangeable

- **WHEN** a contribution is supplied for a seat
- **THEN** the assembler processes it identically whether it originated from a human client or a bot, with no participant-type branch

### Requirement: Isomorphic, pure, side-effect-free core

The fairness module SHALL be pure and run identically in a browser and in Node 22 without relying on Node-only or browser-only crypto APIs. Its functions MUST be deterministic given their inputs, MUST NOT perform I/O or mutate their inputs, and MUST produce byte-for-byte identical results across environments.

#### Scenario: Identical results across environments

- **WHEN** the same inputs are processed in Node and in a browser-equivalent environment
- **THEN** the commit, assembled seed, `Rng` stream, and verify result are identical

#### Scenario: Inputs are not mutated

- **WHEN** any fairness function is called with seed or contribution inputs
- **THEN** those inputs are left unchanged after the call
