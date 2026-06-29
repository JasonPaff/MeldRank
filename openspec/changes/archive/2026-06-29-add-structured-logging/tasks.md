## 1. Shared logger module (`@meldrank/shared`)

- [x] 1.1 Add `pino` and `pino-pretty` to `@meldrank/shared` at latest stable (verify against the npm registry, not memory; no pre-release tags).
- [x] 1.2 Create `src/server/log/index.ts`: a `createLogger(service, { level?, pretty? })` factory returning a `pino` logger bound with `{ service }`, plus an exported `Logger` type and `LogLevel` type (design D1, D2).
- [x] 1.3 Configure the factory's redaction path list once — `SEAT_TICKET_SECRET`, `INTERNAL_SPAWN_SECRET`, seat tickets, and db/redis connection URLs (design D2a).
- [x] 1.4 Default level (`info` in production, `debug` otherwise) overridden by the passed level; pretty transport only when `pretty` is set, never in production (design D2).
- [x] 1.5 Add the correlation constants — `TRACE_ID_FIELD = 'traceId'` and `TRACE_ID_HEADER = 'x-meldrank-trace-id'` — exported from `@meldrank/shared` (server-safe) (design D4).
- [x] 1.6 Re-export `createLogger`, `Logger`, and the constants from `@meldrank/shared/server`.
- [x] 1.7 Unit-test the factory: `service` binding present, level threshold honored, a secret-bearing object is redacted, pretty disabled under production.

## 2. Environment key (`@meldrank/shared/server/env`)

- [x] 2.1 Add optional `LOG_LEVEL` to the env schema constrained to the recognized levels; surface it through `loadMatchEnv` / `loadApiEnv` / `loadBotsEnv` (spec: environment-config).
- [x] 2.2 Document `LOG_LEVEL` in `.env.example`; run `pnpm env:check` to confirm the example stays in sync.
- [x] 2.3 Unit-test: unset is accepted (default applies), valid value passes, invalid value fails fast.

## 3. Adopt in `apps/match`

- [x] 3.1 In `src/index.ts`, construct the base logger from the validated env right after `loadMatchEnv()`; replace the boot `console.log` banner with a structured `info` line (design D3).
- [x] 3.2 In `colyseus/matchRoom.ts`, set `this.log = base.child({ roomId, matchId, traceId })` in `onCreate` (reading `traceId` from the spawn options, task 5) (design D3, D4).
- [x] 3.3 Replace all `matchRoom.ts` `console.*` call sites with `this.log.*`, moving interpolated context to structured fields and passing errors as `{ err }`: bot-brain failure, intent rejection, abandonment signal/resolution, abandon event, bot takeover, persist-skip, durable-write-failure (design D6).

## 4. Adopt in `apps/api`

- [x] 4.1 In `src/index.ts`, construct the base logger after `loadApiEnv()`; replace the boot `console.log` banner (design D3).
- [x] 4.2 In `buildContext`, read `x-meldrank-trace-id` from the inbound headers or generate a `traceId`, and attach `ctx.log = base.child({ traceId })` (design D4).
- [x] 4.3 Add a tRPC error path (error formatter or middleware) that logs failed procedures through `ctx.log` with structured fields.
- [x] 4.4 Where the API calls the match internal spawn route, set the `x-meldrank-trace-id` header from the request's `traceId` (design D4; spec: match-spawn-gateway).

## 5. Trace id through the spawn route (`apps/match`)

- [x] 5.1 Have the spawn route (`gateway/spawn.ts`) read the `x-meldrank-trace-id` header and thread it into `createRoom` options (spec: match-spawn-gateway).
- [x] 5.2 Bind the threaded `traceId` onto the room logger in `onCreate` (consumed by task 3.2); absence is a no-op and does not gate spawning.
- [x] 5.3 Unit-test the spawn route: header present → trace id reaches room options; header absent → room still created.

## 6. Adopt in `apps/bots`

- [x] 6.1 In `src/index.ts`, construct the base logger after `loadBotsEnv()`, bind `{ workerId }`, and replace the three boot `console.log` banners with structured lines (design D3).

## 7. Lint guard and verification

- [x] 7.1 Enable `no-console` (or a `no-restricted-syntax` rule for `console`) in the ESLint config scoped to `apps/match`, `apps/api`, `apps/bots` `src`, exempting test files (design D6; spec: structured-logging).
- [x] 7.2 Confirm `engine` and `fairness` gained no logging dependency (spec: structured-logging).
- [x] 7.3 Run the validate agent (lint, typecheck, test) and confirm clean.
- [x] 7.4 Manually run each service in dev and confirm pretty output; spot-check that a `production`-mode boot emits JSON lines with the `service` field.
