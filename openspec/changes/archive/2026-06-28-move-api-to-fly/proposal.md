## Why

The just-archived `add-api-vercel-entry` made `apps/api` a Vercel serverless
function. It builds and deploys, but **crashes at runtime** with
`ERR_MODULE_NOT_FOUND` importing `@meldrank/shared/src/server/index.ts`. The root
cause is structural, not a config tweak: the monorepo publishes `@meldrank/shared`
as **raw TS source** (no build/`dist` — the locked "consume internal packages as TS
source" tooling convention), and Vercel's `@vercel/node` builder **externalizes**
workspace packages instead of bundling them, so the deployed function tries to
`import` a `.ts` file that Node's production ESM loader cannot execute. This
convention only fights Vercel serverless — `apps/match` and `apps/bots` already run
fine on Fly because they execute `tsx src/index.ts` in a Docker container, and
`tsx` transpiles the workspace TS at runtime.

Rather than bolt a bundling pipeline onto Vercel, this change **moves the API to
Fly**, mirroring the two sibling server apps. This is a deliberate, ruled deviation
from Technical Architecture §7 ("Web + API → Vercel; Match + bots → Fly.io") and
should be recorded in the Linear Tech Architecture doc. After it lands, unit H is
**3 Fly apps (match, bots, api) + 1 Vercel project (web only)**.

## What Changes

- **Add the API's Fly descriptors.** New `apps/api/Dockerfile` mirroring
  `apps/match/Dockerfile` (multi-stage, Node 22 slim, build context = repo root so
  the whole pnpm workspace is present, runs `pnpm --filter @meldrank/api start` =
  `tsx src/index.ts`, exposes 3001) and new `apps/api/fly.toml`
  (`app = "meldrank-api"`, HTTP service on internal port 3001, `force_https`). The
  API is **stateless** — unlike the match service it need not stay alive for
  in-memory rooms — so it may scale to zero (knobs decided in design).
- **Remove the Vercel serverless bits** from `add-api-vercel-entry`: delete
  `apps/api/api/index.ts` (the fetch-adapter handler) and `apps/api/vercel.json`,
  and revert `apps/api/tsconfig.json` `include` to `["src"]`.
- **Keep the good refactor.** `apps/api/src/context.ts`, `apps/api/src/cors.ts`, and
  the refactored standalone `src/index.ts` stay — `src/index.ts` **is** the Fly
  entry; it already serves `appRouter` over `createHTTPServer(...).listen(port)`
  with the shared CORS + stub-identity context, and already runs under `tsx`. No
  server code change is required.
- **Update the provisioning runbook** (`infra/README.md`): move `apps/api` from the
  Vercel section to the Fly section (match + bots + api), note decommissioning the
  `meld-rank-api` Vercel project, and point the web app's `NEXT_PUBLIC_API_URL` at
  the Fly API URL.

The env contract is **unchanged**: the API still needs `DATABASE_URL`, `UPSTASH_*`,
`INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET`, `MATCH_INTERNAL_URL`,
`WEB_APP_ORIGIN` (CORS still applies — web→api is still cross-origin), and `PORT` —
supplied via `fly secrets` instead of Vercel env.

**Explicitly out of scope:** Clerk/auth (unit E; identity stays stubbed); the table
UI (F2); actually provisioning Fly or deploying (the rest of unit H, by hand after
this lands); any change to `apps/match` / `apps/bots`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `deployment-config`: the `apps/api` deploy descriptor moves from a Vercel
  `vercel.json` to a Fly `fly.toml` + `Dockerfile`. The Vercel-descriptors
  requirement now covers only `apps/web`; the Fly-descriptors requirement now covers
  `apps/match`, `apps/bots`, **and** `apps/api`; the provisioning runbook reflects
  the same move (api under Fly, `meld-rank-api` Vercel project decommissioned).

### Removed Capabilities

- `api-serverless-runtime`: the API is no longer a Vercel serverless function.
  **Reason:** Vercel's `@vercel/node` externalizes the TS-source `@meldrank/shared`
  workspace dependency, so the deployed function fails at load with
  `ERR_MODULE_NOT_FOUND` on a `.ts` import. **Migration:** the standalone
  `src/index.ts` tRPC server now deploys on Fly via Docker + `tsx`, which transpiles
  the workspace TS at runtime (identical to `apps/match`/`apps/bots`). The shared
  `context.ts`/`cors.ts` extraction survives as ordinary server code.

## Impact

- **Code/config:** new `apps/api/Dockerfile` + `apps/api/fly.toml`; deleted
  `apps/api/api/index.ts` + `apps/api/vercel.json`; `apps/api/tsconfig.json` include
  reverted to `["src"]`. `apps/api/src/{index,context,cors}.ts` unchanged.
- **Infra:** `infra/README.md` resource→env map + provisioning steps; the
  `meld-rank-api` Vercel project is decommissioned (manual, in H). Web's
  `NEXT_PUBLIC_API_URL` now resolves to the Fly API URL.
- **Architecture:** deviates from Tech Architecture §7 (API on Vercel → API on Fly);
  record in the Linear design doc. Runtime model is now consistent across all three
  server apps (Docker + `tsx`).
- **Downstream:** unit H provisions/deploys `meldrank-api` on Fly alongside match +
  bots; the web client reaches it unchanged via `NEXT_PUBLIC_API_URL`. Unit E
  (Clerk) still swaps the stub identity inside the shared context seam.
