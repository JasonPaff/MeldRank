## Context

`apps/api` is a standalone tRPC server (`src/index.ts`:
`createHTTPServer(...).listen(port)`) with the runtime + CORS + stub-identity
context already factored into `src/context.ts` / `src/cors.ts` by the prior change.
The Vercel serverless adaptation from `add-api-vercel-entry` deploys but fails at
load: `@vercel/node` externalizes the `@meldrank/shared` workspace package, which is
published as raw TS source (the monorepo's "consume internal packages as TS source"
convention), so the function imports a `.ts` file Node's production loader rejects
(`ERR_MODULE_NOT_FOUND`).

`apps/match` and `apps/bots` don't have this problem: they ship a Docker image that
runs `pnpm --filter … start` → `tsx src/index.ts`, and `tsx` transpiles the
workspace TS at runtime. The API's `start` script is already `tsx src/index.ts`. So
the API can deploy the same way with **no server code change** — only new deploy
descriptors and the removal of the Vercel-specific files.

## Goals / Non-Goals

**Goals:**

- Deploy `apps/api` on Fly.io as a long-lived HTTP service, mirroring
  `apps/match`/`apps/bots`, so the TS-source workspace dependency just works.
- Remove the non-working Vercel serverless artifacts.
- Keep the standalone server and the `context.ts`/`cors.ts` extraction exactly as
  they are — they already serve the router with CORS + stub identity.
- Keep the env contract unchanged.

**Non-Goals:**

- No server/router/context behavior change.
- No Clerk/auth (unit E); no table UI (F2).
- No actual Fly provisioning or deploy, and no Vercel-project deletion — those are
  manual unit-H steps after this lands.
- No change to `apps/match` / `apps/bots`.

## Decisions

### 1. `apps/api/Dockerfile` mirrors `apps/match/Dockerfile`

Same multi-stage shape: `node:22-slim` base with corepack, a `deps` stage that
copies `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` + `packages` + `apps`
and runs `pnpm install --frozen-lockfile` from the **repo root** build context, and
a `runtime` stage with `NODE_ENV=production`. The only differences from match:
`EXPOSE 3001` and `CMD ["pnpm","--filter","@meldrank/api","start"]`. Build context is
the repo root (`fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile`
from root), so the whole pnpm workspace — including `@meldrank/shared` TS source — is
present and `tsx` resolves it at runtime.

- **Why mirror, not optimize:** consistency with the two proven sibling images; a
  leaner build (pruned install, prebuilt) is deferred hardening, not skeleton work.

### 2. `apps/api/fly.toml` — stateless HTTP service on 3001, scale-to-zero

```toml
app = "meldrank-api"
primary_region = "ord"
[build]
  dockerfile = "Dockerfile"
[env]
  NODE_ENV = "production"
  PORT = "3001"
[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- **Why scale-to-zero (vs match's `auto_stop = off`, `min = 1`):** the API is
  **stateless** — it holds no in-memory rooms, so a stopped machine loses nothing and
  Fly auto-starts it on the next request. Match must stay alive because stopping it
  drops live rooms. Cold-start latency on the first request after idle is acceptable
  for the walking skeleton; bump `min_machines_running` to 1 later if it bites.
- **Region `ord`** matches the siblings (keeps the api↔match hop in-region).

### 3. Standalone server is the deployed entry — unchanged

`src/index.ts` already validates env (fail-fast), builds the runtime via
`createApiRuntime`, and serves `appRouter` over `.listen(PORT)` with the shared CORS
middleware + `buildContext` stub identity. It is now **both** the local-dev entry
(`dev` = `tsx watch`) and the production entry (`start` = `tsx src/index.ts` in the
container). No change required.

### 4. The api↔match internal spawn seam still works on Fly

The API calls the match service's secret-gated `POST /internal/rooms` at
`MATCH_INTERNAL_URL`. With both apps on Fly this can stay the match service's public
HTTPS URL (the endpoint is gated by `INTERNAL_SPAWN_SECRET`), or later use Fly
private networking (`http://meldrank-match.flycast:2567`) to keep the internal route
off the public internet. The skeleton uses the simple public-URL form; private
networking is optional hardening noted for H. No code change either way — it is just
the value of `MATCH_INTERNAL_URL`.

### 5. Remove Vercel artifacts; revert the tsconfig include

Delete `apps/api/api/index.ts` and `apps/api/vercel.json`, and set
`apps/api/tsconfig.json` `include` back to `["src"]`. The `meld-rank-api` Vercel
project is decommissioned manually in H (not a repo edit).

## Risks / Trade-offs

- **Cold-start latency from scale-to-zero** → Mitigation: acceptable for the
  skeleton; raise `min_machines_running` to 1 if first-request latency matters.
- **`tsx` transpiles at runtime (no precompiled JS)** → Accepted: identical to the
  two sibling services already in production shape; a compiled build is deferred
  hardening, not a skeleton requirement.
- **Internal spawn endpoint reachable over the public URL** → Already gated by
  `INTERNAL_SPAWN_SECRET`; Fly private networking is available as later hardening.
- **Architecture deviation from Tech Architecture §7** → Recorded as a ruled fork;
  to be reflected in the Linear Tech Architecture doc. The deviation actually
  _increases_ consistency (all three server apps share one Docker + `tsx` runtime
  model).

## Migration Plan

1. Land the descriptors + deletions + doc updates.
2. `validate` agent: lint + typecheck + tests green for `apps/api` (this change only
   deletes Vercel files and reverts the tsconfig include — no TS behavior change, so
   the existing `api.test.ts` is unaffected).
3. Optionally validate the image locally with `fly deploy --config apps/api/fly.toml
--dockerfile apps/api/Dockerfile --build-only` (or `docker build`) from the repo
   root.
4. Unit H provisions `meldrank-api` on Fly (secrets via `fly secrets`), points the
   web app's `NEXT_PUBLIC_API_URL` at the Fly URL, and decommissions the
   `meld-rank-api` Vercel project.

**Rollback:** trivial — the standalone server and shared modules are untouched, so
reverting is just restoring the Vercel files; but the Vercel path is known-broken, so
there is nothing to roll back to.

## Open Questions

- `min_machines_running` 0 vs 1 — left at 0 (scale-to-zero) for cost; revisit if
  cold starts hurt the demo.
- Whether to switch `MATCH_INTERNAL_URL` to Fly private networking now or in a later
  hardening pass — defaulting to the public secret-gated URL for the skeleton.
