## Why

The MVP spine now runs end-to-end across three long-lived Node services on Fly.io — `apps/match` (Colyseus authority), `apps/api` (tRPC backend), `apps/bots` (workers) — but the only operational visibility is 16 ad-hoc `console.*` calls in 5 files. They emit unstructured strings (`[MatchRoom xK2] bot brain failed for seat 2`), carry no machine-queryable fields, no level discipline, no redaction, and — critically — no way to follow a single table across the service boundary it crosses (web → api spawn → match room). Fly captures stdout, so JSON lines would be directly queryable today; instead they are prose. Before more surfaces light up, the three services need one shared structured logger with bound context and a correlation convention that is reserved now while it is cheap, not retrofitted later when it is expensive.

## What Changes

- **Add a shared structured logger** in `@meldrank/shared/server/log` (`pino`): a `createLogger(service, env)` factory returning a JSON logger bound with `{ service }`, plus an exported `Logger` type. One import path for all server code; pure packages (`engine`, `fairness`) stay logger-free.
- **Drive format and level from the environment.** `LOG_LEVEL` (validated, defaulted) sets the threshold; production emits newline-delimited JSON to stdout (Fly-native), non-production pretty-prints. Known secrets (seat tickets, `INTERNAL_SPAWN_SECRET`, redis/db URLs) are redacted in the factory once.
- **Bind per-service context via child loggers.** `match` binds `{ roomId, matchId }` (and `seat` per event) on a room child logger; `api` binds a per-request child in the tRPC context; `bots` binds `{ workerId }`. Structured fields replace string interpolation.
- **Reserve a cross-service trace correlation convention** (design now, wire gradually): a `traceId` log field plus an `x-meldrank-trace-id` header constant in `@meldrank/shared`. `api` originates a `traceId` per request and forwards it on the internal spawn `POST`; the match spawn route reads it and binds it onto the room's child logger, so api-side and match-side logs for one table share an id. Full request-scoped `AsyncLocalStorage` propagation and the web origin are out of scope.
- **Replace every existing `console.*` call** in the three services (entry-point boot banners and `matchRoom.ts`'s operational events) with the shared logger, and add an ESLint guard against raw `console` in service `src`.

Out of scope (deferred): `apps/web` server-side and browser logging (the chosen scope is the three Node services); `AsyncLocalStorage` request-scoped context and multi-hop auto-propagation; shipping logs to any aggregator beyond Fly's stdout capture; metrics/tracing spans (OpenTelemetry).

## Capabilities

### New Capabilities

- `structured-logging`: the shared `pino` logger factory in `@meldrank/shared/server/log`, its environment-driven format/level and secret redaction, the per-service contextual child-logger pattern adopted by `match`/`api`/`bots`, and the `traceId` + `x-meldrank-trace-id` cross-service correlation convention.

### Modified Capabilities

- `environment-config`: the validated server environment gains an optional `LOG_LEVEL` key (defaulted), surfaced to every service's `loadXxxEnv`.
- `match-spawn-gateway`: the internal spawn endpoint accepts and propagates a trace correlation id, binding it onto the created room so the room's logs share the API's id for that spawn.

## Impact

- **Packages:** `@meldrank/shared` — new `src/server/log/` module (`pino` + `pino-pretty` dev transport, both added at latest stable); new `traceId` field name + `x-meldrank-trace-id` header constant; `src/server/env` schema gains `LOG_LEVEL`; `.env.example` updated (the `env:check` script gates this).
- **Code:** `apps/match` (`index.ts` boot banner, `colyseus/matchRoom.ts` operational events, spawn route binds `traceId`), `apps/api` (`index.ts` boot, tRPC context gains a per-request child logger + originates/forwards `traceId`), `apps/bots` (`index.ts` boot banners) adopt the shared logger; `engine`/`fairness` untouched.
- **Tooling:** ESLint `no-console` (or `no-restricted-syntax`) enabled for the three services' `src`.
- **Ops:** Fly stdout now carries queryable JSON; no new infra, no aggregator, no migrations.
