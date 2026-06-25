## 1. Root workspace & tooling

- [x] 1.1 Add root `package.json` with `packageManager` (pinned pnpm), `engines.node`, and `private: true`
- [x] 1.2 Add `pnpm-workspace.yaml` declaring `packages/*` and `apps/*`
- [x] 1.3 Add `.nvmrc` pinning Node 22 LTS (and matching `engines.node`)
- [x] 1.4 Add `turbo.json` with `build`, `typecheck`, `lint`, `test`, `dev` pipelines and correct `dependsOn` ordering
- [x] 1.5 Add root scripts wiring `build` / `typecheck` / `lint` / `test` / `dev` to Turbo
- [x] 1.6 Add base strict `tsconfig.base.json` and `@meldrank/*` path mappings
- [x] 1.7 Add lint + format config (ESLint flat config + Prettier per D4) and a root `.gitignore`
- [x] 1.8 Complete .gitignore coverage (node_modules, build outputs, env files, editor/OS cruft, Turbo/Next caches)
- [x] 1.9 Bump all dependencies to latest stable and re-verify

## 2. Shared package (`packages/shared`)

- [x] 2.1 Create `packages/shared/package.json` as `@meldrank/shared` with Zod dependency
- [x] 2.2 Add `tsconfig.json` extending the base config
- [x] 2.3 Add a minimal exported symbol + Zod schema placeholder to prove imports/typecheck
- [x] 2.4 Add a placeholder Vitest test

## 3. Engine package (`packages/engine`)

- [x] 3.1 Create `packages/engine/package.json` as `@meldrank/engine` with **zero runtime dependencies** (devDeps only)
- [x] 3.2 Add `tsconfig.json` extending the base config
- [x] 3.3 Add a minimal exported stub and confirm it builds with no runtime deps
- [x] 3.4 Wire Vitest and add a passing placeholder test

## 4. Apps (stubs only)

- [x] 4.1 `apps/web`: scaffold Next.js app (`@meldrank/web`), import a symbol from `@meldrank/shared`, builds and runs `dev`
- [x] 4.2 `apps/api`: tRPC server stub (`@meldrank/api`) importing `@meldrank/shared`, type-checks and starts
- [x] 4.3 `apps/match`: Colyseus server entry (`@meldrank/match`) that boots and imports `@meldrank/shared`
- [x] 4.4 `apps/bots`: bot worker entry (`@meldrank/bots`) that starts cleanly and imports `@meldrank/shared`
- [x] 4.5 Ensure every app extends the base `tsconfig` and uses `workspace:*` for internal deps

## 5. Verification

- [x] 5.1 `pnpm install` resolves all six workspaces; `pnpm -r list --depth -1` shows exactly the §7 set
- [x] 5.2 `pnpm typecheck` passes in strict mode across all workspaces
- [x] 5.3 `pnpm lint` passes across all workspaces
- [x] 5.4 `pnpm test` runs Vitest in `packages/engine` (and `packages/shared`) and passes
- [x] 5.5 `pnpm build` builds all workspaces successfully
- [x] 5.6 Confirm `packages/engine` has no runtime `dependencies` and each app successfully imports from `@meldrank/shared`
