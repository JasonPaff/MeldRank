## ADDED Requirements

### Requirement: Clerk authentication environment keys

The validated environment SHALL declare the Clerk authentication keys on the surfaces that
consume them: `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SECRET` as required keys of the
`apps/api` server schema, and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as a required key of the
public `apps/web` schema. The publishable key SHALL remain on the isomorphic public surface
(never the server-only entry) so no secret enters the browser bundle. All three SHALL be
documented in `.env.example` with non-secret placeholders so the `pnpm env:check` agreement
check stays in sync.

#### Scenario: API requires the Clerk secret and webhook secret

- **WHEN** `apps/api` loads its environment with `CLERK_SECRET_KEY` or `CLERK_WEBHOOK_SECRET` unset
- **THEN** loading fails fast at boot, naming the missing variable

#### Scenario: Web requires the publishable key on the public surface

- **WHEN** the web environment is loaded
- **THEN** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is present on the typed, validated public web env exported from the isomorphic `@meldrank/shared` root, never the server-only entry

#### Scenario: Example stays in agreement

- **WHEN** `pnpm env:check` runs
- **THEN** `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` appear in `.env.example` with non-secret placeholders and the check passes
