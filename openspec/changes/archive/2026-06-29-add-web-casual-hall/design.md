## Context

The casual-table API (`casual-lobby-api`) is fully implemented and tested over an
ephemeral Redis store with atomic seat claims: `createTable`, `listOpenTables`,
`joinSeat`, `leaveTable`, `addBot`, `quickPlay`, plus the shared `spawnIfFull` flow
that requests a room and mints per-seat tickets when a table fills. The F1 lobby
(`casual-lobby-web`) wired only `quickPlay` + the `getActive` rejoin; the F2 table
(`table-play-web` / `table-resilience-web`) connects to a spawned Colyseus room with a
seat ticket (warm `joinById`) or a persisted reconnection token. This change builds the
deferred hall screens on top of that — the first human-vs-human assembly path.

Two facts from the existing code shape the whole design:

1. **Spawn is triggered by the last seat, and only that caller is handed a ticket.**
   `spawnIfFull` (apps/api/src/lobby/spawn-flow.ts) mints a ticket for *every* human
   seat and `setActive`s each, but returns the ticket only to the caller whose claim
   filled the table. Earlier human joiners hold an active-match record and no ticket.
2. **Seat tickets are stateless and re-mintable.** `mint` is a pure HMAC-SHA256 over
   `{roomId, seat, playerId, variantId, exp}` (TTL 120s); the room's `onAuth`
   (`verifySeatTicket`) checks signature + expiry + room-match + seat-bind with **no
   replay/consume tracking** (Auth & Identity §6, `match-room-lifecycle`). A ticket can
   be re-minted on demand, any number of times, and each is independently valid.

Design source of truth: Linear "Lobby & Matchmaking — Design v1", "API Surface &
Contracts — Design v1", "Auth & Identity — Design v1".

## Goals / Non-Goals

**Goals:**
- A browser-usable casual hall: browse open tables, create a table, and the
  seat-by-seat waiting room (join / add-bot / leave) with live seat-fill feedback.
- The first **human-vs-human** play path through the product end to end.
- Deliver a valid seat ticket to *every* seated human when their table goes live —
  not only the seat-filler — and reach the existing play route unchanged.

**Non-Goals:**
- No change to `apps/match`, the Colyseus room, or its `onAuth` seat-ticket auth seam.
- No new realtime transport in the lobby; the hall is pull-based (polling).
- No multi-variant create (default Single-Deck Partners only), no host "Start" control,
  no ranked floor, profiles, chat, notifications, or onboarding.

## Decisions

### D1 — `match.getActive` mints and returns the caller's seat ticket

The non-final joiner's missing ticket is solved by enriching the procedure the client
already polls for rejoin. `getActive` already resolves the caller's `live` table and
seat; it now additionally calls the existing `TicketMinter` and returns a fresh signed
ticket beside the handle (output gains an optional `ticket`). The waiting room and the
landing-page Rejoin both consume it as a warm `joinById`.

- **Why:** minting is free and stateless (Context #2), so "deliver the ticket" reduces
  to "return it on read." Zero new endpoints, zero match-service change, the seat ticket
  stays the sole `onAuth` chokepoint. Bonus: the existing Rejoin path stops depending on
  a persisted reconnection token a never-connected joiner doesn't have.
- **Freshness:** the 120s TTL is satisfied automatically — the client fetches `getActive`
  at the moment it transitions into the room, exactly as Quick Play does today. Polling
  re-mints each call, so the held ticket is never stale at connect time.
- **Alternatives considered:** (a) a dedicated `casual.claimTicket(tableId)` — cleaner
  read/credential separation but one more procedure + contract for a v1 hall; rejected
  for surface. (b) realtime push of the minted ticket — new lobby transport for one
  message; rejected as over-built. (c) teach `onAuth` to accept a ticketless
  Clerk-identity connect for an already-seated player — removes the problem but changes
  the match-service auth seam (widest blast radius); rejected.

### D2 — `casual.getTable({ tableId })` single-table read for the waiting room

The waiting room must show the **`Filling`** state (which seats are taken, by whom) and
detect the flip to `live`. `listOpenTables` can't: a full/spawning table drops off the
open list. `getActive` can't: it returns only `live` matches. So add a single-table read
returning the current ephemeral `CasualTable` record; the waiting room polls it.

- **Why:** trivial (a single Redis `get` the store already supports), and it keeps the
  pre-live view and the live-transition concern cleanly separated (`getTable` for fill
  state, `getActive` for the entry ticket).
- **Transition:** the waiting room treats `getTable.status === 'live'` (with a `roomId`)
  as the signal to fetch `getActive` once and hand off. If a poll races the spawn and
  sees a transient `spawning`, it simply keeps polling.
- **Alternative:** overload `getActive` to also return `Filling` tables — rejected; it
  would muddy the "reconnectable live match" contract and force a status union into a
  procedure that today means "you have a live room."

### D3 — Auto-spawn on full; no host "Start" control (baseline, flagged)

The server already spawns the instant the last seat fills (human or bot) via
`spawnIfFull`. The hall UI reflects that rather than adding a host-initiated start: to
play without waiting for humans, the creator uses **Add Bot** to fill the remaining
seats. Baseline keeps current server behavior; a host "Start with bots" affordance is
just a convenience over `addBot` and can be added later.

### D4 — Create defaults to Single-Deck Partners; no variant picker (baseline, flagged)

`createTable` takes a `variantId`; v1's only variant is Single-Deck Partners
(`DEFAULT_VARIANT_ID`). The create action uses the default; a variant picker (reading
`variant.list`) is deferred until a second casual variant exists.

### D5 — Explicit seat selection (baseline, flagged)

`joinSeat`/`addBot` are seat-indexed, so the waiting room lets the caller claim a
**specific** empty seat and drop a bot into a **specific** seat (click the seat). This
matches the API and reads naturally at a card table. A "take any open seat" shortcut is
a later convenience.

### D6 — Routing: a `tableId`-keyed waiting-room route distinct from the play route

The waiting room is keyed by `tableId` (pre-room), e.g. `/table/pending/[tableId]`,
separate from the `roomId`-keyed `/table/[roomId]` play route. On transition to live the
waiting room navigates to the play route with the freshly fetched ticket in the existing
session-store handoff. Keeping them distinct avoids overloading the play route with a
"no room yet" mode.

### D7 — One change, polling-based, on the F0/F1 foundation

Shipped as a single change (web + two small API touches), smaller than F2. Open-table
list and waiting-room fill state poll via TanStack Query `refetchInterval`; no new
client libraries beyond the F0 tRPC/TanStack-Query/Zustand/Colyseus foundation.

### D8 — Web component plan

The hall follows the existing web conventions: feature components under
`components/hall/`, shadcn-on-Base-UI primitives under `components/ui/`, routes as
`page.tsx` + typed `route-type.ts`, and orchestration logic in a `lib/` hook (parallel
to `use-table-connection.ts`). Tree:

```
app/page.tsx                       [MODIFY] restructure into a hall layout
app/table/pending/[tableId]/       [NEW]    waiting-room route (page.tsx + route-type.ts)
components/ui/card.tsx, badge.tsx  [NEW]    shared primitives
components/hall/
  casual-hall.tsx                  browse + create surface (composed into the landing)
  open-table-list.tsx              polls listOpenTables → rows + loading/error/empty
  open-table-row.tsx               one table: variant, occupancy badge, "Open"
  create-table-button.tsx          create on default variant, pending-guarded
  waiting-room.tsx                 seat grid + status banner + Leave
  seat-grid.tsx                    lays out the N seats
  seat-slot.tsx                    one seat: empty (Take seat / Add bot) | you | human | bot
lib/use-waiting-room.ts            [NEW]    getTable poll + conflict/not-found + live transition
lib/store.tsx                      [reuse]  setHandoff (no change)
```

Three rulings settle the component approach:

- **D8a — Adopt `Card` + `Badge` primitives.** Add `components/ui/card.tsx` and
  `badge.tsx` (shadcn on the Base UI registry) for rows, seat slots, panels, and
  occupancy/status chips, rather than hand-rolling Tailwind as the table feature did.
  They become the reusable base the ranked lobby and profiles will share. *Trade-off:*
  slightly more setup now vs. less repeated styling later.
- **D8b — The landing page becomes a real hall layout.** `app/page.tsx` is restructured
  to a header + a primary actions row (Quick Play | Create Table) + the open-tables
  browse list, rather than the F1 centered single-button. The Quick Play and Rejoin
  behaviors (`casual-lobby-web`) are unchanged — only the page composition grows.
- **D8c — "Open" navigates, it does not seat.** A browse-row action opens that table's
  waiting room where the player claims a *specific* seat (consistent with D5 explicit
  seat selection); it does not auto-claim. A one-click "join first open seat" shortcut
  is deferred.

`seat-slot` is the centerpiece — one polymorphic component branching on `seat.kind` +
viewer identity + emptiness (mirroring the table's `OpponentSeat` status pattern); the
in-game `OpponentSeat` is a separate concern (presence/clock/hand-size) and is **not**
shared beyond the `Card` primitive. `use-waiting-room` keeps the route and seat
components thin, exactly as `use-table-connection` does for the play route.

## Risks / Trade-offs

- **Poll-driven UX feels less instant than push.** → Acceptable for v1; short
  `refetchInterval` on the small waiting-room payload. A realtime upgrade (D1 alt b) can
  layer on later without changing the contracts.
- **A poll could observe a `spawning` table mid-transition.** → The waiting room treats
  only `live` + `roomId` as terminal and keeps polling through `spawning`; `getActive`
  returns null until the table is fully `live`, so no half-live entry is possible.
- **`getActive` now returns a bearer credential on a read.** → It is returned only to the
  authenticated owner of that seat over the same authn'd tRPC channel that already
  returns it from `quickPlay`; the 120s TTL bounds exposure. No broader surface than today.
- **Creator/joiner abandons a `Filling` table.** → `leaveTable` frees the seat; a table
  with no human occupants MAY be evicted (existing store behavior). The hall must handle
  a `getTable` that returns not-found (table evicted) by returning the player to the hall.
- **Concurrent seat claims race.** → Already handled server-side by the store's atomic
  claim; a losing claim surfaces the typed `conflict`, which the UI shows as "seat just
  taken" and refreshes the table.

## Migration Plan

Additive only. The `match.getActive` output change is a new **optional** field, so
existing callers (the F1 Rejoin, which tolerated `ticket: null`) keep working; the play
route already accepts a ticketed warm join. `casual.getTable` is a new procedure. No data
migration, no breaking contract change. Rollback = revert the change; Quick Play and the
existing Rejoin continue to function. Deploy order is irrelevant (API additive; web
gated on its own deploy).

## Open Questions

- Exact `refetchInterval` cadence for the open-table list vs. the waiting room (tune at
  apply; faster for the waiting room, slower for the browse list).
- Whether to evict a creator-abandoned empty `Filling` table eagerly or lean on the
  store TTL (lean on existing behavior unless it proves annoying in smoke).
