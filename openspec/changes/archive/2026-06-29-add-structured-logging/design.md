## Context

Three long-lived Node services run on Fly.io: `apps/match` (Colyseus authority, one engine per room), `apps/api` (standalone tRPC HTTP server), `apps/bots` (worker loop). All three are constructed at boot from a validated environment (`loadMatchEnv` / `loadApiEnv` / `loadBotsEnv`, in `@meldrank/shared/server/env`) and already build foundation db/redis clients. The shared package exposes a server-only subpath, `@meldrank/shared/server`, alongside `db/`, `redis/`, `env/`, `api/` — the natural home for a logger that all server runtimes share but pure packages never see.

Today logging is 16 `console.*` calls in 5 files: boot banners in each `index.ts` and operational events in `apps/match/src/colyseus/matchRoom.ts` (bot-brain failures, intent rejections, abandonment signals/resolutions, persist retries, persist skip). They interpolate context into strings (`[MatchRoom ${roomId}] ...`), so nothing is queryable. Fly captures stdout/stderr, so structured JSON lines are immediately useful with zero added infra.

The one path that crosses a service boundary is table creation: `api` calls the match service's authenticated internal spawn route (`POST /internal/rooms`, capability `match-spawn-gateway`) which runs `matchMaker.createRoom('match', options)`; the room then lives in `match`. Correlating "this spawn request" with "this room's lifecycle" is the value that is cheap to reserve now and expensive to retrofit.

Scope (ruled by Jason): **the three Node services only** — `apps/web` (server and browser) is deferred. Correlation: **design now, wire gradually** — reserve the field + header convention and carry it across the spawn hop, but no full request-scoped `AsyncLocalStorage` propagation.

## Goals / Non-Goals

**Goals:**

- One shared structured logger (`@meldrank/shared/server/log`) adopted by `match`, `api`, `bots`; JSON in production, pretty in dev; env-driven level; secrets redacted once.
- Replace every `console.*` in the three services with bound, structured child loggers carrying machine-queryable context.
- Reserve a `traceId` correlation convention (field name + HTTP header constant) and carry it across the api→match spawn hop, binding it onto the room logger.
- Keep `engine` and `fairness` pure — zero logging dependency.

**Non-Goals:**

- `apps/web` server-side or browser logging (separate later change — browser needs a different transport).
- `AsyncLocalStorage` request-scoped context and automatic multi-hop propagation (the declined "full propagation now" option).
- Log shipping/aggregation beyond Fly's stdout capture; metrics, OpenTelemetry tracing spans.
- Touching the pure domain packages, or logging inside them via an injected interface (not needed yet).

## Decisions

### D1 — Library: `pino`, homed in `@meldrank/shared/server/log`

Use `pino` — the de-facto Node structured logger: JSON by default, low overhead on the hot match loop, child loggers, redaction, and a `pino-pretty` dev transport. It lives in `@meldrank/shared/server/log` and is exported from `@meldrank/shared/server`, so every service imports it the same way db/redis are imported. Added at latest stable per the dependency-version policy.

_Alternatives rejected:_ a hand-rolled `JSON.stringify` console wrapper (zero dep, but reinvents levels, child loggers, and redaction — and the match loop wants a fast, battle-tested serializer); `winston` (heavier, slower, no advantage here).

### D2 — `createLogger(service, env)` factory; env-driven format and level

```
type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
function createLogger(service: 'match' | 'api' | 'bots', opts: {
  level?: LogLevel;          // from env LOG_LEVEL
  pretty?: boolean;          // NODE_ENV !== 'production'
}): Logger                   // pino.Logger, re-exported as the package's Logger type
```

- The factory returns a base logger bound with `{ service }`. Level defaults to `info` (`debug` in non-production) and is overridden by `LOG_LEVEL`.
- **Format:** production → newline-delimited JSON on stdout (Fly-native, queryable). Non-production → `pino-pretty` transport for human-readable local dev.
- **Redaction (D2a):** a fixed `redact` path list configured once — seat tickets, `INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET`, and db/redis connection URLs — so a secret can never reach stdout even if a caller passes a whole env/options object.
- Each `index.ts` constructs the base logger right after `loadXxxEnv()` and uses it for the boot banner, replacing the current `console.log`.

### D3 — Per-service context via explicit child loggers (no ALS)

Context is bound with `logger.child({...})` at the point a unit of work is created — no `AsyncLocalStorage`. Each service has a natural binding point:

- **`match`** — the Colyseus `Room` holds `this.log = base.child({ roomId, matchId, traceId })` set in `onCreate`. Every `matchRoom.ts` call site becomes `this.log.warn({ seat }, 'abandon event')` etc.; the `roomId`/`matchId`/`traceId` ride every line for free. Per-event fields (`seat`, `err`, `timeoutCount`) are passed as the structured object.
- **`api`** — `buildContext` attaches `ctx.log = base.child({ traceId })` (see D4) so every procedure logs with the request's id; a tRPC error-formatter/middleware logs failures uniformly.
- **`bots`** — `base.child({ workerId })` for the worker; boot banners move onto it.

_Why explicit children over ALS:_ ALS adds a context-propagation layer and a small per-async-hop cost the match loop does not need yet, and Jason declined full propagation. Explicit binding covers every current call site. ALS remains an open door if web/request fan-out later wants ambient context.

### D4 — Cross-service trace correlation: reserve the convention, wire the one hop

Reserve two shared constants in `@meldrank/shared` (server-safe):

```
const TRACE_ID_FIELD = 'traceId'            // the log field name
const TRACE_ID_HEADER = 'x-meldrank-trace-id'  // the HTTP propagation header
```

Wiring, minimal but real:

```
        inbound (web, later)        internal spawn POST
   web ───────── x ────────▶ api ───── x-meldrank-trace-id ─────▶ match
                              │                                     │
                       child({ traceId })                   room.child({ traceId, roomId, matchId })
                       generates id if absent               reads header → createRoom options → onCreate
```

- **`api` originates:** `buildContext` reads `x-meldrank-trace-id` from the inbound request if present (forward-compatible with a future web origin), else generates one; binds it to `ctx.log`. When `api` calls the match internal spawn route it sets the `x-meldrank-trace-id` header.
- **`match` binds:** the spawn route (capability `match-spawn-gateway`) reads the header, threads it through `createRoom` options, and the room binds it onto `this.log` in `onCreate`. From then on every room log line carries the same `traceId` the API used for that spawn.
- `matchId` (assigned at persistence) remains the durable cross-system join key; `traceId` joins the *spawn moment* across api↔match in the logs. They coexist.
- **Deferred:** generating `traceId` at the web origin, and any propagation beyond this single hop, wait for the web-logging change. The convention existing now means that change only adds an origin, not a refactor.

### D5 — Pure packages stay pure

`engine` and `fairness` (and `packages/bots` lib) take no logging dependency and emit nothing — they are deterministic `(input) → output`. If a pure package ever needs to surface a diagnostic, it returns it in its result for the caller to log, or accepts an injected minimal `Logger`-shaped interface. Not built now; called out so no one reaches for the shared logger from inside `engine`.

### D6 — Console replacement and the lint guard

Replace all 16 `console.*` call sites with the bound logger, mapping severity faithfully (`console.error` → `log.error`, abandonment `console.warn` → `log.warn`, boot `console.log` → `log.info`), moving the interpolated context into structured fields and passing `error` objects as `{ err }` (pino's error serializer). Enable `no-console` (or `no-restricted-syntax` for `console`) in the ESLint config scoped to the three services' `src`, so the structured logger is the only path going forward (test files exempt).

## Risks / Trade-offs

- **`pino-pretty` transport in dev** spawns a worker thread; fine for dev, never enabled in production (gated on `NODE_ENV`). Mitigation: `pretty` defaults off; only the dev path turns it on.
- **Redaction is a fixed allow-list** — a newly added secret env var must be added to the `redact` paths. Mitigation: keep the redact list next to the env schema and note it there.
- **`traceId` only spans one hop today** — logs from a future web origin won't share the id until the web change lands. Accepted: the convention is reserved, not fully realized, exactly per the chosen "wire gradually" path.
- **Colyseus internal logs** stay on Colyseus's own logger (not pino). Out of scope; our room/app logs are structured, the framework's are not. Revisit only if framework noise becomes a problem.

## Migration / Rollout

No data migration. Mechanical, service-by-service: land the shared module + env key + constants first, then adopt in `match` (most call sites), `api`, `bots`, then flip on the lint guard. Each service's boot banner and existing events keep the same information, now structured. Fly log queries change from substring matches to field filters.

## Open Questions

- Field naming: `traceId` (chosen) vs `correlationId` vs `requestId` — `traceId` reads as the cross-service id; `api` may *also* want a per-request `requestId` distinct from an inherited `traceId`. Deferred until web originates traces; today they are one and the same.
- Whether `bots`' `workerId` should be a stable assigned id vs a per-process random — depends on how bot workers are scheduled on Fly; pick when bots gain real work (units B/C).
