## Context

`apps/api` today is a single standalone entry: `src/index.ts` validates the env,
builds the runtime dependencies (db, redis, casual-table store, ticket minter,
HTTP spawn client), and serves `appRouter` through `@trpc/server`'s
`createHTTPServer(...).listen(port)` with a CORS middleware. That is a long-lived
process — the wrong shape for Vercel, which invokes per-request **serverless
functions**. The `meld-rank-api` Vercel project is already created and linked
(root dir `apps/api`, Node 24.x) but its `vercel.json` only declares a
`tsc --noEmit` build that produces no deployable artifact, so a deploy yields a
404 shell.

The web client reaches the API through `httpBatchLink({ url: NEXT_PUBLIC_API_URL })`
— i.e. tRPC procedure paths hang directly off the API origin root
(`https://…/account.getMe?batch=1`). Tech Architecture §7 locks the API as
"stateless tRPC on Vercel," and Jason ruled the design-faithful baseline (adapt to
serverless) over relocating to Fly. This design is how that adaptation works
without disturbing the routers, the contracts, or local dev.

## Goals / Non-Goals

**Goals:**

- Make `apps/api` deploy to Vercel as a serverless function serving the full
  `appRouter`, reachable at the API origin root by the existing web client.
- Reproduce the single-origin `WEB_APP_ORIGIN` CORS policy and `OPTIONS`
  preflight short-circuit exactly in the function path.
- Keep `src/index.ts` working as the local dev server, sharing router + context
  logic with the function (no divergent second copy).
- Bundle the `@meldrank/shared` workspace dependency for the function in the
  monorepo.

**Non-Goals:**

- No Clerk/auth wiring — identity stays stubbed (`resolveStubIdentity`); unit E.
- No router/procedure/contract changes — behavior is identical to today.
- No actual provisioning or deploy — that is the rest of unit H, by hand.
- No Edge runtime — Node serverless only (the deps require it; see Decisions).

## Decisions

### 1. Fetch adapter in a single `api/index.ts` function (Node runtime)

Serve the router with `fetchRequestHandler` from
`@trpc/server/adapters/fetch` in one function file, `apps/api/api/index.ts`,
exporting a Web handler `(req: Request) => Promise<Response>`. Vercel auto-detects
files under `api/` as functions for a `framework: null` project.

- **Why fetch adapter over the Node `(req,res)` http adapter:** it returns a
  `Response`, which is the cleanest fit for Vercel's Web-handler signature and lets
  CORS headers be attached to a real response object.
- **Why Node, not Edge:** the dependencies forbid Edge — the Neon serverless
  driver, the Upstash REST client, and the HMAC seat-ticket signing
  (`@meldrank/shared/server`) target Node. Node 22+ provides global
  `Request`/`Response`/`fetch`, so the fetch adapter runs natively.
- **Alternative considered — `api/[trpc].ts` catch-all with `endpoint: '/api'`:**
  rejected because it forces `NEXT_PUBLIC_API_URL` to carry an `/api` suffix,
  coupling the web env to the hosting detail. The root-rewrite below keeps the
  API origin clean.

### 2. Route every path to the function via explicit `builds` + `routes`

**Resolved during apply (local `vercel build` proved the zero-config path wrong).**
This is a **functions-only** project — no static frontend — and Vercel's
zero-config kept treating it as a static build: with a custom `buildCommand` it
ran `@vercel/static` and never detected `api/`; with the `buildCommand` removed it
ran the package `tsc` build and failed on a missing `public/` output dir. Neither
produced a function and the `rewrites` were dropped. The reliable fix for a
functions-only project is the explicit legacy config:

```json
"builds": [{ "src": "api/index.ts", "use": "@vercel/node" }],
"routes": [{ "src": "/(.*)", "dest": "/api/index.ts" }]
```

This bypasses framework/static heuristics: `@vercel/node` builds `api/index.ts`
directly, and `routes` send every path to it. Verified locally — the build emits
`functions/api/index.ts.func` and routes `^/(.*)$ → /api/index.ts`. The function
is configured with `fetchRequestHandler({ endpoint: '' })` so it parses the
procedure path (`account.getMe`) straight from the request pathname, matching how
the standalone server serves tRPC at the origin root.

- **Why over zero-config `rewrites`:** zero-config function detection does not fire
  for a functions-only monorepo project; `builds`+`routes` is deterministic and
  self-contained. The web client's `NEXT_PUBLIC_API_URL` still points at the bare
  origin (no per-procedure or base-path change).
- **Alternative — point the web client at `/api`:** rejected (see Decision 1).
- **Trade-off:** `builds` is the "legacy" routing model and disables a few modern
  features (e.g. `rewrites`/`headers` keys), which this functions-only project does
  not need.

### 3. Extract shared router-context construction; keep `src/index.ts` for dev

Factor the dependency construction + context-building + CORS values out of
`src/index.ts` into a shared module (e.g. `src/context.ts` / `src/cors.ts`) that
both entries import. `src/index.ts` keeps `createHTTPServer(...).listen(port)` for
`pnpm --filter @meldrank/api dev`; `api/index.ts` imports the same factory and CORS
constants. One source of truth for how a request becomes a tRPC context.

- **Why:** avoids two divergent copies of dependency wiring + identity resolution;
  satisfies the "standalone dev server preserved" requirement.

### 4. CORS reconciled in the handler

The handler reproduces the standalone middleware: for `OPTIONS`, return
`new Response(null, { status: 204, headers: corsHeaders })` before touching the
adapter; otherwise call `fetchRequestHandler` and attach the same
`Access-Control-Allow-Origin: <WEB_APP_ORIGIN>` + `Vary: Origin` +
allow-methods/headers to the returned `Response`. The single env-driven origin
(never `*`) is reused verbatim from the shared CORS constants.

### 5. `@vercel/node` builds + bundles the function; the package `tsc` is the gate

The deploy artifact is the function, compiled and bundled by `@vercel/node`
(esbuild), which follows the `workspace:*` symlink and bundles `@meldrank/shared`
source. The `installCommand` (`pnpm install --frozen-lockfile`) provides the
symlinked workspace package. With the `builds` config Vercel no longer runs a
project build step, so the package `tsc --noEmit` typecheck runs via the
`validate` agent and CI rather than as part of the Vercel build.

- **Verified at apply time (local `vercel build`):** the build emits the function
  and the bundle includes `@meldrank/shared` (e.g. `signSeatTicket` lands in the
  bundled `tickets.js`) — the design's top risk is cleared.
- **Cosmetic type-check noise (accepted):** `@vercel/node` runs its own
  `nodenext`-resolution type-check and prints `TS2305`/`TS2835` against
  `@meldrank/shared` **type-only** imports (e.g. in `spawn-flow.ts`) and
  extensionless relative imports. These are erased by esbuild, the build still
  reports `ok`, and the function runs — so they are non-fatal. They stem from our
  project using bundler-style resolution while `@vercel/node` forces `nodenext`;
  not worth contorting the source to silence for the skeleton.

## Risks / Trade-offs

- **`@vercel/node` may not cleanly bundle workspace TS source** (subpath export
  `@meldrank/shared/server`, `.ts` sources) → Mitigation: validate with local
  `vercel build` before deploy; if bundling fails, add `functions`/`includeFiles`
  config or a prebuilt emit step. The standalone server is untouched, so this is a
  build-config problem, not a code rewrite.
- **Vercel Node runtime rejects the Web-handler `(Request)=>Response` signature**
  → Mitigation: wrap the fetch adapter in the Node `(req, res)` signature instead
  (translate `req`→`Request`, pipe the `Response` back). Same adapter, different
  envelope; isolated to `api/index.ts`.
- **Catch-all rewrite swallows non-tRPC routes** → Acceptable: the API serves only
  tRPC; there are no health/static routes to preserve. A dedicated health path can
  be added later as its own function above the rewrite if needed.
- **Cold-start dependency construction cost** → Acceptable for the skeleton;
  module-scope construction is reused across warm invocations, and the Neon/Upstash
  clients are HTTP/REST (no connection pools to warm).

## Migration Plan

1. Land the code (function entry, shared extraction, `vercel.json`).
2. `validate` agent: lint + typecheck + tests green across `apps/api`.
3. Local `vercel build` against the linked `meld-rank-api` project to confirm the
   function compiles and the workspace dep bundles (catches the top two risks
   before any cloud deploy).
4. Real deploy happens later in unit H, after Neon/Upstash/env are provisioned.

**Rollback:** `src/index.ts` is unchanged, so local dev is never at risk. If
Vercel serverless proves unworkable, the previously-flagged Fly alternative
(deploy `apps/api` as a long-lived Node server like `apps/match`) remains open as a
follow-up change.

## Open Questions

- **Resolved:** local `vercel build` confirmed `@vercel/node` bundles
  `@meldrank/shared` from the monorepo and accepts the Web-handler
  `(Request)=>Response` signature. No fallback to the Node `(req,res)` envelope was
  needed.
- **Hand-off to unit H — Vercel project linking is misconfigured.** The
  `meld-rank-api` project has **Root Directory = `apps/api`** in its dashboard
  settings, but the `.vercel` link lives *inside* `apps/api`. Running
  `vercel build --cwd apps/api` then applies the root directory a second time and
  Vercel builds the wrong (empty) directory as a static site. Before the real
  deploy, H must reconcile this — either **clear the dashboard Root Directory**
  (deploy from `apps/api`, where the link is) or **move the link to the repo root**
  and keep Root Directory = `apps/api`. This is a provisioning fix, outside this
  change's code; the local build above used a neutralized root to prove the
  function output.
