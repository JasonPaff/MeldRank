## Context

MeldRank is greenfield — the repo has only an initial commit. The design phase produced a locked stack (Linear "Technical Architecture — v1", §7): pnpm + Turborepo, TypeScript everywhere, with a shared `packages/engine` imported by client, Match Service, and bots. This change stands up that workspace as buildable stubs so later changes (infra, then the engine) have a home.

The architecture doc fixes the big choices (pnpm, Turborepo, the six-workspace layout, Next.js, tRPC, Colyseus, Drizzle, Clerk, Zod). What it leaves open are the developer-tooling sub-decisions (lint/format/test toolchain, cross-package TS wiring, version pins). This design records those, choosing conventional baselines and flagging the few genuine forks.

## Goals / Non-Goals

**Goals:**

- A pnpm + Turborepo workspace with the exact §7 layout, all six workspaces present as type-checkable, buildable stubs.
- A single strict base `tsconfig` extended everywhere; clean cross-package imports (`packages/shared` consumable by all).
- Root commands (`build`, `typecheck`, `lint`, `test`, `dev`) green across the whole workspace.
- `packages/engine` set up dependency-free with a test runner ready for test-first development.

**Non-Goals:**

- No infrastructure provisioning (Vercel, Fly.io, Neon, Upstash, Clerk) — that is the next change.
- No domain/game logic, no real schemas, no tRPC routers, no Colyseus rooms — only minimal stubs proving the wiring.
- No CI/CD pipeline, no environment/secret configuration, no deployment.

## Decisions

**D1 — Internal package consumption: TS source + workspace path aliases (no pre-build step).**
`apps/*` and `packages/engine` import `packages/shared` directly as TypeScript source via workspace protocol (`"@meldrank/shared": "workspace:*"`) and tsconfig path mapping, rather than requiring `shared` to be compiled to `dist` first. Keeps the inner dev loop fast and avoids stale-build bugs. _Alternative:_ TS project references with per-package `dist` output — more correct for publishable libraries, but heavier ceremony we don't need for a private monorepo. Turbo's `dependsOn` still orders `build` correctly for production output.

**D2 — Package namespace: `@meldrank/*`.**
Workspaces are named `@meldrank/engine`, `@meldrank/shared`, etc. Conventional, avoids collisions, makes imports self-documenting.

**D3 — Test runner: Vitest.**
TS-native, ESM-first, near-zero config, fast watch mode — ideal for the engine's exhaustive unit suite. _Alternative:_ Jest (more ecosystem inertia, slower, heavier TS setup). Vitest is the stronger fit for a pure-TS, test-first engine.

**D4 — Lint + format: ESLint (flat config) + Prettier.**
The conventional, best-supported baseline across Next.js, Node, and TS. _Alternative:_ Biome (single fast Rust tool for lint+format) — attractive, but ESLint's plugin ecosystem (Next.js, import rules, accessibility) is more mature. Flagged as a fork below.

**D5 — Versions: latest stable, no lagging behind.** Standing project policy (Jason, 2026-06-25): all dependencies are kept on their **latest stable** release — every package is installed at the newest stable version at the time the work lands, and bumps are made deliberately rather than allowed to drift. Pre-release/RC/`next`/canary tags are excluded (stable only). Toolchain pins stay single-sourced: Node 22 LTS via `.nvmrc` + `engines`, pnpm via `packageManager` in the root `package.json`. _Rationale:_ a greenfield repo should start current and stay current; deferring upgrades only compounds them. _Correction note:_ the initial apply selected some stale versions — superseded by this policy; all deps are to be brought to latest stable before archive.

**D6 — Stub shape per app.** Each app is the minimum that builds and runs: `apps/web` a default Next.js app importing a symbol from `@meldrank/shared`; `apps/api` a tRPC server stub; `apps/match` a Colyseus server entry that boots; `apps/bots` a worker entry that starts and exits cleanly. Each importing `@meldrank/shared` proves the cross-package contract end-to-end.

## Risks / Trade-offs

- **[Path-alias drift between tooling]** TS, Vitest, Next.js, and the Node apps must all resolve `@meldrank/*` the same way → Mitigation: drive resolution from `pnpm` workspace protocol + a single shared path config; add a smoke import in each app so a broken alias fails `typecheck`/`build` immediately.
- **[Colyseus/bots are long-lived Node servers in a Vercel-centric repo]** Their build/run model differs from the Next apps → Mitigation: keep them as plain Node/tsx entries with their own `build`/`dev` scripts; don't force them through Next tooling. Real deploy config is deferred to the infra change.
- **[Version churn]** Pinning majors now may lag by the time apps are fleshed out → Mitigation: pin via single source (`packageManager`, `.nvmrc`, catalog) so a later bump is one coordinated change.
- **[Over-scaffolding]** Building too much per app blurs the "structure only" boundary → Mitigation: hard rule — a stub exists only to prove it builds and can import `shared`; no feature code.

## Open Questions

All resolved with Jason 2026-06-25:

- **Q1 (resolved):** Lint/format toolchain → **ESLint (flat config) + Prettier** (D4 baseline).
- **Q2 (resolved):** Internal-package wiring → **TS source + `workspace:*` path aliases** (D1 baseline).
- **Q3 (resolved):** Node LTS → **Node 22 LTS**, pinned via `.nvmrc` and `engines`.
