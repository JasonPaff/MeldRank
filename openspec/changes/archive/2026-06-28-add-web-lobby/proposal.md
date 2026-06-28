## Why

The MVP walking skeleton (Linear SLE-184) has every server seam live and tested —
engine → room → persistence, the API's casual-lobby procedures over stubbed
identity, and the API → Match spawn + seat-ticket seam — and `apps/web` now has the
F0 foundation (typed tRPC client, TanStack Query, Zustand store, configured Colyseus
client) but renders only a placeholder that issues no procedure call. Nothing yet
exercises the **Client↔API tRPC seam from a real browser**, which is the highest
remaining integration risk after the server work.

This change is **F1 — the lobby**, the second of unit F's three slices (F0 scaffold →
**F1 lobby** → F2 table). It is deliberately scoped to the **minimal happy path**: a
player opens the web app, sees their resolved identity, and clicks **Quick Play** to
get bot-filled into a freshly spawned room — proving the browser→API path end-to-end
and producing the seat ticket + room handle that F2's table UI will consume. It also
clears the one prerequisite F0 flagged: the cross-origin API can't be called from the
browser until it serves CORS, so that lands here as the first step.

## What Changes

- **API — cross-origin browser access (CORS).** Wrap the `apps/api` standalone tRPC
  HTTP server so it permits requests (incl. the `OPTIONS` preflight) from the
  configured web origin. Add a `WEB_APP_ORIGIN` server env var (the allowlisted
  origin) to the API env schema, `.env.example`, and the `pnpm env:check` example.
  Without this, F1's very first browser call fails at preflight.
- **Web — lobby route.** Replace the F0 placeholder `app/page.tsx` with the lobby:
  - On load, call `account.getMe` and show the resolved (stub) identity — the first
    real browser tRPC round-trip — stashing `playerId` into the F0 session store.
  - On load, call `match.getActive`; when the caller already has a live match, surface
    a **Rejoin** affordance into the table route; otherwise show the **Quick Play** CTA.
  - **Quick Play** calls `casual.quickPlay`; on success it stashes the returned seat
    **ticket** + active-match handle (`roomId`, `seat`, `variantId`) into the session
    store and navigates to a table route (`/table/[roomId]`).
  - The table route is an **explicit F1 stub** ("connecting… — table UI lands in F2");
    it renders the handle from the store and **does not join the Colyseus room**.
  - Standard loading / error / empty / pending states for these three calls.
- **Web — session store handoff.** Extend the F0 Zustand session store with the
  lobby→table handoff fields (the active seat ticket + active-match handle) so F2 can
  read them to join the room.

**Explicitly out of scope** (boundary fix):

- Create / list / join / leave / add-bot lobby screens — a later F1 pass; the API
  procedures already exist, so these are pure UI with no backend risk.
- Any Colyseus room join, per-seat view rendering, intent loop, clocks, or
  reconnect/resync — **F2**.
- Real authentication — identity stays stubbed; Clerk is unit E.

## Capabilities

### New Capabilities

- `casual-lobby-web`: the `apps/web` lobby surface — rendering the caller's resolved
  identity, the Quick Play action that spawns a bot-filled room, the active-match
  Rejoin affordance, and the lobby→table handoff (stashing the seat ticket + match
  handle for F2). Owns the minimal happy-path lobby UI and its async/error states;
  it owns no table rendering or room connection.

### Modified Capabilities

- `casual-lobby-api`: the API's tRPC HTTP server gains a cross-origin (CORS)
  requirement so browser clients on the configured web origin can call its
  procedures (the procedures themselves are unchanged).

## Impact

- **Code:** `apps/web` (new lobby route + table stub route, session-store extension,
  procedure call sites); `apps/api/src/index.ts` (CORS wrapper around the standalone
  HTTP server); `packages/shared` server env schema (`WEB_APP_ORIGIN`).
- **Config:** `.env.example` + `pnpm env:check` example gain `WEB_APP_ORIGIN`; the
  web app must be served against the API's `NEXT_PUBLIC_API_URL` for the seam to work.
- **Contracts/dependencies:** no new wire contracts (reuses the F0/D shared schemas);
  no new client libraries beyond the F0 foundation. Next.js routing (`useRouter`) and
  the existing tRPC TanStack-Query proxy are the only client surfaces touched.
- **Downstream:** F2 (table UI) consumes the session-store handoff this change writes;
  unit E (Clerk) later replaces the stub identity behind `getMe` and the CORS-fronted
  calls without changing this surface.
