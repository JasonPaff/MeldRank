## Why

The monorepo scaffold gives every app and package a home, but nothing yet connects them to the outside world: there is no typed contract for environment variables, no database or cache client, no deploy configuration, and no automated quality gate. Before the Game Engine and the runtime services can be built and trusted, the repository needs its platform foundation — the validated config, data/cache clients, deploy descriptors, and CI that every later change relies on. Jason sequenced this (infra before engine) so the substrate is ready when domain work begins.

## What Changes

- **Typed environment contract.** Introduce Zod-validated environment parsing with a fail-fast loader, so every process validates its required variables at boot and consumes them through a typed object rather than raw `process.env`. Ship a committed `.env.example` documenting every variable (Neon, Upstash, Clerk, app URLs, ports) and a server-only home for the schema.
- **Database foundation.** Wire Drizzle ORM against Neon Postgres: a connection/client factory, `drizzle.config`, and migration tooling (generate / apply / studio scripts). No domain tables yet — the Data Model is its own change; this establishes the persistence plumbing and its conventions.
- **Cache & messaging foundation.** Add an Upstash Redis client factory for the roles the architecture assigns Redis — presence, matchmaking queues, and API↔Match pub/sub — as connection plumbing only, no domain usage.
- **Deployment configuration (files, not live provisioning).** Add the deploy descriptors each target needs: `vercel.json` for `apps/web` + `apps/api`; `fly.toml` + a production `Dockerfile` for `apps/match` and `apps/bots`. Live account creation and secret entry are documented as manual steps for the operator, not performed by this change.
- **Continuous integration (checks only).** Add a GitHub Actions workflow that runs `lint`, `typecheck`, `test`, and `build` across the workspace on pull requests, with pnpm + Turbo caching. Deploy automation is deferred until apps have real content.
- **Provisioning runbook.** A short `infra/README` (or equivalent) listing the cloud resources to create (Neon, Upstash, Clerk, Vercel, Fly.io projects) and which env vars they populate, so the documented manual steps are reproducible.

**Out of scope (later changes):** live cloud provisioning and secret entry; deploy automation in CI; the domain data model / Drizzle tables; Clerk client/middleware wiring (auth & identity change); any game or business logic.

## Capabilities

### New Capabilities

- `environment-config`: The typed environment-variable contract — a Zod schema of all variables, a fail-fast loader exposing a validated typed config to each process, and the committed `.env.example` documenting them.
- `data-persistence`: The Postgres/Drizzle foundation — connection/client factory against Neon, `drizzle.config`, and migration tooling and scripts. Plumbing only; no domain schema.
- `cache-and-messaging`: The Upstash Redis foundation — a client factory for presence, matchmaking queues, and API↔Match pub/sub. Connection plumbing only.
- `deployment-config`: The per-target deploy descriptors — `vercel.json` for the Vercel apps and `fly.toml` + `Dockerfile` for the Fly.io services — plus the provisioning runbook. Configuration files, not live deploys.
- `continuous-integration`: The GitHub Actions pipeline that runs the workspace quality gate (`lint`, `typecheck`, `test`, `build`) on pull requests with dependency and build caching.

### Modified Capabilities

<!-- None. The monorepo-workspace spec is respected, not changed: all infra code lives inside the existing six workspaces (no new top-level packages/apps), and the root command contract is unchanged. -->

## Impact

- **Workspaces touched:** `packages/shared` (server-only home for env schema + db/redis client factories), `apps/api` and `apps/match` (consume db/redis clients), `apps/web` (`vercel.json`, Clerk/public env vars in the contract), `apps/match` + `apps/bots` (`fly.toml`, `Dockerfile`).
- **Dependencies added:** Drizzle ORM + Neon serverless driver, drizzle-kit, Upstash Redis client, and dotenv-style local env loading — all at latest stable per the standing version policy. `packages/engine` stays dependency-free.
- **New root/repo files:** `.env.example`, `.github/workflows/*` CI, deploy descriptors, and the provisioning runbook.
- **External systems (provisioned manually, documented here):** Neon (Postgres), Upstash (Redis), Clerk (auth keys), Vercel (web + api), Fly.io (match + bots).
- **Source of truth:** Linear "Technical Architecture — v1" (§7 locked stack), with "Data Model", "Match Runtime", and "Auth & Identity" defining the consumers this foundation serves in later changes.
