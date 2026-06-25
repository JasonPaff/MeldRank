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

| Resource            | Provides                                                                        | Consumed by            |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| **Neon** (Postgres) | `DATABASE_URL`                                                                  | api, match, bots       |
| **Upstash** (Redis) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                            | api, match, bots       |
| **Clerk** (auth)    | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`                         | api (secret), web (pk) |
| **Vercel** (web)    | hosts `apps/web`; set `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`              | web                    |
| **Vercel** (api)    | hosts `apps/api`; reads `DATABASE_URL`, `UPSTASH_*`, `CLERK_SECRET_KEY`, `PORT` | api                    |
| **Fly.io** (match)  | hosts `apps/match`; reads `DATABASE_URL`, `UPSTASH_*`, `PORT`                   | match                  |
| **Fly.io** (bots)   | hosts `apps/bots`; reads `DATABASE_URL`, `UPSTASH_*`                            | bots                   |

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

### 4. Vercel (web + api — two separate projects)

For each of `apps/web` and `apps/api`:

1. Create a Vercel project and set its **Root Directory** to the app's
   directory (`apps/web` or `apps/api`). The committed `vercel.json` configures
   the monorepo-aware install/build (Turbo-filtered) and `turbo-ignore` so a
   project only rebuilds when its inputs change.
2. Set environment variables in the Vercel project (`vercel env add …`) per the
   table above. `apps/web` needs the `NEXT_PUBLIC_*` values; `apps/api` needs
   `DATABASE_URL`, `UPSTASH_*`, `CLERK_SECRET_KEY`, and `PORT`.
3. Validate the descriptor locally with `vercel pull` / `vercel build` once the
   project is linked.

### 5. Fly.io (match + bots — two separate apps)

For each of `apps/match` and `apps/bots`:

1. Edit the `app` and `primary_region` placeholders in the app's `fly.toml`.
2. Create the app: `fly apps create meldrank-match` (and `meldrank-bots`).
3. Set secrets (never in `fly.toml`):
   `fly secrets set --app meldrank-match DATABASE_URL=… UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=…`
   (omit `DATABASE_URL`/`UPSTASH_*` only if a service does not need them — both do).
4. Deploy from the **repository root** so the Docker build context is the whole
   workspace:
   `fly deploy --config apps/match/fly.toml --dockerfile apps/match/Dockerfile`
   (and the equivalent for `bots`).
5. Validate config syntax before deploying with
   `fly config validate --config apps/match/fly.toml`.

> `apps/match` exposes an HTTP/WebSocket service on `PORT` (2567).
> `apps/bots` is a headless worker with no inbound service.

## Verifying the foundation locally

- `cp .env.example .env` and fill in real values.
- `pnpm env:check` — asserts `.env.example` and the schema agree.
- Each server app validates its environment at boot (`loadApiEnv` /
  `loadMatchEnv` / `loadBotsEnv`) and fails fast, naming every missing variable.
