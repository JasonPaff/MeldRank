## ADDED Requirements

### Requirement: Log level is a validated, optional environment key

The validated server environment SHALL include an optional `LOG_LEVEL` key constraining its value to a recognized log level, surfaced to every service's environment loader (`loadMatchEnv` / `loadApiEnv` / `loadBotsEnv`). When unset the loaders SHALL succeed and the logger SHALL apply its environment-appropriate default; when set to an unrecognized value, validation SHALL fail fast at boot like any other invalid environment value. `LOG_LEVEL` SHALL be documented in `.env.example` so the example-environment check stays in sync.

#### Scenario: Valid log level is accepted

- **WHEN** a service boots with `LOG_LEVEL` set to a recognized level
- **THEN** environment validation succeeds and the value is available to the logger

#### Scenario: Missing log level falls back to default

- **WHEN** a service boots with `LOG_LEVEL` unset
- **THEN** environment validation succeeds and the logger applies its default level

#### Scenario: Invalid log level fails fast

- **WHEN** a service boots with `LOG_LEVEL` set to an unrecognized value
- **THEN** environment validation fails at boot
