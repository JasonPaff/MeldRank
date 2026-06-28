## Context

`apps/web` is a Next.js 16 / React 19 app with a single smoke page and one
dependency (`@meldrank/shared`). Every other surface of the MVP walking skeleton is
built and tested: the API (`@trpc/server@^11`) exports `type AppRouter` from
`apps/api/src/routers`, runs as its own origin on `:3001`, and serves the minimal
procedure set over stubbed identity; the Match Service runs Colyseus rooms that sync
a non-secret `RoomMetadata` schema and push per-seat `view` messages.

This change is **F0** — the bare client foundation, first of three slices of unit F
(Linear SLE-184). It wires the libraries and providers the lobby (F1) and table (F2)
will build on, and nothing else. Library choices were decided with Jason this session
(see Decisions). Versions are deliberately **not** pinned in this design: the repo's
dependency-version policy is "latest stable, verified against the registry at the time
the work lands," so the apply step resolves concrete versions then.

## Goals / Non-Goals

**Goals:**

- A typed tRPC client bound to `AppRouter` via the TanStack Query proxy, pointed at
  `NEXT_PUBLIC_API_URL`.
- A root provider tree (TanStack Query + tRPC + Zustand + Colyseus) that every route
  renders inside, mounting with zero network I/O.
- A Tailwind v4 + shadcn(Base UI) styling baseline available app-wide.
- A configured-but-unconnected Colyseus client + the `NEXT_PUBLIC_MATCH_URL` env var.

**Non-Goals:**

- Any lobby procedure call or screen (F1); any room join, view binding, optimistic
  intent loop, or table rendering (F2).
- Real auth — identity stays stubbed (Clerk is unit E).
- CORS configuration on the API (server-side; addressed when F1 first calls a
  procedure from the browser — flagged as a risk below).
- Choosing the table's concrete reconciliation state shape (defined in F2; F0 only
  stands up the store + provider).

## Decisions

### D1 — tRPC via the TanStack Query proxy, not classic hooks

Use `@trpc/client` + `@trpc/tanstack-react-query` (`createTRPCContext` /
`queryOptions` / `mutationOptions`), composed over a shared `@tanstack/react-query`
v5 `QueryClient`. Call sites read `useQuery(trpc.x.queryOptions(input))`.

- **Why:** it is the direction tRPC v11 is steering toward, composes transparently
  with raw TanStack Query (caching, invalidation, suspense) without a second hook
  dialect, and keeps the client thin. _Alternative:_ classic `createTRPCReact`
  (`trpc.x.useQuery()`) — more tutorials, but a parallel hook surface and more magic.
  Rejected per the session decision.

### D2 — Providers are one `'use client'` boundary; layout stays a Server Component

`app/layout.tsx` remains an RSC and renders a single `<Providers>` client component
that nests `QueryClientProvider` → tRPC provider → Zustand store provider → Colyseus
provider around `{children}`.

- **Why:** App Router requires context providers to live under a client boundary;
  collapsing them into one `<Providers>` keeps the boundary minimal and the layout
  server-rendered. The `QueryClient` is created **once per browser** (lazy `useState`
  / module singleton on the client, fresh per request on the server) to avoid leaking
  cache across requests during SSR. _Alternative:_ mark the whole layout `'use client'`
  — rejected; it needlessly drops the server layout.

### D3 — HTTP batch link to a cross-origin API

The tRPC client uses `httpBatchLink({ url: \`${NEXT_PUBLIC_API_URL}/trpc\` })` (exact
path to match the API's tRPC handler mount). The API is a separate origin (`:3001`),
so browser calls are cross-origin.

- **Why:** matches the deployed topology (web + API are separate Vercel projects).
  CORS on the API is required before F1's first browser call but is **not** in this
  change's scope — F0 never calls a procedure. Captured as a risk so F1 plans for it.

### D4 — Zustand store now, via a provider (not a bare module global)

Establish the session/table store with Zustand and expose it through a context
provider in the tree, returning a typed hook.

- **Why:** decided to commit Zustand now (pairs naturally with Colyseus' imperative
  message stream in F2). Using a provider-bound store instance rather than a
  module-global keeps it SSR-safe and testable. The store's concrete fields are
  intentionally minimal here; F2 defines the reconciled view/session state. _Alt:_
  defer state choice to F2 — rejected per session decision.

### D5 — shadcn/ui on the Base UI registry, Tailwind v4

Configure shadcn/ui against the **Base UI** registry (`@base-ui-components/react`),
not the default Radix registry, on a Tailwind CSS v4 baseline (global stylesheet +
`@tailwindcss/postcss` per the Next 16 setup).

- **Why:** Jason's explicit preference for Base UI primitives. shadcn supports a Base
  UI variant; we take it so the lobby/table shells are built on Base UI from day one.
  _Alternative:_ Radix-based shadcn (the default) — rejected per session decision;
  plain Tailwind with no component lib — rejected (slower polished shell).

### D6 — Colyseus client configured, never connected

A thin `<ColyseusProvider>` constructs a `colyseus.js` `Client` from
`NEXT_PUBLIC_MATCH_URL` and exposes it; it performs no `join`/`create`/`reconnect`.

- **Why:** keeps the realtime dependency and endpoint wiring in F0 (per the original
  "deps + providers" scope) while leaving all room logic to F2. `colyseus.js` touches
  browser globals, so the provider is a client component and any client construction
  is guarded against SSR.

### D7 — `NEXT_PUBLIC_MATCH_URL` joins the public web env

Add `NEXT_PUBLIC_MATCH_URL` to the `@meldrank/shared` web env schema (isomorphic root
entry, never server-only), `.env.example`, and `pnpm env:check`, defaulting to the
local match origin for zero-config builds.

- **Why:** the existing `environment-config` requirements demand every consumed
  variable be declared and the example kept in agreement; this satisfies them. No
  spec delta needed (behavioral requirements unchanged).

## Risks / Trade-offs

- **shadcn Base UI registry maturity** → Base UI is younger than the Radix path and
  component coverage / shadcn integration may lag. Mitigation: F0 only stands up the
  config + theme baseline (no large component set yet); validate the init + one
  trivial component compiles before F1 leans on it. Re-evaluate at F1 if coverage
  gaps appear.
- **Tailwind v4 + Next 16 + React 19 toolchain churn** → newest majors across the
  board. Mitigation: follow the current Next 16 Tailwind v4 setup (PostCSS plugin),
  verify `next build` and `next dev` both succeed in the validate pass.
- **Cross-origin CORS not yet configured on the API** → F1's first browser procedure
  call will fail until the API sends CORS headers. Mitigation: out of scope here by
  design; explicitly flagged so F1 includes the API CORS change. F0 makes no call, so
  it cannot regress.
- **SSR cache/`window` hazards** → a shared `QueryClient` or a Colyseus client built
  at module scope can leak across SSR requests or touch `window` on the server.
  Mitigation: per-request `QueryClient` on the server / singleton on the client;
  construct the Colyseus client only under the client boundary.
- **Provider tree mounts but does nothing visible** → little to manually verify beyond
  "it builds and renders." Mitigation: the spec's no-network-on-mount scenarios plus a
  typecheck that the tRPC proxy resolves against `AppRouter` are the real gates;
  lint/typecheck/build via the validate agent is the acceptance signal.

## Open Questions

- Exact tRPC handler path on the API (`/trpc` vs root) — confirm against the API's
  mount when wiring `httpBatchLink`; adjust the URL if it differs.
- Whether a TanStack Query Devtools dependency is worth adding in F0 or deferring to
  F1 — minor; default to deferring unless trivial.
