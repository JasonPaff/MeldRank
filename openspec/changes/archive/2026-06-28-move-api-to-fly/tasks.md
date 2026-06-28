## 1. Remove the Vercel serverless artifacts

- [x] 1.1 Delete `apps/api/api/index.ts` (the Vercel fetch-adapter handler) and remove the now-empty `apps/api/api/` directory.
- [x] 1.2 Delete `apps/api/vercel.json`.
- [x] 1.3 Revert `apps/api/tsconfig.json` `include` back to `["src"]`.

## 2. Add the API's Fly descriptors

- [x] 2.1 Add `apps/api/Dockerfile` mirroring `apps/match/Dockerfile`: multi-stage `node:22-slim` + corepack, a `deps` stage installing the full workspace from the repo-root build context (`pnpm install --frozen-lockfile`), and a `runtime` stage with `NODE_ENV=production`, `EXPOSE 3001`, `CMD ["pnpm","--filter","@meldrank/api","start"]`.
- [x] 2.2 Add `apps/api/fly.toml`: `app = "meldrank-api"`, `primary_region = "ord"`, `[build] dockerfile = "Dockerfile"`, `[env] NODE_ENV="production" PORT="3001"`, `[http_service] internal_port=3001 force_https=true auto_stop_machines="stop" auto_start_machines=true min_machines_running=0`, and a `[[vm]] shared-cpu-1x / 512mb`.

## 3. Update the provisioning runbook

- [x] 3.1 In `infra/README.md`, move `apps/api` from the Vercel section to the Fly section in the resource→env-variable map (Fly now hosts match + bots + api; Vercel hosts only web).
- [x] 3.2 In `infra/README.md`, update the provisioning steps: add `meldrank-api` to the Fly app-creation/secrets/deploy steps (secrets: `DATABASE_URL`, `UPSTASH_*`, `INTERNAL_SPAWN_SECRET`, `SEAT_TICKET_SECRET`, `MATCH_INTERNAL_URL`, `WEB_APP_ORIGIN`, `PORT`), remove `apps/api` from the Vercel-project steps, and note decommissioning the `meld-rank-api` Vercel project. Point the web app's `NEXT_PUBLIC_API_URL` at the Fly API URL.

## 4. Validate

- [x] 4.1 Run the `validate` agent (lint + typecheck + tests) across `apps/api`; confirm green (this change only deletes Vercel files and reverts the tsconfig include — `src/index.ts`, `context.ts`, `cors.ts`, and `api.test.ts` are unchanged). **Done — lint/typecheck PASS, 14 tests pass.**
- [x] 4.2 Confirm the Fly descriptor is sound. **`fly config validate` → valid.** **`docker build -f apps/api/Dockerfile .` → built clean.** Ran the image with dummy env: it booted under `tsx`, resolved the `@meldrank/shared` TS source at runtime (the exact import that failed `ERR_MODULE_NOT_FOUND` on Vercel), logged `[api] tRPC listening on :3001`, and served `GET /health` → `200 {"result":{"data":{"service":"api","ok":true}}}` with the single-origin CORS headers. No deploy here — that is unit H.
