# data-persistence Specification

## Purpose

Establish the Drizzle ORM client over Neon Postgres on the server-only surface and the migration tooling to author and apply migrations. The schema home that this capability established is now populated by domain tables owned by the `match-record-store` capability.

## Requirements

### Requirement: Drizzle client over Neon

The repository SHALL provide a Drizzle ORM client factory connected to Neon Postgres, exposed from the server-only surface (`@meldrank/shared/server`) and constructed from the validated environment. The factory SHALL be importable by `apps/api` and `apps/match` and SHALL NOT be reachable from the isomorphic `@meldrank/shared` root entry.

#### Scenario: Server apps construct a working client

- **WHEN** `apps/api` or `apps/match` constructs the Drizzle client from a valid environment
- **THEN** the client initializes against Neon and a trivial query (e.g. `SELECT 1`) succeeds

#### Scenario: Client is absent from the client bundle

- **WHEN** `apps/web` is built
- **THEN** no Neon/Drizzle driver is included in its bundle, because the client is only exported from the server-only entry

### Requirement: Migration tooling

The repository SHALL provide Drizzle migration tooling — a `drizzle.config` and root scripts to generate migrations, apply them, and open the studio — wired into the workspace so that migrations can be authored and run from a single entry point.

#### Scenario: Migration scripts are available and functional

- **WHEN** the migration generate and apply scripts are run against a configured database
- **THEN** drizzle-kit generates migration files and applies them without error

#### Scenario: Pipeline is proven end-to-end before tables exist

- **WHEN** the migration pipeline is exercised during implementation
- **THEN** a generated migration applies successfully and the schema home remains empty afterward (no domain tables are introduced by this change)
