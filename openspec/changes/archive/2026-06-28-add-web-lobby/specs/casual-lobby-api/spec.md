## ADDED Requirements

### Requirement: API serves browser clients cross-origin (CORS)

The `apps/api` tRPC HTTP server SHALL permit cross-origin browser requests from the
configured web origin, so the `apps/web` client (served from a different origin) can
call its procedures. It SHALL answer the CORS preflight (`OPTIONS`) and emit the
matching `Access-Control-Allow-Origin` (and credentials, when used) response headers
on procedure responses. The allowed origin SHALL be read from a `WEB_APP_ORIGIN`
server environment variable rather than hardcoded, and SHALL be declared in the API
env schema, `.env.example`, and the `pnpm env:check` agreement check. The procedure
contracts and behavior are unchanged; this requirement concerns transport only.

#### Scenario: Preflight from the web origin is allowed

- **WHEN** the browser issues an `OPTIONS` preflight to the API from the configured
  `WEB_APP_ORIGIN`
- **THEN** the API responds with the CORS headers permitting that origin and the
  tRPC request method/headers, so the subsequent procedure call proceeds

#### Scenario: Procedure responses carry the allow-origin header

- **WHEN** a browser tRPC request from the configured web origin resolves
- **THEN** the response includes the matching `Access-Control-Allow-Origin` header

#### Scenario: Allowed origin comes from validated env

- **WHEN** the API boots
- **THEN** the allowed CORS origin is read from the validated `WEB_APP_ORIGIN`
  env var, which is declared in the API env schema and present in `.env.example`
  with a non-secret placeholder so `pnpm env:check` passes
