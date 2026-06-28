## Why

`apps/api` is a standalone tRPC server — `src/index.ts` calls
`createHTTPServer(...).listen(port)`, a long-lived Node process. Vercel runs
request/response **serverless functions**, not a `.listen()` server, so the API
cannot deploy to Vercel as built today: `apps/api/vercel.json` has
`framework: null` with a `tsc --noEmit` build that emits nothing, there is no
serverless function entry, and a stale `.vercel/output/config.json` routes
everything to a 404 shell. This blocks unit H (MVP first deploy, Linear
SLE-184) — the `meld-rank-api` Vercel project is already created/linked but has
nothing deployable. Tech Architecture §7 locks the API as "stateless tRPC on
Vercel," so the fix is to make it serverless-deployable, not to relocate it.

## What Changes

- **API — Vercel serverless function entry.** Add a serverless handler under
  `apps/api/api/` that serves the existing `appRouter` via the tRPC **fetch
  adapter** (`fetchRequestHandler`). It constructs the per-cold-start
  dependencies at module scope (db, redis, casual-table store, ticket minter,
  HTTP spawn client) — exactly what `src/index.ts` does today — and resolves
  each request through the same `resolveStubIdentity` context seam.
- **API — CORS reconciled into the handler.** The single-origin `WEB_APP_ORIGIN`
  allowlist and the `OPTIONS` preflight short-circuit (today middleware on the
  standalone server) are reproduced in the serverless path so the browser seam
  keeps working identically.
- **API — local dev server preserved.** `src/index.ts` (the standalone
  `.listen()` server) stays intact so `pnpm --filter @meldrank/api dev` is
  unchanged; the two entries share the router and context-building logic rather
  than duplicating it.
- **API — Vercel descriptor + request routing.** `apps/api/vercel.json` is
  updated so the function is the deploy artifact and **all** tRPC paths reach it
  (the web client's `httpBatchLink` targets the API root, while Vercel functions
  live under `/api`), and the `@meldrank/shared` workspace dependency is bundled
  for the function in this monorepo.

**Explicitly out of scope** (boundary):

- Any Clerk/auth wiring — identity stays **stubbed**; real Clerk is unit E.
- The table UI (F2) and any Colyseus work.
- Provisioning cloud resources or running the actual deploys — that is the rest
  of unit H, done by hand after this lands.

## Capabilities

### New Capabilities

- `api-serverless-runtime`: the `apps/api` Vercel serverless function entry that
  serves the full tRPC `appRouter` (via the fetch adapter) with the single-origin
  CORS allowlist + `OPTIONS` preflight and the stub-identity context, while the
  standalone `.listen()` server is preserved for local development. Owns the
  serverless serving model and its request routing; owns no procedure behavior
  (the routers are unchanged) and no authentication (identity stays stubbed).

### Modified Capabilities

- `deployment-config`: the `apps/api` Vercel descriptor requirement changes from
  "describes install and build" to additionally configuring a **serverless
  function entry** and the request routing that maps the API's tRPC paths onto it
  — so the deploy artifact is the function, not the standalone server.

## Impact

- **Code:** `apps/api/api/` (new serverless handler entry); `apps/api/src/`
  (extract the shared router-context construction + CORS values so both entries
  reuse them; `src/index.ts` keeps `.listen()` for local dev); `apps/api/vercel.json`
  (function + routing + monorepo bundling); possibly `apps/api/package.json`
  (build no longer needs to emit, but must produce a Vercel-deployable function).
- **Dependencies:** `@trpc/server`'s fetch adapter (already a dependency of
  `@trpc/server@^11`); no new runtime libraries. Verify the `@vercel/node`
  builder bundles the `@meldrank/shared` / `@meldrank/shared/server` workspace
  package from the monorepo.
- **Config:** no new env vars — reuses the existing API env contract
  (`DATABASE_URL`, `UPSTASH_*`, `INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET`,
  `MATCH_INTERNAL_URL`, `WEB_APP_ORIGIN`). `PORT` is unused by the function path.
- **Downstream:** unblocks unit H's `apps/api` deploy on the already-linked
  `meld-rank-api` project; the web client reaches it unchanged via
  `NEXT_PUBLIC_API_URL`. Unit E (Clerk) later replaces the stub identity inside
  the shared context seam without changing the serving model.
