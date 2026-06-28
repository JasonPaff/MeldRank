## REMOVED Requirements

### Requirement: Vercel serverless function entry

**Reason**: `apps/api` is no longer a Vercel serverless function. Vercel's
`@vercel/node` builder externalizes the `@meldrank/shared` workspace dependency,
which the monorepo publishes as raw TS source, so the deployed function fails at
load with `ERR_MODULE_NOT_FOUND` importing a `.ts` file Node's production ESM loader
cannot execute.
**Migration**: The standalone `src/index.ts` tRPC server now deploys on Fly via
Docker + `tsx` (see the `deployment-config` _Fly.io deploy descriptors_
requirement), which transpiles the workspace TS at runtime.

### Requirement: Stub-identity context in the function

**Reason**: There is no serverless function. Stub-identity context building survives
unchanged as ordinary server code in `src/context.ts` (`buildContext`), used by the
standalone server.
**Migration**: `apps/api/src/index.ts` resolves the caller via `resolveStubIdentity`
through `buildContext` exactly as before; real auth remains deferred to the Auth &
Identity unit.

### Requirement: Single-origin CORS in the function

**Reason**: There is no serverless function. The single-origin CORS policy survives
unchanged as ordinary server code in `src/cors.ts`, applied by the standalone
server's middleware.
**Migration**: `apps/api/src/index.ts` reflects `WEB_APP_ORIGIN` and short-circuits
the `OPTIONS` preflight via the shared `corsHeaders` helper, identical behavior.

### Requirement: Standalone dev server preserved

**Reason**: The standalone `.listen()` server is no longer merely a local-dev entry
preserved alongside a function — it **is** the deployed artifact (on Fly). There is
no second serving path to keep in sync.
**Migration**: `apps/api/src/index.ts` is both the local-dev entry
(`pnpm --filter @meldrank/api dev`) and the production entry
(`pnpm --filter @meldrank/api start` inside the Fly container).

### Requirement: All tRPC paths reach the function

**Reason**: There is no function or rewrite. The standalone tRPC HTTP server serves
every procedure path at the origin root natively.
**Migration**: The web client reaches every procedure through its configured
`NEXT_PUBLIC_API_URL` (now the Fly API URL) exactly as the standalone server already
serves them.
