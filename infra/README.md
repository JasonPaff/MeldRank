# MeldRank Infrastructure & Provisioning Runbook

This change ships the platform **configuration** — the typed environment
contract, the database and cache client factories, deploy descriptors, and CI.
It does **not** create any cloud resources. This runbook is the manual,
reproducible procedure for provisioning those resources and mapping each to the
environment variables it populates.

Variable shapes are defined once in [`.env.example`](../.env.example) and the
Zod schema in `@meldrank/shared` / `@meldrank/shared/server`. Never commit real
secrets — `.env.example` is placeholders only, and production secrets are set
through each platform's secret store (`vercel env`, `fly secrets`).

## Resource → environment variable map

| Resource            | Provides                                                                                                                                           | Consumed by            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Neon** (Postgres) | `DATABASE_URL`                                                                                                                                     | api, match, bots       |
| **Upstash** (Redis) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                                                                               | api, match, bots       |
| **Clerk** (auth)    | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                                                                                            | api (secret), web (pk) |
| **Vercel** (web)    | hosts `apps/web`; set `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`                                                                                 | web                    |
| **Fly.io** (match)  | hosts `apps/match`; reads `DATABASE_URL`, `UPSTASH_*`, `INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET`, `PORT`                                       | match                  |
| **Fly.io** (bots)   | hosts `apps/bots`; reads `DATABASE_URL`, `UPSTASH_*`                                                                                               | bots                   |
| **Fly.io** (api)    | hosts `apps/api`; reads `DATABASE_URL`, `UPSTASH_*`, `INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET`, `MATCH_INTERNAL_URL`, `WEB_APP_ORIGIN`, `PORT` | api                    |

`NODE_ENV` is set by each platform (Vercel/Fly set `production`); locally it
defaults to `development`.

## Provisioning steps

### 1. Neon (Postgres)

1. Create a Neon project and a database.
2. Copy the **pooled** connection string into `DATABASE_URL`
   (`postgresql://user:password@host.neon.tech/dbname?sslmode=require`).
3. The schema starts empty. Apply migrations with the root scripts once tables
   exist (the Data Model change): `DATABASE_URL=… pnpm db:generate` then
   `DATABASE_URL=… pnpm db:migrate`. `pnpm db:studio` opens Drizzle Studio.

> The app clients use the Neon serverless (HTTP) driver, which works on both
> Vercel serverless and the long-lived Fly Match Service.

### 2. Upstash (Redis)

1. Create an Upstash Redis database (global or single-region).
2. From the **REST API** section copy the endpoint and token into
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

> This change wires connectivity only (a `PING` check). Presence, matchmaking
> queues, and the API↔Match channel are added by the changes that own them. Note
> the REST client cannot do blocking pub/sub; the messaging mechanism is decided
> in the Match Runtime change.

### 3. Clerk (auth)

1. Create a Clerk application.
2. Copy the **secret key** into `CLERK_SECRET_KEY` (server-side, `apps/api`).
3. Copy the **publishable key** into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   (`apps/web`, inlined into the client bundle).

> Middleware/session wiring is the Auth & Identity change; here the keys are
> only declared in the contract.

### 4. Vercel (web only)

> The API previously targeted Vercel but **moved to Fly.io** (see §5): Vercel's
> serverless builder externalizes the `@meldrank/shared` TS-source workspace
> package, so the deployed function failed at load with `ERR_MODULE_NOT_FOUND` on a
> `.ts` import. **Decommission the old `meld-rank-api` Vercel project.**

For `apps/web`:

1. Create a Vercel project and set its **Root Directory** to `apps/web`. The
   committed `vercel.json` configures the monorepo-aware install/build
   (Turbo-filtered) and `turbo-ignore` so the project only rebuilds when its inputs
   change.
2. Set environment variables in the Vercel project (`vercel env add …`) per the
   table above — `apps/web` needs the `NEXT_PUBLIC_*` values, with
   `NEXT_PUBLIC_API_URL` pointing at the Fly API URL from §5.
3. Validate the descriptor locally with `vercel pull` / `vercel build` once the
   project is linked.

### 5. Fly.io (match + bots + api — three separate apps)

For each of `apps/match`, `apps/bots`, and `apps/api`:

1. Edit the `app` and `primary_region` placeholders in the app's `fly.toml` (the
   committed names are `meldrank-match`, `meldrank-bots`, `meldrank-api`).
2. Create the app: `fly apps create meldrank-match` (and `meldrank-bots`,
   `meldrank-api`).
3. Set secrets (never in `fly.toml`):
   - **match / bots:**
     `fly secrets set --app meldrank-match DATABASE_URL=… UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… INTERNAL_SPAWN_SECRET=… SEAT_TICKET_SECRET=…`
     (bots needs only `DATABASE_URL` + `UPSTASH_*`).
   - **api** (also needs the spawn-seam URL + CORS origin):
     `fly secrets set --app meldrank-api DATABASE_URL=… UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… INTERNAL_SPAWN_SECRET=… SEAT_TICKET_SECRET=… MATCH_INTERNAL_URL=… WEB_APP_ORIGIN=…`
4. Deploy from the **repository root** so the Docker build context is the whole
   workspace:
   `fly deploy --config apps/match/fly.toml --dockerfile apps/match/Dockerfile`
   (and the equivalents for `bots` and `api`).
5. Validate config syntax before deploying with
   `fly config validate --config apps/match/fly.toml`.

> `apps/match` exposes an HTTP/WebSocket service on `PORT` (2567).
> `apps/api` exposes the tRPC HTTP service on `PORT` (3001); the web app's
> `NEXT_PUBLIC_API_URL` resolves to its Fly URL, and the API reaches the match
> service via `MATCH_INTERNAL_URL` (its Fly URL, or Fly private networking later).
> `apps/bots` is a headless worker with no inbound service.

## CI / CD

Two GitHub Actions workflows own automation:

- **`.github/workflows/ci.yml` (CI — checks only).** Runs the quality gate
  (`lint`, `typecheck`, `test`, `build`, plus `env:check`) on every pull request
  and on pushes to `main`. It never deploys.
- **`.github/workflows/deploy.yml` (CD — Fly only).** On every push to `main` it
  detects which Fly apps were *affected* by the push (via Turborepo's dependency
  graph, so a change to a shared package like `@meldrank/shared` redeploys every
  dependent) and runs `flyctl deploy --remote-only` for just those apps. Each
  deploy runs from the repo root so the Docker build context is the whole
  workspace (see §5).

**`apps/web` is not deployed by Actions** — it ships through Vercel's native Git
integration (preview deployments on PRs, production on push to `main`). Keep that
integration enabled on the Vercel `apps/web` project; no workflow drives it.

### Required GitHub configuration

- **Repository secret `FLY_API_TOKEN`** — a Fly deploy token with access to the
  three apps. Create one with `fly tokens create deploy` (or a broader org token)
  and add it under **Settings → Secrets and variables → Actions**.
- The deploy jobs target a GitHub **`production`** environment. It is created
  automatically on first use; add required reviewers there if you later want a
  manual approval gate before Fly deploys.

## Verifying the foundation locally

- `cp .env.example .env` and fill in real values.
- `pnpm env:check` — asserts `.env.example` and the schema agree.
- Each server app validates its environment at boot (`loadApiEnv` /
  `loadMatchEnv` / `loadBotsEnv`) and fails fast, naming every missing variable.
