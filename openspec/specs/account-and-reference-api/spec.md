# account-and-reference-api Specification

## Purpose

Defines the read-only account and reference tRPC procedures that resolve the caller's identity through the centralized stub-identity seam and expose the resolvable Variant Definitions a casual table can be created from.

## Requirements

### Requirement: account.getMe resolves the caller over stubbed identity

The API SHALL expose `account.getMe`, which resolves the caller's identity through the centralized stub-identity seam and returns the local player view (at minimum the stub `playerId` and onboarding state). In this slice identity is stubbed — derived from a request header or a development default — and the resolution is the single seam unit E later swaps for Clerk without changing the procedure body.

#### Scenario: getMe returns the stubbed caller identity

- **WHEN** `account.getMe` is called
- **THEN** it returns a player view carrying the resolved stub `playerId` and onboarding state

#### Scenario: Identity resolution is centralized

- **WHEN** any `player`-scoped procedure needs the caller's identity
- **THEN** it obtains `playerId` from the shared stub-identity resolver, not by re-reading the request inline

### Requirement: variant.list returns the resolvable variants

The API SHALL expose `variant.list`, returning the catalog of resolved Variant Definitions a casual table can be created from (at minimum the two canonical variants — Single-Deck Partners and Single-Deck Cutthroat). The result SHALL be a public, read-only projection suitable for table creation and rules reference.

#### Scenario: List returns the canonical variants

- **WHEN** `variant.list` is called
- **THEN** it returns the resolved Variant Definitions, including Single-Deck Partners and Single-Deck Cutthroat

### Requirement: variant.get resolves a variant by id

The API SHALL expose `variant.get({ id })`, returning the single resolved Variant Definition for the given id, or a typed `not-found` error when no such variant exists.

#### Scenario: Get returns a known variant

- **WHEN** `variant.get` is called with the id of a known variant
- **THEN** it returns that resolved Variant Definition

#### Scenario: Get rejects an unknown variant id

- **WHEN** `variant.get` is called with an id that matches no variant
- **THEN** it rejects with a typed `not-found` error
