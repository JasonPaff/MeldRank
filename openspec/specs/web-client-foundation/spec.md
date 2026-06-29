# web-client-foundation Specification

## Purpose

Establishes the foundational client-side wiring for the `apps/web` Next.js application: a typed tRPC client bound to the API router through the TanStack Query proxy, a shared TanStack Query async-state layer, the Zustand session/table store, a configured-but-unconnected Colyseus client, the root provider tree composing them, the Tailwind v4 + Base UI shadcn styling baseline, and the public match service endpoint environment variable. Concrete screens, procedure call sites, and room connection/binding are out of scope and belong to later slices.

## Requirements

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

### Requirement: TanStack Query async-state layer

The web client SHALL provide a TanStack Query v5 `QueryClient` at the application
root, so the tRPC proxy and any future data fetching share one async-state cache.

#### Scenario: A single QueryClient wraps the app

- **WHEN** the app shell mounts
- **THEN** a `QueryClientProvider` with a single shared `QueryClient` is present above
  the application's page content

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

### Requirement: Zustand session/table store

The web client SHALL define a Zustand store for client-side session/table state,
made available through the root provider tree. This change establishes the store and
its provider wiring; the concrete table-reconciliation state it will hold is defined
by the later table slice.

#### Scenario: Store is reachable from components

- **WHEN** a component reads the session/table store via its hook
- **THEN** it receives the typed store state without throwing, because the store
  provider is mounted at the root

### Requirement: Configured-but-unconnected Colyseus client

The web client SHALL provide a `colyseus.js` client configured against the validated
`NEXT_PUBLIC_MATCH_URL` through a thin provider. The provider SHALL only construct
and expose the client; it SHALL NOT join, create, or bind any room in this change —
room connection and view-message binding belong to the later table slice.

#### Scenario: Colyseus client is configured from the match URL

- **WHEN** the Colyseus provider initializes
- **THEN** it constructs a `colyseus.js` client whose endpoint is derived from
  `NEXT_PUBLIC_MATCH_URL`

#### Scenario: No room is joined at the foundation layer

- **WHEN** the Colyseus provider mounts
- **THEN** no `join`, `joinById`, `create`, or `reconnect` call is made

### Requirement: Styling baseline

The web client SHALL establish a Tailwind CSS v4 styling baseline and a shadcn/ui
setup configured on the **Base UI** registry (`@base-ui-components/react`), not the
Radix registry. The baseline SHALL include a global stylesheet wired into the root
layout so Tailwind utilities and shadcn theme tokens are available app-wide.

#### Scenario: Tailwind utilities apply app-wide

- **WHEN** a component uses a Tailwind utility class
- **THEN** the utility resolves, because the Tailwind v4 global stylesheet is imported
  in the root layout

#### Scenario: shadcn is configured for Base UI

- **WHEN** the shadcn configuration is inspected
- **THEN** it targets the Base UI registry / `@base-ui-components/react` primitives,
  and the project does not pull the Radix-based shadcn primitives

### Requirement: Public match service endpoint variable

The shared public web environment contract SHALL declare `NEXT_PUBLIC_MATCH_URL`, and
it SHALL be reflected in `.env.example` and the `pnpm env:check` agreement check, so
the Colyseus client always has a validated endpoint.

#### Scenario: Match URL is validated public web env

- **WHEN** the web environment is loaded
- **THEN** `NEXT_PUBLIC_MATCH_URL` is present on the typed, validated web env result
  exported from the isomorphic `@meldrank/shared` root (never the server-only entry)

#### Scenario: Example stays in agreement

- **WHEN** `pnpm env:check` runs
- **THEN** `NEXT_PUBLIC_MATCH_URL` appears in `.env.example` with a non-secret
  placeholder and the check passes

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
