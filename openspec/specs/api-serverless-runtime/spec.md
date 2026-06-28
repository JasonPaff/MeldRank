# api-serverless-runtime Specification

## Purpose

Define how `apps/api` runs as a Vercel serverless function — serving the full tRPC
`appRouter` via the fetch adapter with stub-identity context and single-origin CORS —
while preserving the standalone `.listen()` server as a shared local development entry.

## Requirements

### Requirement: Vercel serverless function entry

`apps/api` SHALL provide a Vercel serverless function entry that serves the full
tRPC `appRouter` via the tRPC fetch adapter, so the deployed API is a
request/response function rather than a long-lived `.listen()` process. The entry
SHALL construct its runtime dependencies (database client, Redis client,
casual-table store, seat-ticket minter, and the HTTP match-spawn client) once at
module scope and reuse them across requests served by the same warm instance.

#### Scenario: Function serves a tRPC procedure

- **WHEN** an HTTP request for a tRPC procedure in `appRouter` reaches the
  deployed function
- **THEN** the function handles it through the fetch adapter and returns the
  procedure's tRPC response, without any process binding a listen port

#### Scenario: Dependencies built once per instance

- **WHEN** the function module initializes on a cold start
- **THEN** the db client, Redis client, casual-table store, ticket minter, and
  match-spawn client are constructed at module scope
- **AND** subsequent requests on the same warm instance reuse those instances
  rather than rebuilding them

### Requirement: Stub-identity context in the function

The serverless function SHALL resolve each request's caller through the same
stub-identity seam (`resolveStubIdentity`) used by the standalone server, building
the tRPC context with the resolved `playerId` plus the shared variant catalog,
store, spawn client, and ticket minter. Real authentication is out of scope and
deferred to the Auth & Identity unit.

#### Scenario: Caller resolved via stub identity

- **WHEN** the function builds the context for an incoming request
- **THEN** it resolves the caller with `resolveStubIdentity` over the request
  headers and exposes the resulting `playerId` to the routers, identically to the
  standalone server's context

### Requirement: Single-origin CORS in the function

The serverless function SHALL apply the same cross-origin policy as the standalone
server: it reflects the single configured `WEB_APP_ORIGIN` (never a wildcard) on
responses, advertises the permitted tRPC methods and headers, and short-circuits
the `OPTIONS` preflight with a `204` before the tRPC handler runs.

#### Scenario: Preflight is short-circuited

- **WHEN** the function receives an `OPTIONS` preflight request
- **THEN** it responds `204` with the `WEB_APP_ORIGIN` allow-origin and the
  allowed methods/headers, without invoking the tRPC handler

#### Scenario: Allowed origin reflected on responses

- **WHEN** the function returns a tRPC response
- **THEN** the response carries `Access-Control-Allow-Origin` set to the
  configured `WEB_APP_ORIGIN` (not `*`) with `Vary: Origin`

### Requirement: Standalone dev server preserved

The standalone `.listen()` tRPC server (`apps/api/src/index.ts`) SHALL remain a
working local development entry, sharing the router and context-building logic with
the serverless function rather than duplicating it, so `pnpm --filter @meldrank/api
dev` continues to run the API locally unchanged.

#### Scenario: Local dev server still runs

- **WHEN** the API is started for local development
- **THEN** the standalone server boots, validates the environment, and listens on
  its configured port exactly as before this change

#### Scenario: Router and context logic shared

- **WHEN** the serverless function and the standalone server are compared
- **THEN** both serve the same `appRouter` and build the request context the same
  way, reusing shared logic instead of maintaining two divergent copies

### Requirement: All tRPC paths reach the function

The deployed API SHALL route every tRPC procedure path to the serverless function
so the web client reaches every procedure through its configured API base URL
(`NEXT_PUBLIC_API_URL`) without per-procedure routing changes.

#### Scenario: Procedure path routed to the function

- **WHEN** the web client issues a batched tRPC request against the API base URL
- **THEN** the request is routed to the serverless function and served, regardless
  of which procedures are in the batch
