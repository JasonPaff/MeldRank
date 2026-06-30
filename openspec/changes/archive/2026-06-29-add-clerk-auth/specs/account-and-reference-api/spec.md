## MODIFIED Requirements

### Requirement: account.getMe resolves the caller over authenticated identity

The API SHALL expose `account.getMe`, which resolves the caller's identity through the
centralized identity seam and returns the local player view (at minimum the internal
`playerId` and onboarding state). Identity is the authenticated Clerk caller resolved to
an internal `players.id` UUID (`auth-identity`); the resolution remains the single seam,
and the procedure body is unchanged from the stubbed slice. Onboarding SHALL be reported
complete (no onboarding flow this change); the display identity is Clerk-derived.

#### Scenario: getMe returns the authenticated caller identity

- **WHEN** `account.getMe` is called by an authenticated caller
- **THEN** it returns a player view carrying the resolved internal `playerId` and onboarding state

#### Scenario: getMe rejects an unauthenticated caller

- **WHEN** `account.getMe` is called with no valid Clerk session
- **THEN** it is rejected with the typed `unauthorized` error

#### Scenario: Identity resolution is centralized

- **WHEN** any `player`-scoped procedure needs the caller's identity
- **THEN** it obtains `playerId` from the shared identity resolver, not by re-reading the request inline
