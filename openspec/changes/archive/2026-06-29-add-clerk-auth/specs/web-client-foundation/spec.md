## ADDED Requirements

### Requirement: Clerk session provider and auth surfaces

The web client SHALL mount Clerk's `ClerkProvider` above the application provider tree,
configured from the validated `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and SHALL provide
sign-in and sign-up surfaces plus a sign-out affordance for the authenticated session. The
provider SHALL wrap the tRPC client so the client can read the current session token.

#### Scenario: ClerkProvider wraps the app

- **WHEN** any route in `apps/web` renders
- **THEN** it renders inside `ClerkProvider`, configured from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, above the tRPC client

#### Scenario: Sign-in, sign-up, and sign-out are reachable

- **WHEN** an unauthenticated visitor opens the app, or an authenticated user chooses to leave
- **THEN** sign-in / sign-up surfaces are available to authenticate, and a sign-out affordance ends the session

### Requirement: Protected routes require authentication

The web client SHALL protect the player-scoped routes (the lobby and the table) behind
Clerk middleware, redirecting an unauthenticated visitor to sign in, while leaving the
sign-in / sign-up surfaces public.

#### Scenario: Unauthenticated visitor is redirected from a protected route

- **WHEN** an unauthenticated visitor navigates to the lobby or a table route
- **THEN** Clerk middleware redirects them to sign in

#### Scenario: Auth surfaces stay public

- **WHEN** an unauthenticated visitor navigates to the sign-in or sign-up route
- **THEN** the route renders without a redirect

## MODIFIED Requirements

### Requirement: Typed tRPC client bound to the API router

The web client SHALL expose a single tRPC client typed against the API's exported
`AppRouter`, configured through the **TanStack Query proxy** integration
(`@trpc/tanstack-react-query`), not the classic `createTRPCReact` hooks. The client
SHALL target the validated `NEXT_PUBLIC_API_URL` over an HTTP batch link, so the
browser reaches the cross-origin API. The HTTP batch link SHALL attach the current Clerk
session token as an `Authorization: Bearer <token>` header on each request, so the
cross-origin API can authenticate the caller. Procedure call sites and screens are out of
scope for this capability — only the typed client and its option proxy are provided.

#### Scenario: Client is typed end-to-end against AppRouter

- **WHEN** the web client's tRPC proxy is used in a typechecked context
- **THEN** procedure input/output types resolve from the API's `AppRouter`, and an
  unknown procedure path fails typecheck

#### Scenario: Client targets the configured API origin

- **WHEN** the tRPC client is constructed
- **THEN** its HTTP batch link URL is derived from the validated `NEXT_PUBLIC_API_URL`
  rather than a hardcoded origin

#### Scenario: Requests carry the Clerk session token

- **WHEN** the tRPC client issues a request for an authenticated user
- **THEN** the request carries the current Clerk session token as an `Authorization: Bearer` header

#### Scenario: Uses the TanStack Query proxy integration

- **WHEN** the tRPC integration module is inspected
- **THEN** it builds the client through `@trpc/tanstack-react-query` query/mutation
  option helpers and does not depend on `@trpc/react-query`'s `createTRPCReact`

### Requirement: Root provider tree

The web client SHALL compose its foundation providers — Clerk's `ClerkProvider`, the
TanStack Query client, the typed tRPC client, the Zustand store access, and the Colyseus
client — into one root provider tree applied in `app/layout.tsx`, so every route renders
within them, with `ClerkProvider` outermost so the tRPC client can read the session. The
provider tree SHALL mount without performing any application procedure call or room join
on initial render.

#### Scenario: Providers wrap every route

- **WHEN** any route in `apps/web` renders
- **THEN** it renders inside the Clerk, TanStack Query, tRPC, Zustand, and Colyseus providers

#### Scenario: Mounting performs no application network I/O

- **WHEN** the app shell first renders with no user interaction
- **THEN** no tRPC procedure call and no Colyseus room connection is initiated
