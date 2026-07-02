# Audit: Dependencies & library usage

Audited 2026-07-01 against `main` (8277f09). Method: read all 9 `package.json` files, grepped every workspace's source for actual import specifiers, cross-checked `pnpm-lock.yaml` for resolved-version duplicates, ran `pnpm outdated -r` and `pnpm audit --prod`, and reviewed `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, and the three Fly Dockerfiles.

## Summary

The dependency layer is in unusually good shape for an agentically built repo: every declared dependency except one (`lucide-react`) is genuinely imported, there are **zero phantom (undeclared-but-imported) dependencies**, and the lockfile resolves exactly one version of every shared library (typescript 6.0.3, zod 4.4.3, react 19.2.7, drizzle-orm 0.45.2, vitest 4.1.9). TypeScript config is maximally strict and a single root flat ESLint config covers all workspaces with sensible boundary guards. The real issues are at the edges: the web app's headless-UI foundation (`@base-ui-components/react`) is a **deprecated RC of a renamed package**; the three Fly services ship production images containing the entire monorepo's devDependencies and run TypeScript through `tsx` at runtime; and `pnpm audit` reports two moderate transitive vulnerabilities (postcss via next, uuid via colyseus's auth chain). Everything else is polish: a type-only dep misplaced as a runtime dep in web, an exact-vs-caret pin inconsistency, and a turbo task graph that typechecks packages twice.

## Dependency inventory

| Workspace | Runtime deps (version) | Dev deps (notable) |
|---|---|---|
| **root** (`meldrank`) | — | eslint 10.5 + 12 plugins/configs, typescript ^6.0.3, typescript-eslint ^8.62, prettier ^3.8.4, turbo ^2.10, drizzle-kit ^0.31.10, tsx ^4.22.4, `@meldrank/shared` (for `scripts/` + drizzle.config.ts) |
| **apps/api** | @clerk/backend ^3.8.4, @trpc/server ^11.18, drizzle-orm **0.45.2 (exact)**, svix ^1.96.1, shared | tsx, typescript ^6.0.3, vitest ^4.1.9 |
| **apps/bots** (`@meldrank/bots-worker`) | engine, shared | tsx, typescript |
| **apps/match** | colyseus ^0.17.10, @colyseus/schema ^4.0.26, bots/engine/fairness/shared | drizzle-orm ^0.45.2 (test-only — correct), tsx, vitest |
| **apps/web** | next ^16.2.9, react/react-dom ^19.2.7, @clerk/nextjs ^7.5.9, @base-ui-components/react **1.0.0-rc.0**, @colyseus/sdk ^0.17.26, @tanstack/react-query ^5.101, @trpc/client + @trpc/tanstack-react-query ^11.18, next-typesafe-url ^6.1, nuqs ^2.8.9, zustand ^5.0.14, zod ^4.4.3, cva/clsx/tailwind-merge, **lucide-react ^1.21 (unused)**, `@meldrank/api` (type-only) | tailwindcss ^4.3.1 + @tailwindcss/postcss, tw-animate-css, react-query-devtools, concurrently, @types/react(-dom) |
| **packages/bots** | engine, shared | vitest |
| **packages/engine** | **none** (zero-runtime-dep by design, enforced via lint/type-only imports) | vitest |
| **packages/fairness** | @noble/hashes ^2.0.0, zod ^4.4.3, engine | vitest |
| **packages/shared** | @neondatabase/serverless ^1.1.0, @upstash/redis ^1.38, drizzle-orm ^0.45.2, pino ^10.3.1, @noble/hashes ^2.0.0, zod ^4.4.3 | pino-pretty ^13.1.3, vitest |

Common dev pins are identical everywhere: `typescript ^6.0.3`, `eslint ^10.5.0`, `@types/node ^22.20.0`, `vitest ^4.1.9`. `pnpm-workspace.yaml` defines only the package globs — **no catalog is used**.

## Findings

### Unused / phantom dependencies

#### [SEVERITY: Low] `lucide-react` is declared in web but never imported

- Evidence: `apps/web/package.json:26` declares `lucide-react ^1.21.0`. Grep of `apps/web/{app,components,lib,middleware.ts}` finds zero imports; the only mention is `apps/web/components.json:13` (`"iconLibrary": "lucide"` — shadcn scaffolding config, not code).
- Why it matters: dead install weight and a misleading signal that icons come from lucide. It never enters the bundle (unimported), so impact is install-time only.
- Recommendation: remove it, or keep it deliberately if shadcn component generation is imminent — but then add one real usage. Also note it's a minor behind (1.21.0 → 1.23.0) if kept.

#### [SEVERITY: Low] No phantom dependencies found (positive)

- Every external specifier imported in each workspace's source is declared in that workspace's own `package.json` (verified by extracting all `from '...'` specifiers per workspace and diffing against declarations). `drizzle-orm` in `apps/match` looked suspicious but is imported only by `apps/match/src/persistence/writer.db.test.ts:1`, so its devDependency placement is correct. Root's `@meldrank/shared` devDep is justified by `scripts/check-env-example.ts:10` and `drizzle.config.ts`.
- No action needed; recorded so future audits don't re-litigate it.

### Version drift

#### [SEVERITY: Low] `drizzle-orm` pinned exact in api, caret elsewhere

- Evidence: `apps/api/package.json:18` → `"drizzle-orm": "0.45.2"` (exact); `packages/shared/package.json:32` and `apps/match/package.json:24` → `"^0.45.2"`.
- Why it matters: today the lockfile resolves a single `drizzle-orm@0.45.2` everywhere. The moment shared updates within the caret range, api's exact pin forks the tree into two drizzle instances — drizzle is exactly the kind of package where two copies cause subtle type/`instanceof` breakage across the shared db client.
- Recommendation: change api's pin to `^0.45.2` (or better, adopt a catalog — see adoption candidates).

#### [SEVERITY: Low] No repo-wide version drift otherwise (positive)

- `pnpm-lock.yaml` resolves exactly one version each of typescript (6.0.3), zod (4.4.3), react (19.2.7), react-dom, vitest (4.1.9), pino (10.3.1), @noble/hashes, drizzle-orm. Dev pins (`typescript ^6.0.3`, `eslint ^10.5.0`, `@types/node ^22.20.0`, `vitest ^4.1.9`) are textually identical across all 9 manifests. This is maintained by hand today — the catalog recommendation below makes it structural.

### Misplaced dependencies

#### [SEVERITY: Medium] `tsx` is the de-facto production runtime for all three Fly services, but declared as a devDependency

- Evidence: `apps/api/package.json` — `"start": "tsx src/index.ts"` with tsx under `devDependencies` (line 24); same pattern in `apps/match` and `apps/bots`. The Dockerfiles run that start script in production: `apps/api/Dockerfile:28`, `apps/match/Dockerfile:26`, `apps/bots/Dockerfile` (`CMD ["pnpm", "--filter", ..., "start"]`).
- Why it matters: this only works because the Docker `deps` stage (`apps/api/Dockerfile:21`) runs `pnpm install --frozen-lockfile` with no `--prod` and no `NODE_ENV=production` set in that stage, so **all devDependencies of every workspace land in every production image**. Anyone who "fixes" the Docker install to `--prod` (an obvious hardening move) silently breaks all three services at boot. It also means each Fly image carries Next.js, Tailwind, eslint, vitest, drizzle-kit, etc. — larger images, slower pulls and cold starts (a known pain point per your Fly setup), and a bigger supply-chain surface in prod.
- Recommendation: two options, in order of preference. (a) Add a real build step (`tsc` emit or `esbuild`/`tsup` bundle) per service and run `node dist/index.js` from a pruned image (`pnpm --filter <app> deploy --prod` gives a minimal, self-contained output). (b) Minimal fix: move `tsx` to `dependencies` in the three service apps and keep the current full-workspace image, accepting the size cost knowingly. Either way, document the choice in the Dockerfile comment (it currently documents the tsx-transpiles-at-runtime choice but not the devDeps-in-prod consequence).

#### [SEVERITY: Medium] `@meldrank/api` is a runtime dependency of web but only type-imported

- Evidence: `apps/web/package.json:18` declares `"@meldrank/api": "workspace:*"` under `dependencies`. Its only imports are `import type { AppRouter }` at `apps/web/app/providers.tsx:3` and `apps/web/lib/trpc.ts:3`.
- Why it matters: declaring it as a runtime dep drags the api's production graph (`@clerk/backend`, `drizzle-orm`, `svix`) into web's install on Vercel. Nothing server-only leaks into the browser bundle (imports are type-only and erased — `verbatimModuleSyntax` guarantees it), but it inflates installs and blurs the carefully enforced web/server boundary (`eslint.config.mjs:80-98` exists precisely to police this boundary for `@meldrank/shared/server`).
- Recommendation: move `@meldrank/api` to `devDependencies` in `apps/web/package.json`. Type-only consumers only need it at typecheck/build time.

#### [SEVERITY: Low] `ReactQueryDevtools` imported unconditionally from a devDependency in production code

- Evidence: `apps/web/app/providers.tsx:7` imports `@tanstack/react-query-devtools`, declared under `devDependencies` (`apps/web/package.json:38`).
- Why it matters: it works — Vercel installs devDeps at build time and the devtools package exports a production no-op — but it's the one place in the repo where production source imports a devDependency, which is exactly the phantom-dep shape this audit checks for. A future switch to `--prod` installs or a different bundler default would surface it.
- Recommendation: switch to the documented lazy pattern (`import('@tanstack/react-query-devtools/production')` behind a flag) or just leave it with a comment; if left, this is accepted-risk, not a bug.

#### [SEVERITY: Low] `pino-pretty` is a devDependency but referenced at runtime via transport string

- Evidence: `packages/shared/src/server/log/index.ts:74` — `transport: { target: 'pino-pretty' }` when `pretty` is enabled outside production; `pino-pretty` sits in `devDependencies` (`packages/shared/package.json:39`).
- Why it matters: pino resolves the transport by module name at runtime. Today all deployed environments run `NODE_ENV=production` (transport never enabled) and local installs include devDeps, so it works. A future "staging" Fly app with `NODE_ENV !== 'production'` and pruned installs would crash the logger at boot.
- Recommendation: no change needed now; add a one-line comment at the transport site noting the devDep coupling, or guard with a resolvable check.

### Reinvented wheels

#### [SEVERITY: Low] No significant wheel-reinvention found (positive)

Checked the usual suspects; the repo consistently uses its installed libraries:
- Class merging: `apps/web/lib/utils.ts` is the canonical `cn()` over `clsx` + `tailwind-merge` — no hand-rolled string concat elsewhere.
- Data fetching: all web data access goes through tRPC + TanStack Query (`apps/web/lib/trpc.ts`); zero hand-rolled `fetch()` wrappers in web (the only `fetch(` grep hit is `open.refetch()`, a query method).
- Validation: env loading is zod-schema'd in shared (`apps/web/lib/env.ts` → `loadWebEnv`); webhook payloads verified via `svix` (`apps/api/src/webhook.ts:79`); no ad-hoc validators found alongside zod.
- Logging: services use the shared pino logger, enforced by `no-console` lint (`eslint.config.mjs:99-108`).
- The one hand-rolled pattern — bounded retry/backoff for durable writes in `apps/match/src/colyseus/matchRoom.ts` (lines 98, 517, 574) — is a documented design seam ("design D5"), small, and test-covered; pulling in `p-retry` for it would be net-negative. Same for the injected `Math.random` seam in `packages/bots/src/types.ts:18-25`, which is deliberate DI, not missing a library.

### Security / maintenance

#### [SEVERITY: High] `@base-ui-components/react` is a deprecated RC — the package was renamed

- Evidence: `apps/web/package.json:15` pins `@base-ui-components/react ^1.0.0-rc.0`. `pnpm outdated -r` flags it "Deprecated"; the npm registry confirms: `"deprecated": "Package was renamed to @base-ui/react"` and `dist-tags.latest` is still `1.0.0-rc.0` — the old name will never receive another release, including security fixes. Used in `apps/web/components/ui/badge.tsx:3-4` and `button.tsx:3-4` (`mergeProps`, `useRender`).
- Why it matters: this is the headless-UI foundation of the web app frozen on a release-candidate of an abandoned package name. Every future Base UI bug fix, a11y fix, and React-version compat fix ships only to `@base-ui/react`.
- Recommendation: migrate to `@base-ui/react` at its current stable. Surface area is tiny today (two files, two utility imports), so this is cheap now and gets more expensive with every shadcn-style component added. Verify `mergeProps`/`useRender` subpath names against the renamed package's 1.0 API when migrating.

#### [SEVERITY: Medium] `pnpm audit --prod`: 2 moderate + 1 low, all transitive

- Evidence (full audit output summarized):
  - **moderate** — `postcss < 8.5.10` XSS in stringify output (GHSA-qx2v-qp2m-jg93), path `apps/web > next > postcss` (next 16.2.9 pins postcss 8.4.31).
  - **moderate** — `uuid < 11.1.1` buffer bounds (GHSA-w5hq-g745-h8pq), path `apps/match > colyseus > @colyseus/auth > grant > request-oauth > uuid`.
  - **low** — `elliptic <= 6.6.1` risky primitive (GHSA-848j-6mx2-7j84), same `@colyseus/auth > grant` chain.
- Why it matters: none is directly exploitable here (postcss runs at build time; the `grant` OAuth chain inside `@colyseus/auth` is unused — match imports only `colyseus`/`@colyseus/schema`), but they will fail any CI audit gate you add during hardening, and the `grant` chain is dead weight shipping in the match image.
- Recommendation: bump `next` to 16.2.10 (also picks up the eslint-plugin pairing) and re-audit; add `pnpm.overrides` in the root `package.json` for `uuid` and `elliptic` if colyseus doesn't update, e.g. `"overrides": { "uuid@<11.1.1": ">=11.1.1" }`. Consider asking upstream/checking whether `@colyseus/auth` is severable.

#### [SEVERITY: Low] Routine minor-version lag; `@types/node` intentionally behind

- Evidence: `pnpm outdated -r` — all gaps are patch/minor (`@clerk/backend` 3.8.4→3.10.0, `@clerk/nextjs` 7.5.9→7.5.12, next/turbo/eslint/prettier/nuqs one notch behind). `@types/node` is 22.20.0 vs latest 26.1.0 — but `engines.node >= 22` (root `package.json:7`) and the Fly images are `node:22-slim`, so types@22 is the *correct* pairing, not drift.
- Recommendation: batch the minor bumps in one PR (Clerk packages first — auth fixes land there). Keep `@types/node` on 22.x until the runtime moves; add a comment in the root manifest so a well-meaning bump doesn't outrun the runtime.

### Tooling configuration

#### [SEVERITY: Low] Turbo task graph: package `build` and `typecheck` are the same command, run twice

- Evidence: every package's `build` and `typecheck` scripts are both `tsc --noEmit -p tsconfig.json` (e.g. `packages/engine/package.json:15,18`). `turbo.json` has `typecheck: { dependsOn: ["^build"] }` and `test: { dependsOn: ["^build"] }`, and `build: { dependsOn: ["^build"], outputs: [] }`.
- Why it matters: a full `turbo run typecheck` typechecks each package once as its dependents' `^build` and again as its own `typecheck` — pure duplication (mitigated by turbo cache on warm runs, paid in full on cold CI). `outputs: []` on a no-emit build is fine, but the task graph is pretending there's a build artifact when there isn't; only `@meldrank/web#build` produces output.
- Recommendation: either drop the package-level `build` scripts and point `dependsOn` at `^typecheck`, or leave `build` as an alias but remove `^build` from `typecheck`'s dependsOn. Small change, meaningfully faster cold CI.

#### [SEVERITY: Low] tsconfig and ESLint setup are strong (positive — keep as-is)

- `tsconfig.base.json` has `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, `isolatedModules` — the full strictness menu (lines 16-22).
- A single root `eslint.config.mjs` covers all 8 workspaces (each runs `eslint .`, flat config resolves upward), with type-aware linting via `projectService`, a web↔server boundary guard (lines 80-98), a `no-console` guard on services (99-108), and scoped React/Next/Tailwind/Query presets for web only. No workspace escapes coverage. Nothing to fix; recorded as the baseline the hardening effort should preserve.

### Adoption candidates

#### [SEVERITY: Medium] Adopt pnpm catalogs for the ~6 versions repeated across all manifests

- Evidence: `typescript ^6.0.3`, `eslint ^10.5.0`, `@types/node ^22.20.0`, `vitest ^4.1.9`, `tsx ^4.22.4`, `zod ^4.4.3` are hand-duplicated across up to 9 `package.json` files; `pnpm-workspace.yaml` has no `catalog:` block. The api drizzle-orm exact-pin drift above is exactly the failure mode catalogs prevent.
- Recommendation: add a `catalog:` in `pnpm-workspace.yaml` for the shared pins and replace versions with `"catalog:"` references. Mechanical, one PR, removes an entire class of drift.

#### [SEVERITY: Low] Add `knip` to CI for dependency/export hygiene

- Evidence: this audit found one unused dep (`lucide-react`) by manual grep; knip automates exactly that check (plus unused exports/files) and understands pnpm workspaces and Next.js.
- Recommendation: `knip` as a root devDependency with a `lint:deps` turbo task. Small setup cost, keeps the currently clean dependency layer clean as the codebase grows fast.

#### [SEVERITY: Low] `@clerk/backend`'s `verifyWebhook` could replace the direct `svix` dependency

- Evidence: `apps/api/src/webhook.ts:2,79` verifies Clerk webhooks with `svix`'s `Webhook` class directly; `@clerk/backend ^3.8.4` (already a dependency) ships `verifyWebhook` for this exact purpose.
- Recommendation: optional. Switching drops one direct dependency and tracks Clerk's own signature-verification updates. The current code is correct and well-tested (`webhook.test.ts` signs with real svix), so only do this opportunistically.

No other libraries are recommended. The stack already covers state (zustand), URL state (nuqs), data (tRPC + TanStack Query), validation (zod), hashing (@noble/hashes), and logging (pino); suggesting more would be padding.

## Recommended action plan

Quick wins first:

1. **(S)** Move `@meldrank/api` to web's `devDependencies`; remove (or start using) `lucide-react`. — misplaced/unused deps
2. **(S)** Change api's `drizzle-orm` pin to `^0.45.2`. — drift fuse
3. **(S)** Bump `next` to 16.2.10 and add `pnpm.overrides` for `uuid`/`elliptic`; re-run `pnpm audit --prod` to zero. — audit findings
4. **(S)** Batch minor bumps: `@clerk/backend`, `@clerk/nextjs`, turbo, eslint, prettier, nuqs, tailwind. Comment why `@types/node` stays on 22.
5. **(M)** Migrate `@base-ui-components/react` → `@base-ui/react` (2 files import it today; do it before more shadcn components multiply the surface). — the one High
6. **(M)** Add pnpm `catalog:` for typescript/eslint/@types/node/vitest/tsx/zod and point all manifests at it.
7. **(M)** Fix the turbo graph: stop double-typechecking packages (`^typecheck` instead of `^build`, or drop package `build` scripts).
8. **(M)** Add `knip` to CI as a dependency-hygiene gate.
9. **(L)** Rework the three Fly Dockerfiles: real build step (tsup/esbuild or tsc emit) + `pnpm --filter <app> deploy --prod`, so images stop shipping the whole monorepo's devDependencies and `tsx` stops being the production runtime. Biggest payoff of the list for image size, cold starts, and supply-chain surface; coordinate with whoever owns the deploy pipeline since it touches CD.
