## ADDED Requirements

### Requirement: Typed environment schema

The repository SHALL define every environment variable the system consumes in a single Zod schema, composed of a common base shared by all processes plus per-process extensions. No variable required for operation SHALL exist only as an undocumented `process.env` read.

#### Scenario: All consumed variables are declared in the schema

- **WHEN** the environment module is inspected
- **THEN** a Zod schema declares every variable the apps consume (database, Redis, Clerk, app URLs, ports), with a common base and per-process extensions

#### Scenario: Schema lives on the server-only surface

- **WHEN** the environment loader and schema are located
- **THEN** they are exported from the server-only entry (`@meldrank/shared/server`), not from the isomorphic `@meldrank/shared` root entry

### Requirement: Fail-fast environment loading

Each process SHALL validate its environment once at startup through a loader that parses `process.env` against the schema and, on any missing or invalid variable, throws an error that aggregates and names every offending variable. Consumers SHALL read configuration from the validated, typed result rather than from `process.env`.

#### Scenario: Missing required variables abort startup with a clear error

- **WHEN** a process loads its environment with a required variable unset
- **THEN** loading throws before the process serves work, and the error message names every missing or invalid variable

#### Scenario: Valid environment yields a typed config object

- **WHEN** a process loads its environment with all required variables present and valid
- **THEN** the loader returns a typed object whose fields match the schema, and consumers access configuration through it rather than `process.env`

### Requirement: Committed environment example

The repository SHALL include a committed `.env.example` documenting every variable in the schema, with placeholder (non-secret) values, and its variable set SHALL stay in agreement with the schema.

#### Scenario: Example documents the full schema

- **WHEN** `.env.example` is compared against the environment schema
- **THEN** every schema variable appears in `.env.example` and no example variable is absent from the schema

#### Scenario: No secrets are committed

- **WHEN** `.env.example` is inspected
- **THEN** it contains only placeholder values, no real credentials or tokens
