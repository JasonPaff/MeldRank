# Audit: Monorepo architecture & boundaries

Date: 2026-07-01. Scope: monorepo-level architecture, workspace boundaries, service topology, build/CI tooling, env story, and repo-wide testing shape. Workspace internals are covered by sibling audits.

## Summary

**Overall shape grade: B+.** The dependency graph is clean and acyclic — `shared` is the leaf, game logic lives in `engine`, bot logic in `packages/bots`, and no package imports from an app. The contract layer (`@meldrank/shared` subpath exports for API/match/intent contracts, plus an ESLint boundary guard) and the affected-only Fly CD pipeline are genuinely well-engineered for a project this young. The headline issues are: (1) `engine` has a *runtime* value dependency on `@meldrank/shared` that is declared only as a devDependency, contradicting the repo's own "engine ships zero runtime dependencies" invariant; (2) all three Fly services ship the entire workspace with devDependencies and run TypeScript through `tsx` at runtime — no compile step, bloated images, slower cold starts on a scale-to-zero API; (3) `apps/bots` is a 31-line stub that is nonetheless a full deployed Fly service while real bot play runs in-process inside `apps/match`; and (4) `build` and `typecheck` are the identical `tsc --noEmit` command in every workspace, so CI type-checks everything twice. The web app has zero tests and there is no e2e layer.

## Workspace dependency graph

Declared workspace deps (`package.json`) and actual imports agree, with the two annotated exceptions.

```
packages/shared        (leaf — no workspace deps)
   ▲        ▲  ▲  ▲
   │        │  │  │
packages/engine ────────► shared        ⚠ VIOLATION: runtime import, declared devDependency only
   ▲   ▲    │
   │   │    │
packages/fairness ─► engine  (+ shared as devDep, test-only — OK)
   │   packages/bots ─► engine, shared
   │        ▲
   │        │
apps/match ─► engine, fairness, bots, shared, shared/server
apps/api   ─► shared, shared/server
apps/bots  ─► engine, shared, shared/server
apps/web   ─► shared, engine, api            ⚠ app→app edge (type-only: `import type { AppRouter }`)
root       ─► shared (devDep, for scripts/check-env-example.ts)
```

Verified by import scan across `apps/**` and `packages/**`:

- **No package imports from any app** (no `packages/* → apps/*` edges). Good.
- **No circular workspace dependencies.** `import-x/no-cycle` is enforced repo-wide (`eslint.config.mjs:68`).
- **`shared` is the leaf** and depends on no other workspace package — but it carries heavy server drivers (`drizzle-orm`, `@neondatabase/serverless`, `@upstash/redis`, `pino` — `packages/shared/package.json:30-36`), mitigated by the `.` vs `./server` subpath split and the web-side ESLint guard (`eslint.config.mjs:81-98`).
- **`apps/web → apps/api`** exists only as `import type { AppRouter }` (`apps/web/lib/trpc.ts:3`, `apps/web/app/providers.tsx:3`) — the standard tRPC pattern, but it is declared as a *runtime* dependency (`apps/web/package.json:17`).
- **Boundary quality is otherwise strong:** game rules are in `engine` only (web imports engine for card/view types, `apps/web/components/table/card.tsx:3`); bot decision logic is in `packages/bots` (`brain.ts`), consumed in-process by match (`apps/match/src/colyseus/matchRoom.ts:6`); the DB schema lives in one place (`packages/shared/src/server/db/schema.ts`, pointed at by root `drizzle.config.ts:14`); the web↔match wire contract lives in `packages/shared/src/intent/` and `packages/shared/src/match/`.

**DB write ownership:** two services write to the same Neon database through the shared schema — `apps/api` writes `players` (`apps/api/src/players.ts:38,48`); `apps/match` writes `matches`, `match_hands`, `match_hand_lines`, `match_replays` (`apps/match/src/persistence/writer.ts:39-63`). Table-level ownership is currently disjoint (api owns identity tables, match owns match-record tables), which is fine — but it is a convention, not an enforced boundary. Worth documenting in the schema folder before a third writer appears.

## Service topology assessment

Four deployables: `web` (Vercel), `api` + `match` + `bots` (Fly).

- **`web` / `api` / `match` split: justified.** Different runtimes and scaling shapes — Next.js on Vercel; stateless tRPC API that scales to zero (`apps/api/fly.toml:23-26`); stateful Colyseus rooms pinned alive (`apps/match/fly.toml:24-27`, `min_machines_running = 1`). The api↔match seam is a real, secret-gated contract (`INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET` HMAC tickets per `infra/README.md`).
- **`apps/bots`: premature/vestigial.** It is a 31-line stub whose `main()` validates env, logs three lines, and returns (`apps/bots/src/index.ts`) — the process then exits, so the deployed Fly machine is a no-op. Meanwhile actual bot play already happens *in-process* in the match service (`apps/match/src/colyseus/matchRoom.ts:6` imports `@meldrank/bots`). Yet it carries a full Dockerfile, `fly.toml`, a deploy-matrix slot (`.github/workflows/deploy.yml:80`), and Fly secrets (`DATABASE_URL`, `UPSTASH_*`). Cost: every `shared`/`engine` change triggers a pointless Fly deploy of a stub.
- **CI/CD coherence: very good.** `ci.yml` is a single quality gate (lint/typecheck/test/build + `env:check`) on PRs and main. `deploy.yml` computes affected Fly apps from the *Turborepo graph* over the exact pushed commit range (`turbo run build --affected --dry=json`, `.github/workflows/deploy.yml:70-84`), with safe fallback to deploy-all on unusable base, per-app concurrency groups, `fail-fast: false`, and a pinned flyctl action SHA. Vercel deploys web independently with a turbo-filtered build (`apps/web/vercel.json`). This matches the workspace graph correctly — including the devDependency edges, which is why the engine→shared misdeclaration doesn't currently break affected-detection.
- **Deployment coupling:** all three Fly Dockerfiles use the repo root as build context and copy the whole workspace (`apps/api/Dockerfile:17-21`), which is the honest consequence of the "packages export raw `.ts` + run with tsx" choice. It works, but couples every image to the entire repo (see finding below).

## Findings

### [SEVERITY: High] `engine` has a runtime dependency on `@meldrank/shared` declared only as a devDependency

**Evidence:** `packages/engine/src/state/reduce.ts:2` — `import { getMeldTable } from '@meldrank/shared/meld';` used at runtime at `reduce.ts:231`. But `packages/engine/package.json:21` lists `@meldrank/shared` under `devDependencies` only. The repo's own ESLint comment asserts the opposite invariant: "The engine ships zero runtime dependencies; type-only imports are what keeps `@meldrank/shared` … erased at build" (`eslint.config.mjs:61-64`).

**Why it matters:** (1) The stated architectural invariant is already violated — `consistent-type-imports` cannot catch a genuine value import, so nothing enforces it. (2) Under any production-pruned install (`pnpm install --prod`, `pnpm deploy`, or publishing) `engine` would not resolve `@meldrank/shared` and crash at first deal. It is masked today only because the Dockerfiles install the full workspace *with* devDependencies. (3) It misleads readers about what `engine` needs.

**Recommendation:** Decide the invariant explicitly. Either (a) move `@meldrank/shared` to `dependencies` in `packages/engine/package.json` and update the ESLint comment (accepting that `shared/meld` is pure data, no drivers), or (b) move the meld-table data into `engine` (it is game rules, arguably engine-owned) and keep shared type-only. Then add a real guard — e.g. `import-x/no-extraneous-dependencies` or a dependency-cruiser rule — so value-imports of undeclared deps fail lint.

### [SEVERITY: Medium] Fly images ship the whole workspace + devDependencies and run TypeScript via tsx in production

**Evidence:** `apps/api/Dockerfile:17-27` (same pattern in `apps/match/Dockerfile`, `apps/bots/Dockerfile`): `COPY packages ./apps ./` + `pnpm install --frozen-lockfile` (no `--prod`, no filter) into a "runtime" stage that is a full copy of the deps stage; `CMD ["pnpm", "--filter", "@meldrank/api", "start"]` where `start` is `tsx src/index.ts` (`apps/api/package.json:10`). No workspace emits JS — every package `build` is `tsc --noEmit` and turbo declares `outputs: []` (`turbo.json:12-14`).

**Why it matters:** Each of the three images contains every app's and package's source plus the entire dev toolchain (eslint, vitest, typescript, tsx, Next.js via the workspace store). That means: larger images → slower pulls and cold starts (the API is scale-to-zero, `apps/api/fly.toml:26`, and Fly cold starts are already a known pain point); tsx transpile cost at boot; a much larger supply-chain surface running in production; and no build-time artifact to roll back to. The `deps`→`runtime` two-stage split currently buys nothing (`COPY --from=deps /app ./` copies everything).

**Recommendation:** Per app: `pnpm --filter <app>... deploy --prod /out` (pnpm's deploy command produces a pruned, self-contained directory) or `turbo prune --scope=<app> --docker`, then either keep tsx over the pruned tree (small step) or add a real `tsup`/`tsc` emit for server apps (better). Size M.

### [SEVERITY: Medium] `apps/bots` is a deployed no-op service

**Evidence:** `apps/bots/src/index.ts` (31 lines) — `main()` logs "worker started" and returns; the process exits. It still has `apps/bots/Dockerfile`, `apps/bots/fly.toml`, a CD matrix slot (`.github/workflows/deploy.yml:80` maps `@meldrank/bots-worker → bots`), and per the runbook holds `DATABASE_URL` + `UPSTASH_*` secrets. Real bot play is in-process in match (`apps/match/src/colyseus/matchRoom.ts:6`).

**Why it matters:** Every change to `shared` or `engine` redeploys a stub; the Fly app holds production DB/Redis credentials for code that does nothing; and the machine either restart-loops or sits stopped depending on Fly's restart policy — confusing operational signal either way. The 4th service is premature until out-of-process bot scheduling is actually specced (per the Match Runtime slicing plan).

**Recommendation:** Remove `bots` from the deploy matrix (and destroy the Fly app / its secrets) until the worker has a real event loop, or delete `apps/bots` entirely and recreate it when the scheduling design lands — `packages/bots` (the actual logic) is unaffected. Size S.

### [SEVERITY: Medium] `build` and `typecheck` are the same command everywhere; CI runs the whole graph's type-check twice

**Evidence:** In all 7 non-web workspaces, `build` and `typecheck` are both exactly `tsc --noEmit -p tsconfig.json` (e.g. `packages/engine/package.json:15,18`; `apps/api/package.json:7,12`). `turbo.json` defines them as separate tasks (`build` with `outputs: []`, `typecheck` with `dependsOn: ["^build"]`), and CI runs `pnpm turbo run lint typecheck test build` (`.github/workflows/ci.yml:59`), so every package's `tsc` executes twice per cold run. `test` also `dependsOn: ["^build"]` even though nothing emits.

**Why it matters:** Wasted CI minutes on the slowest step (type-checking), and a conceptually confusing pipeline: "build" produces nothing, and `dependsOn: ["^build"]` edges exist only for ordering, not artifacts. New contributors (and agents) will misread it.

**Recommendation:** Pick one meaning. Simplest: drop the `build` script from the 7 non-emitting workspaces, keep `typecheck`, keep `@meldrank/web#build` as the only real build, and change CI to `turbo run lint typecheck test build` where `build` now only matches web. If you later add emitted builds (per the Docker finding), reintroduce `build` with real `outputs`. Size S.

### [SEVERITY: Medium] No mechanism loads the root `.env` for the Node services in local dev

**Evidence:** A populated root `.env` and `.env.example` exist, but no `dotenv`/`process.loadEnvFile`/`--env-file` usage exists anywhere in `apps/`, `packages/`, or `scripts/` (repo-wide grep). Dev scripts are bare `tsx watch src/index.ts` (`apps/api/package.json:8`), tsx does not auto-load `.env`, and Turbo 2 runs tasks in **strict env mode** — the config itself relies on that fact (`turbo.json:4-8`, `globalPassThroughEnv: ["SYNCKIT_TIMEOUT"]`), which additionally *hides* shell-exported vars that aren't declared. Next.js only auto-loads env files from `apps/web/`, not the repo root.

**Why it matters:** `pnpm dev` from the root cannot satisfy `loadApiEnv`/`loadMatchEnv` fail-fast validation unless every variable is exported in the shell *and* passes Turbo's env filtering — a fragile, undocumented path. The otherwise-excellent env contract (schema ↔ `.env.example` drift check in `scripts/check-env-example.ts`, per-process Zod loaders in `packages/shared/src/server/env/load.ts`) stops one step short of local DX.

**Recommendation:** Standardize one mechanism: change dev scripts to `node --env-file=../../.env` semantics via `tsx --env-file` (tsx ≥4.16 supports it), or call `process.loadEnvFile()` guarded by `NODE_ENV !== 'production'` at each entry, and declare the needed vars in `turbo.json` task `env`/`globalPassThroughEnv` (or set `envMode: "loose"` for the `dev` task only). Document it in `infra/README.md`. Size S.

### [SEVERITY: Medium] Repo-wide test pyramid has a missing top: zero web tests and no e2e layer

**Evidence:** Test scripts exist in `packages/engine`, `packages/fairness`, `packages/bots`, `packages/shared`, `apps/api`, `apps/match` (extensive room/integration suites, e.g. `apps/match/src/integration/seam.test.ts`, plus DB-hitting tests `apps/match/src/persistence/writer.db.test.ts`). `apps/web/package.json` has **no `test` script at all**, and no Playwright/Cypress/e2e tooling exists anywhere (repo-wide grep). Turbo's `test` task therefore silently skips web.

**Why it matters:** The bottom and middle of the pyramid are genuinely strong (engine/fairness/bots are pure and well-tested; match has integration coverage across the spawn seam). But the entire browser surface — table UI, waiting room, Colyseus client wiring (`apps/web/lib/use-table-connection.ts`), Clerk flows — is unverified, and there is no end-to-end check that web→api→match actually works before a deploy. Given deploys are fully automated on merge to main, a web regression ships straight to production.

**Recommendation:** Two steps: (1) add Vitest + Testing Library to `apps/web` for store/hook/component logic (S); (2) add one Playwright smoke that runs the full local stack (create table → seat → deal renders) as a separate CI job, non-blocking at first (M). Even a single e2e path would cover the riskiest seam in the system.

### [SEVERITY: Low] `@meldrank/shared` is a grab-bag leaf that couples pure domain vocabulary to server drivers

**Evidence:** One package contains: card/variant vocabulary consumed by the pure engine (`packages/shared/src/variant/`), the web↔match intent contracts (`src/intent/`), tRPC/API contracts (`src/api/`), match result/replay contracts (`src/match/`), env schemas, and the server kit — DB client + Drizzle schema, Redis, pino logger (`src/server/`), with `drizzle-orm`, `@neondatabase/serverless`, `@upstash/redis`, `pino` as dependencies (`packages/shared/package.json:30-36`).

**Why it matters:** Everything in the repo depends on the package that also owns the database. The subpath exports (`.` / `./server` / `./meld`) plus the web ESLint guard (`eslint.config.mjs:86-96`) currently keep the layers apart, but that separation is convention-per-file, not a package boundary — one careless barrel re-export in `src/index.ts` would put Neon/Upstash drivers on the engine's and web's dependency path. It also makes "affected" coarse: touching the DB schema redeploys nothing extra today (all three Fly apps depend on shared anyway), but touching a pure type in shared invalidates every cache.

**Recommendation:** No urgent action. When it next hurts, split along the existing seams: `@meldrank/contracts` (types/zod only, the true leaf) and `@meldrank/server-kit` (db/redis/log/env loaders). The subpath structure means call sites barely change. Size M-L; defer until after the High/Medium items.

### [SEVERITY: Low] Web declares its type-only dependency on the API as a runtime dependency

**Evidence:** `apps/web/package.json:17` — `"@meldrank/api": "workspace:*"` in `dependencies`; the only imports are `import type { AppRouter }` (`apps/web/lib/trpc.ts:3`, `apps/web/app/providers.tsx:3`).

**Why it matters:** It reads as a runtime app→app edge when it is actually a compile-time contract, and it pulls the API's runtime deps (`@clerk/backend`, `drizzle-orm`, `svix`) into web's install graph on Vercel. Harmless today (Next won't bundle unimported code), but it is exactly the edge that grows into a real boundary violation.

**Recommendation:** Move `@meldrank/api` to `devDependencies` in web, and add an ESLint `no-restricted-imports` rule for non-`type` imports of `@meldrank/api` in `apps/web`. Longer term the `AppRouter` type can live beside the other contracts in shared/contracts. Size S.

### [SEVERITY: Low] Duplicate module-resolution wiring: root tsconfig `paths` and per-package `exports` both map workspace names to source

**Evidence:** `tsconfig.base.json:36-43` maps all `@meldrank/*` to `packages/*/src/...`; each package's `package.json` `exports` maps the same names to the same files; `apps/web/tsconfig.json:9-13` re-declares its own copy *including* `"@meldrank/api": ["../../apps/api/src/index.ts"]`, and omits fairness/bots. There are no TypeScript project references; `typecheck` `dependsOn ^build` provides ordering only, so every app's `tsc` re-checks all dependency sources on every run.

**Why it matters:** Three places must stay in sync when a subpath is added (base paths, package exports, web's override) — the meld subpath already exists in only two of web's three lists. Duplicate re-checking of shared/engine sources inflates typecheck time as the repo grows. Not worth fixing at current size, but it is the root cause behind the Docker and build/typecheck findings (nothing emits, so everything resolves to source).

**Recommendation:** When adding emitted builds, drop the tsconfig `paths` entirely and let `exports` + `moduleResolution: "bundler"` resolve workspace deps (pnpm workspaces already do this); or adopt project references. Until then, at minimum delete web's redundant `paths` overrides for `engine`/`shared` (keep `@/*` and the `@meldrank/api` one). Size S-M.

### [SEVERITY: Low] Minor version/hygiene inconsistencies

**Evidence:**
- `drizzle-orm` pinned exact in api (`apps/api/package.json:18`, `"0.45.2"`) but caret-ranged in shared and match (`^0.45.2`) — pnpm can resolve two copies after a patch release, and Drizzle types don't mix across instances.
- `apps/match/package.json:24` puts `drizzle-orm` in `devDependencies` (used only by `writer.db.test.ts:1`) — correct today since runtime access goes through `@meldrank/shared/server`, but fragile: the first `eq()` in `writer.ts` becomes an undeclared runtime dep.
- Root `package.json:27` depends on `@meldrank/shared` (devDep) solely for `scripts/check-env-example.ts:10` — fine, just unusual; worth a comment.
- `infra/` contains only `README.md` (the runbook is good; the folder name over-promises — fly.toml/Dockerfiles live per-app, which is the better layout).
- Root hygiene is otherwise clean: no `.idea`, single-purpose `scripts/`, `openspec/` and `.agents/` are user-tool folders (noted, not issues). `drizzle.config.ts` at root is correct given the schema lives in `packages/shared` and migrations are a repo-level concern; just note that *running* migrations is manual (`infra/README.md` §1) — there is no migration step in CD, which is a deliberate but undocumented gap once the schema starts changing regularly.

**Recommendation:** Align `drizzle-orm` to one exact version via pnpm `overrides` or a catalog entry; add a one-line comment on the root shared devDep; decide and document the migration-deploy story (who runs `db:migrate` when a PR ships a schema change). Size S.

## Recommended action plan

Quick wins first:

1. **(S)** Fix the engine→shared dependency declaration (move to `dependencies` or relocate meld data into engine) and correct the ESLint comment; add `import-x/no-extraneous-dependencies` to lint so this class of bug fails CI. *(High finding #1)*
2. **(S)** Remove `bots` from the CD matrix and destroy/park the Fly app + secrets until the worker is real. *(Finding #3)*
3. **(S)** Collapse `build`/`typecheck` duplication: delete no-op `build` scripts, keep web's real build; CI stops double type-checking. *(Finding #4)*
4. **(S)** Wire local dev env loading (`tsx --env-file` or `process.loadEnvFile`) + declare dev-task env in `turbo.json`; document in `infra/README.md`. *(Finding #5)*
5. **(S)** Move `@meldrank/api` to web devDependencies + lint-restrict to type-only imports; align `drizzle-orm` versions; document the migration-run process. *(Findings #8, #10)*
6. **(S)** Add a Vitest setup to `apps/web` and cover the table store / connection hooks. *(Finding #6, part 1)*
7. **(M)** Prune production images: `pnpm deploy --prod` (or `turbo prune --docker`) per Fly app; optionally add a real emit step for server apps. Measurable cold-start and supply-chain win, especially for the scale-to-zero API. *(Finding #2)*
8. **(M)** One Playwright e2e smoke (web→api→match happy path) as a non-blocking CI job; promote to blocking once stable. *(Finding #6, part 2)*
9. **(M-L, defer)** Split `shared` into contracts vs server-kit when the grab-bag next causes friction; simultaneously drop tsconfig `paths` duplication or adopt project references. *(Findings #7, #9)*
