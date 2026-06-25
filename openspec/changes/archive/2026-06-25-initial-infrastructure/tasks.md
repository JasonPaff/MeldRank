## 1. Server-only surface for `@meldrank/shared`

- [x] 1.1 Add a server-only entry to `packages/shared` via the `package.json` `exports` map (`.` → isomorphic root, `./server` → server-only), with matching tsconfig path aliases so `@meldrank/shared/server` resolves across the workspace
- [x] 1.2 Add a guard (lint rule or build check) that fails if `apps/web` imports `@meldrank/shared/server`, and document the boundary in `packages/shared`

## 2. Environment contract

- [x] 2.1 Add a `commonEnv` Zod schema plus per-process extensions (api, match, bots, web) under `@meldrank/shared/server`
- [x] 2.2 Implement `loadEnv()` that parses `process.env` once at boot and throws an aggregated, named error for every missing/invalid variable; export the typed, frozen result
- [x] 2.3 Create committed `.env.example` covering every schema variable (Neon, Upstash, Clerk, app URLs, ports) with placeholder values
- [x] 2.4 Add a check (script + CI/test) asserting `.env.example` keys and the schema keys agree

## 3. Database foundation (Drizzle + Neon)

- [x] 3.1 Add Drizzle ORM + `@neondatabase/serverless` (+ drizzle-kit dev) at latest stable; keep `packages/engine` dependency-free
- [x] 3.2 Implement the Drizzle client factory from the validated env, exported only from `@meldrank/shared/server`
- [x] 3.3 Create an empty schema module as the designated home for future tables
- [x] 3.4 Add `drizzle.config.ts` and root scripts `db:generate`, `db:migrate`, `db:studio`
- [x] 3.5 Prove the pipeline: generate a throwaway migration, apply it against a test DB, confirm `SELECT 1` works, then revert so the schema home stays empty

## 4. Cache foundation (Upstash Redis)

- [x] 4.1 Add `@upstash/redis` at latest stable
- [x] 4.2 Implement `createRedis()` factory from the validated env, exported only from `@meldrank/shared/server`, with a `PING` connectivity check and no domain logic

## 5. Wire apps to the foundation

- [x] 5.1 In `apps/api`, `apps/match`, `apps/bots`: call `loadEnv()` at boot and construct the db/redis clients (no domain use yet); ensure each still builds and starts/exits cleanly
- [x] 5.2 In `apps/web`: extend env loading to its public/Clerk variables via the root entry only; verify the build output contains no server driver

## 6. Deployment descriptors

- [x] 6.1 Add `vercel.json` to `apps/web` and `apps/api`, each configured for the monorepo and rooted at its workspace directory
- [x] 6.2 Add `fly.toml` + a multi-stage production `Dockerfile` (Node 22) to `apps/match` and `apps/bots`; confirm each image builds and its entry runs
- [x] 6.3 Write `infra/README.md` provisioning runbook mapping each external resource (Neon, Upstash, Clerk, Vercel, Fly) to the env vars it populates; no real secrets

## 7. Continuous integration

- [x] 7.1 Add a GitHub Actions workflow on `pull_request` + push to `main`: setup pnpm (from `packageManager`) + Node 22, `pnpm install --frozen-lockfile`, then `turbo run lint typecheck test build`
- [x] 7.2 Configure pnpm-store and Turborepo caching in the workflow; include the `.env.example`/schema agreement check
- [x] 7.3 Confirm no deploy steps are present (checks-only)

## 8. Validation

- [x] 8.1 Run `lint`, `typecheck`, `test`, `build` across the workspace via the validate agent and confirm all green
- [x] 8.2 Verify `apps/web` bundle excludes db/redis drivers and that all five new capabilities' scenarios hold
