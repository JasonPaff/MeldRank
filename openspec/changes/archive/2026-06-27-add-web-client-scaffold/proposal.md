## Why

`apps/web` is still the smoke home page — it depends only on `@meldrank/shared` and
renders a health-check string. Meanwhile every server seam of the MVP walking
skeleton is live and tested (engine → room → persistence; client ↔ API tRPC over
stubbed identity; API → Match spawn + seat ticket). The only thing between "the
servers talk to each other" and "a human plays a game in a browser" is the web
client, and it has none of the foundation needed to speak either transport.

This change lays that foundation — and only the foundation. It is the first of three
slices of MVP roadmap **unit F — Web: lobby + table UI** (Linear SLE-184): **F0
scaffold**, ahead of **F1 lobby** and **F2 table**. Splitting the bare scaffold out
lets the provider/library decisions land and compile de-risked, before any feature
depends on them.

## What Changes

- Add the client foundation libraries to `apps/web` (all at latest stable per the
  dependency-version policy):
  - **tRPC client** — `@trpc/client` + `@trpc/tanstack-react-query` (the new
    TanStack Query proxy integration, **not** the classic `createTRPCReact` hooks),
    bound to the API's exported `type AppRouter`.
  - **TanStack Query v5** — `@tanstack/react-query` as the async-state layer the
    tRPC proxy composes over.
  - **Styling** — Tailwind CSS v4 and shadcn/ui configured on the **Base UI**
    registry (`@base-ui-components/react`), not the Radix registry.
  - **Client state** — `zustand` for a session/table store established now.
  - **Realtime** — `colyseus.js` plus a thin provider that _configures_ a client
    against the match service URL.
- Build the app shell: a root provider tree wrapping TanStack Query + the typed tRPC
  client + the Zustand store + the Colyseus client, and a Tailwind/shadcn(Base UI)
  global stylesheet + theme baseline.
- Add `NEXT_PUBLIC_MATCH_URL` to the public web env contract
  (`packages/shared` web env schema), `.env.example`, and the `pnpm env:check`
  example check, so the Colyseus client has a validated endpoint.
- Replace the smoke `app/page.tsx` with a minimal placeholder that proves the
  provider tree mounts (no procedure calls, no room joins).

**Explicitly out of scope** (later slices, listed to fix the boundary):

- Any lobby procedure calls / screens — F1.
- Any room join, view-message binding, optimistic intent loop, or table rendering — F2.
- Real authentication — identity stays stubbed; Clerk is unit E.

## Capabilities

### New Capabilities

- `web-client-foundation`: the `apps/web` client foundation — the typed tRPC client
  bound to `AppRouter`, the TanStack Query async-state layer, the Zustand
  session/table store, the configured-but-unconnected Colyseus client, the
  Tailwind v4 + shadcn(Base UI) styling baseline, and the root provider tree that
  composes them. Covers wiring and configuration only; it owns no lobby or table
  behavior.

### Modified Capabilities

<!-- None. The `environment-config` spec states behavioral requirements (every consumed
     variable is declared in the schema; .env.example stays in agreement), not an
     enumerated key list. Adding NEXT_PUBLIC_MATCH_URL satisfies those existing
     requirements rather than changing them, so no delta spec is needed. -->

_None._ Adding `NEXT_PUBLIC_MATCH_URL` satisfies the existing `environment-config`
requirements (all consumed variables declared + `.env.example` in agreement) without
changing them.

## Impact

- **Code**: `apps/web` (new `package.json` deps, `app/layout.tsx` provider tree,
  new `lib/` client/provider modules, Tailwind/shadcn config + global CSS, replaced
  `app/page.tsx`); `packages/shared` web env schema; root `.env.example` and the
  `scripts/check-env-example.ts` surface.
- **Dependencies (new, latest stable)**: `@trpc/client`, `@trpc/tanstack-react-query`,
  `@tanstack/react-query`, `tailwindcss` v4 (+ PostCSS/plugin as required by the
  Next 16 setup), shadcn/ui + `@base-ui-components/react`, `zustand`, `colyseus.js`.
- **Contracts**: consumes the existing `type AppRouter` from `apps/api` and the
  `@meldrank/shared` web env — no server-side or shared-contract changes beyond the
  one new env variable.
- **Transports lit**: none yet — this change only _configures_ the tRPC and Colyseus
  clients; F1 exercises tRPC, F2 exercises Colyseus.
- **Deploy**: introduces the `NEXT_PUBLIC_MATCH_URL` env requirement that unit H must
  set when `apps/web` is first deployed.
