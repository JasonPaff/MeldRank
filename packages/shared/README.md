# @meldrank/shared

Shared types, Zod schemas, and the platform foundation (environment contract,
database and cache clients) for the MeldRank monorepo.

This package has **two entry points** with a deliberate boundary between them.

## `@meldrank/shared` — isomorphic root

Safe to import from anywhere, including the `apps/web` browser bundle. Contains
only types, Zod schemas, and code with no runtime drivers or secrets:

- Shared domain types and schemas (e.g. `HealthSchema`).
- The generic env loader (`parseEnv`, `EnvValidationError`).
- The public web environment contract (`webEnv`, `loadWebEnv`) — `NEXT_PUBLIC_*`
  variables only, which are inlined into the client bundle and carry no secrets.

## `@meldrank/shared/server` — server-only

Imported by `apps/api`, `apps/match`, and `apps/bots`. Carries runtime drivers
(Drizzle/Neon, Upstash Redis) and reads server secrets, so it **must never reach
the browser**:

- The server environment schemas and per-process loaders (`loadApiEnv`,
  `loadMatchEnv`, `loadBotsEnv`).
- The Drizzle/Neon client factory (`createDb`) and the empty schema home.
- The Upstash Redis client factory (`createRedis`, `pingRedis`).

## The boundary

`apps/web` runs in the browser. Any database or Redis driver reachable from the
code it imports would be pulled into its bundle. The `package.json` `exports`
map separates the two entries, and an ESLint rule in `eslint.config.mjs` fails
the build if `apps/web` imports `@meldrank/shared/server`. When `apps/web` needs
configuration, it uses the isomorphic root entry only.
