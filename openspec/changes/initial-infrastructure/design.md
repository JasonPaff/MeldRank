## Context

The scaffold change (archived `scaffold-monorepo`) stood up the six §7 workspaces as buildable stubs and locked the tooling baseline (pnpm + Turborepo, strict base tsconfig, ESLint flat + Prettier, Vitest, Node 22, `@meldrank/*` via `workspace:*` path aliases). It deliberately deferred everything that touches the outside world. This change adds that platform foundation: a typed env contract, the Drizzle/Neon and Upstash/Redis clients, deploy descriptors, and a CI quality gate.

Two standing constraints shape every decision here:

1. **No new top-level workspaces.** The `monorepo-workspace` spec requires that only the six §7 workspaces exist. Infra code must therefore live inside them — it cannot become a new `packages/config` or `packages/db`.
2. **`apps/web` runs in the browser and imports `@meldrank/shared`.** Any database or Redis driver reachable from the root `@meldrank/shared` entry would be pulled into the web bundle. Server-only code must be isolated from the isomorphic surface.

The locked stack (Linear "Technical Architecture — v1", §7) fixes the providers (Neon, Upstash, Clerk, Vercel, Fly.io) and tools (Drizzle, Zod). What it leaves open are the wiring sub-decisions this design records, choosing conventional baselines and flagging the genuine forks for Jason.

## Goals / Non-Goals

**Goals:**

- A single typed environment contract: one Zod schema, a fail-fast loader, and a committed `.env.example` covering every variable. No process reads raw `process.env` for required config.
- A Drizzle + Neon foundation: connection/client factory, `drizzle.config`, and working migration scripts (generate / apply / studio) — proven against an empty schema, ready for the Data Model change to add tables.
- An Upstash Redis client factory available to `apps/api` and `apps/match`, as connection plumbing only.
- Deploy descriptors for all four apps (`vercel.json`; `fly.toml` + `Dockerfile`) plus a provisioning runbook, so deployment is reproducible by hand.
- A GitHub Actions PR check running `lint`, `typecheck`, `test`, `build` across the workspace with pnpm + Turbo caching.
- `packages/engine` stays dependency-free; `apps/web` bundles no server driver.

**Non-Goals:**

- No live provisioning (no accounts created, no secrets entered, no resources spun up) — documented as manual operator steps.
- No deploy automation in CI; no preview/production deploy wiring.
- No domain data model / Drizzle tables; no real Redis usage (no queues, presence, or pub/sub logic); no Clerk middleware or session wiring.
- No observability/logging/metrics stack — a later concern.

## Decisions

**D1 — Infra code lives in a server-only subpath export of `packages/shared` (`@meldrank/shared/server`).**
The isomorphic root export (`@meldrank/shared`) keeps types + Zod schemas as today. A second, server-only entry (`@meldrank/shared/server`, declared via `package.json` `exports`) houses the env loader and the db/redis client factories and carries the Drizzle/Neon/Upstash runtime deps. `apps/web` imports only the root entry, so no server driver enters the browser bundle; `apps/api`/`apps/match`/`apps/bots` import from `/server`. _Why:_ single source of truth for env + clients without violating the no-new-workspaces rule, while the export boundary mechanically prevents server deps leaking to the client. _Alternative:_ duplicate per-app `src/infra/*` modules — no shared deps in `shared`, but copy-paste drift across api/match/bots. Flagged in Open Questions as a real fork.

**D2 — Env validation: one layered Zod schema, fail-fast at process boot.**
A `commonEnv` schema (shared by all processes) plus per-process extensions (e.g. api needs `DATABASE_URL` + `REDIS_*`, web needs `NEXT_PUBLIC_*` + Clerk publishable key). Each process calls a `loadEnv()` that parses `process.env` once at startup and throws a readable, aggregated error listing every missing/invalid variable. Consumers import the typed, frozen result — never `process.env` directly. Local development loads `.env` via the runtime's native support (Next.js built-in; `node --env-file` / `tsx` for the Node apps) so no `dotenv` dependency is strictly required. `.env.example` is the committed source of truth for variable names.

**D3 — Database: Drizzle ORM over the Neon serverless driver; migrations via drizzle-kit.**
Use `@neondatabase/serverless` so the same client works on Vercel serverless (`apps/api`) and Fly.io (`apps/match`). Ship `drizzle.config.ts` and root scripts `db:generate`, `db:migrate`, `db:studio`. The schema module starts empty (a placeholder export) — the Data Model change populates it. _Why serverless driver:_ avoids connection-pool exhaustion on serverless and is HTTP/WS-based, portable across both hosts. _Trade-off:_ long-lived `apps/match` on Fly could use a pooled TCP connection (`pg.Pool`) for lower per-query latency; deferred and flagged (Open Questions Q2) rather than split the driver now.

**D4 — Cache: Upstash Redis REST client (`@upstash/redis`).**
A `createRedis()` factory reading `UPSTASH_REDIS_REST_URL` / `_TOKEN`. The REST client is serverless- and edge-safe and works identically on Vercel and Fly. This change wires connectivity only (a health `ping` is the extent of usage). _Note:_ classic blocking pub/sub for the API↔Match channel is not expressible over the REST client; the concrete messaging mechanism is deferred to the Match Runtime change (Open Questions Q3).

**D5 — Deploy descriptors only; provisioning is a documented manual runbook.**
`apps/web` and `apps/api` each get a `vercel.json` and are intended as two separate Vercel projects rooted at their app directories (Turbo-aware install/build). `apps/match` and `apps/bots` each get a `fly.toml` and a multi-stage production `Dockerfile` (pnpm fetch → build → slim Node 22 runtime). An `infra/README.md` runbook enumerates the resources to create (Neon DB, Upstash DB, Clerk app, Vercel projects, Fly apps) and the env vars each populates. No secrets are committed; `.env.example` documents shape only.

**D6 — CI: one GitHub Actions workflow, checks only, with caching.**
On `pull_request` and pushes to `main`: checkout → `pnpm/action-setup` (version from `packageManager`) → Node 22 with pnpm cache → `pnpm install --frozen-lockfile` → `pnpm turbo run lint typecheck test build`. Turbo's local cache keyed via `actions/cache` keeps reruns fast. Remote caching (Vercel) and deploy jobs are deferred. The workflow is the enforceable form of the `monorepo-workspace` "checks pass" requirement.

**D7 — Versions: latest stable per standing policy.**
All added deps (Drizzle, drizzle-kit, `@neondatabase/serverless`, `@upstash/redis`) are installed at latest stable at apply time, verified against npm — not pinned from memory. Toolchain pins (Node 22, pnpm via `packageManager`) are unchanged.

## Risks / Trade-offs

- **[Server deps leak into the web bundle]** A stray `@meldrank/shared/server` import in `apps/web` would pull Drizzle/Neon into the browser → Mitigation: the `exports` map separates entries; add a build/lint guard and verify `apps/web` build output contains no driver. A broken boundary fails `build`.
- **[Env drift between `.env.example` and the schema]** A variable added to the schema but not the example (or vice versa) misleads operators → Mitigation: a tiny check (script or test) asserting the Zod schema keys and `.env.example` keys match; run it in CI.
- **[Neon serverless driver on long-lived Fly process]** Per-query HTTP overhead and cold-start nuances differ from a pooled TCP client → Mitigation: acceptable for the foundation (no hot path yet); revisit with a pooled option in the Match Runtime change (Q2).
- **[Upstash REST can't do blocking pub/sub]** The API↔Match channel design can't be finalized here → Mitigation: scope this change to connectivity only; defer the messaging pattern to Match Runtime (Q3) and document the limitation in the runbook.
- **[Drizzle migration tooling proven with no tables]** An empty schema may hide config mistakes until the first real table → Mitigation: generate one throwaway migration during apply to prove `generate`/`migrate` end-to-end, then revert it, leaving the pipeline verified and the schema empty.
- **[CI green locally but deploy-time config wrong]** Checks-only CI won't catch a bad `fly.toml`/`vercel.json` → Mitigation: validate descriptors syntactically (e.g. `fly config validate` documented in the runbook); accept that real deploy verification lands with the deploy-automation change.

## Migration Plan

Greenfield, additive — no data or rollback concerns. Apply order: (1) env contract in `@meldrank/shared/server` + `.env.example`; (2) Drizzle/Neon foundation + scripts; (3) Upstash client; (4) wire `apps/api`/`apps/match`/`apps/bots` to load env and construct clients at boot (still no domain use); (5) deploy descriptors + runbook; (6) CI workflow. Each step keeps `lint`/`typecheck`/`test`/`build` green. Rollback is deletion of the added files; nothing external is mutated.

## Open Questions

Baselines are chosen to keep momentum; these are the genuine forks for Jason to rule on (design-workflow: baseline + flagged forks).

- **Q1 — Infra client home.** Baseline: server-only subpath of `packages/shared` (D1). Alternative: per-app `src/infra` modules. Confirm the shared/server boundary is acceptable, or prefer per-app isolation.
- **Q2 — DB driver for `apps/match`.** Baseline: Neon serverless driver everywhere (D3). Should the long-lived Fly Match Service instead use a pooled TCP connection? (Can defer to Match Runtime.)
- **Q3 — API↔Match messaging.** Baseline: wire Upstash connectivity only now; defer the pub/sub mechanism (Upstash REST can't block-subscribe) to the Match Runtime change. Confirm deferral.
- **Q4 — `apps/match` DB access.** Does Match write match results directly via the shared client, or exclusively through `apps/api`? Baseline: direct access available; confirm.
- **Q5 — Turbo remote caching in CI.** Baseline: local cache only now; add Vercel remote caching later. Confirm deferral.
