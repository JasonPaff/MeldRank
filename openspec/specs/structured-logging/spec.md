# structured-logging Specification

## Purpose

Define a single shared, server-side structured logging surface for the Node services (`match`, `api`, `bots`): one logger factory, environment-driven output format and level, secret redaction, per-service contextual child loggers, and a cross-service trace-correlation convention. Pure domain packages carry no logging dependency.

## Requirements

### Requirement: Shared structured logger factory

The shared package SHALL expose a single server-side structured logger from `@meldrank/shared/server` — a `createLogger(service, options)` factory returning a JSON-capable logger and an exported `Logger` type — so that every Node service (`match`, `api`, `bots`) obtains its logger from one place. The base logger returned by the factory SHALL be bound with the `service` name so that field is present on every line. Pure domain packages (`@meldrank/engine`, `@meldrank/fairness`) SHALL NOT depend on the logger.

#### Scenario: A service constructs its logger from the shared factory

- **WHEN** a service constructs its logger at boot via `createLogger(service, …)`
- **THEN** it receives a logger whose every emitted line carries the `service` field
- **AND** the logger is imported from `@meldrank/shared/server`, the same surface as the db and redis clients

#### Scenario: Pure packages carry no logging dependency

- **WHEN** the dependency graph of `@meldrank/engine` or `@meldrank/fairness` is inspected
- **THEN** neither package imports the shared logger nor any logging library

### Requirement: Environment-driven output format and level

The logger's output format and threshold SHALL be determined by the environment. In production the logger SHALL emit newline-delimited JSON to stdout (so Fly's log capture is directly queryable); outside production it SHALL emit human-readable pretty output. The minimum level SHALL come from the validated `LOG_LEVEL` environment value when set, and otherwise default to a sensible level (`info` in production, `debug` outside it). Pretty output SHALL never be used in production.

#### Scenario: Production emits queryable JSON

- **WHEN** a service logs while `NODE_ENV` is `production`
- **THEN** each entry is a single JSON line on stdout carrying its level, message, `service`, and bound fields

#### Scenario: Non-production emits pretty output

- **WHEN** a service logs outside production
- **THEN** entries are rendered in a human-readable form for local development

#### Scenario: Level is taken from the environment

- **WHEN** `LOG_LEVEL` is set to a valid level
- **THEN** entries below that level are not emitted
- **AND** when `LOG_LEVEL` is unset the logger falls back to its environment-appropriate default

### Requirement: Secret redaction

The logger SHALL redact known secret values so they can never reach stdout, even when a caller passes a whole environment or options object. The redaction set SHALL be configured once in the factory and SHALL cover the seat-ticket secret, the internal spawn secret, seat tickets, and the database and redis connection strings.

#### Scenario: A secret-bearing object is redacted

- **WHEN** a caller logs an object containing a known secret field (for example the internal spawn secret or a connection URL)
- **THEN** that field's value is replaced with a redaction marker in the emitted entry

### Requirement: Per-service contextual child loggers

Each service SHALL bind its operational context to a child logger at the point a unit of work begins, rather than interpolating context into message strings, so that context fields are machine-queryable on every related line. The match service SHALL bind `roomId` and `matchId` (and the seat per event) on a per-room child logger; the API SHALL bind a per-request child logger in its request context; the bots worker SHALL bind its worker identity. All existing operational events and boot banners in the three services SHALL be emitted through these loggers with structured fields, and error values SHALL be logged as structured error fields rather than interpolated text.

#### Scenario: Match room logs carry room context as fields

- **WHEN** a match room logs an operational event (for example a bot-brain failure or an abandonment signal)
- **THEN** the entry carries `roomId` and `matchId` as fields and the event's specifics (such as `seat`) as structured fields, not interpolated into the message

#### Scenario: API request logs carry request context

- **WHEN** an API procedure logs during a request
- **THEN** the entry is emitted through the request-bound child logger and carries that request's bound fields

#### Scenario: No raw console in service source

- **WHEN** service application code under `apps/match`, `apps/api`, or `apps/bots` `src` is linted
- **THEN** direct `console` usage is reported as a violation, with the shared logger the sanctioned path (test files exempt)

### Requirement: Cross-service trace correlation convention

The shared package SHALL define a single trace-correlation convention reusable across services: a `traceId` log field name and an `x-meldrank-trace-id` HTTP header constant, both exported for reuse. The API SHALL associate a `traceId` with each request — inherited from the inbound `x-meldrank-trace-id` header when present, otherwise generated — and bind it to that request's logger, so that a request's API-side log entries share one id. The convention SHALL be defined once and reused wherever the id is propagated, so additional origins (such as the web client) can adopt it later without redefining it.

#### Scenario: The API associates a trace id with every request

- **WHEN** the API handles a request that carries an `x-meldrank-trace-id` header
- **THEN** that id is used as the request's `traceId` and appears on the request's log entries

#### Scenario: A trace id is generated when none is supplied

- **WHEN** the API handles a request with no `x-meldrank-trace-id` header
- **THEN** the API generates a `traceId` and binds it to the request's logger

#### Scenario: The convention is defined once and shared

- **WHEN** any service references the trace field name or propagation header
- **THEN** it uses the shared exported `traceId` field name and `x-meldrank-trace-id` header constant rather than a local literal
