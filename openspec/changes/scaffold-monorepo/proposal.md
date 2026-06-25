## Why

MeldRank's design phase is complete (20 locked design docs in Linear) and the stack is locked to "TypeScript everywhere" across multiple deploy targets that share one type system (Technical Architecture — v1, §7). Before any domain logic or infrastructure can have a home, the repository needs the agreed monorepo skeleton: a single workspace where the Game Engine, shared schemas, and the four deployable apps coexist and share types. This is the foundational, unblocking change — every later change depends on it.

## What Changes

- Initialize a **pnpm + Turborepo** monorepo at the repo root (workspace config, Turbo pipeline, root `package.json`, pinned Node/pnpm versions).
- Create the locked package/app layout from Technical Architecture §7 as buildable, type-checkable stubs (no business logic):
  - `packages/engine` — pure-TS Game Engine package, **zero runtime deps**, set up for exhaustive unit testing.
  - `packages/shared` — shared types + **Zod** schemas (home of the Variant Definition schema).
  - `apps/web` — Next.js client.
  - `apps/api` — stateless tRPC backend.
  - `apps/match` — Colyseus Realtime Match Service.
  - `apps/bots` — bot worker process.
- Establish the **shared tooling baseline**: a base `tsconfig` (strict) extended by every package, TypeScript project references / path aliases, lint + format config, and a test runner wired into the Turbo pipeline.
- Verify the cross-package contract works: `apps/*` and `packages/engine` can import from `packages/shared`, and `lint` / `typecheck` / `test` / `build` run green across the whole workspace.
- **Out of scope (next change):** infrastructure provisioning (Vercel, Fly.io, Neon, Upstash, Clerk), CI/CD, environment configuration, and any game/domain logic.

## Capabilities

### New Capabilities
- `monorepo-workspace`: The repository structure and developer tooling contract — workspace layout, package boundaries, the base TypeScript/lint/test configuration, and the root commands (`build`, `typecheck`, `lint`, `test`, `dev`) that operate across the workspace.

### Modified Capabilities
<!-- None — greenfield repository, no existing specs. -->

## Impact

- **Repository:** introduces root tooling files (`pnpm-workspace.yaml`, `turbo.json`, root `package.json`, base `tsconfig`, lint/format/test config) and the `packages/` + `apps/` directory tree.
- **Dependencies:** adds dev tooling (pnpm, Turborepo, TypeScript, Zod, lint/format/test toolchain) plus framework stubs (Next.js, tRPC, Colyseus) at the versions the architecture doc locks in.
- **Downstream:** unblocks every subsequent change — infra provisioning, the Game Engine build, shared schemas, and each app — by giving them a workspace to live in.
- **Source of truth:** Linear "Technical Architecture — v1" (§7 locked stack, §2 container shape).
