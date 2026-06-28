## 1. Extract shared serving logic

- [x] 1.1 Factor the runtime dependency construction (db, redis, casual-table store, ticket minter, HTTP spawn client) and tRPC context-building out of `apps/api/src/index.ts` into a shared module (e.g. `src/context.ts`) that exposes a factory both entries can call.
- [x] 1.2 Factor the CORS values (the `WEB_APP_ORIGIN`-driven allow-origin/methods/headers + the `OPTIONS` 204 short-circuit) into a shared module (e.g. `src/cors.ts`) so the standalone server and the function apply one identical policy.
- [x] 1.3 Rewrite `src/index.ts` to consume the shared context + CORS modules while keeping `createHTTPServer(...).listen(port)` unchanged in behavior (local `pnpm --filter @meldrank/api dev` still boots and listens).

## 2. Serverless function entry

- [x] 2.1 Add `apps/api/api/index.ts` exporting a Web handler `(req: Request) => Promise<Response>` that serves `appRouter` via `fetchRequestHandler` (`@trpc/server/adapters/fetch`) with `endpoint: ''`.
- [x] 2.2 Build the request context in the handler from the shared factory, resolving the caller via `resolveStubIdentity` over the request headers (identical `playerId` semantics to the standalone server).
- [x] 2.3 Apply CORS in the handler from the shared module: short-circuit `OPTIONS` with `204` before the adapter, and attach the `WEB_APP_ORIGIN` allow-origin (+ `Vary: Origin`, methods, headers) to the adapter's `Response`.
- [x] 2.4 Construct the runtime dependencies at module scope in the function so warm invocations reuse them.

## 3. Vercel descriptor + routing

- [x] 3.1 Update `apps/api/vercel.json` to route all paths to the function: add `rewrites: [{ "source": "/(.*)", "destination": "/api" }]` so tRPC procedure paths off the origin root reach `api/index`.
- [x] 3.2 Reconcile the `vercel.json` build/install so the function is the deploy artifact (keep `pnpm install --frozen-lockfile`; keep or adjust the turbo `tsc --noEmit` build as a typecheck gate that need not emit) and the `@meldrank/shared` workspace dependency resolves for `@vercel/node`.
- [x] 3.3 Remove the stale `apps/api/.vercel/output` 404-shell artifacts so they don't shadow the new function output.

## 4. Validate

- [x] 4.1 Run the `validate` agent (lint + typecheck + tests) across `apps/api`; confirm green and that `src/routers/api.test.ts` still passes against the shared context factory.
- [x] 4.2 Run a local `vercel build` against the linked `meld-rank-api` project to confirm the function compiles and `@meldrank/shared` / `@meldrank/shared/server` bundles; if it fails, apply the design's fallback (Node `(req,res)` signature and/or `functions`/`includeFiles` config). No cloud deploy here — that is unit H.
