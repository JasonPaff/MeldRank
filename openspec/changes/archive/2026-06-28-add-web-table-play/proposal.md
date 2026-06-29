## Why

The MVP walking skeleton (Linear SLE-184) is deployed end-to-end on real infra and
the full server-side wire is lit — but the gameplay→Neon loop is **still not
smokeable**, because `apps/web`'s `/table/[roomId]` route is an F1 stub that renders
the handoff handle and joins no room. The Client↔Match Colyseus seam is the last dark
integration boundary; until a browser actually connects, plays a hand, and watches the
match row land in Postgres, the skeleton has not walked. F1's own smoke task (SLE-184
unit F, task 5.2) stays unchecked for exactly this reason.

This change is **F2a — the playable table**: the first of unit F's two remaining table
slices (**F2a play** → F2b resilience). It is scoped to the **minimum that lights the
Colyseus seam and flips the loop green**: join the spawned room with the lobby's seat
ticket, render the per-seat filtered view, drive the human intent loop, and let 1 human

- 3 bots finish a Single-Deck Partners game whose result persists to Neon. Clocks,
  reconnect/resync, and cold-load ticket rehydration are deliberately held for F2b so this
  slice does exactly one risky thing.

## What Changes

- **Web — table route (replaces the F1 stub).** Turn `apps/web/app/table/[roomId]/`
  into the live table:
  - **Join.** Read the seat `ticket` + `activeMatch` handle the lobby stashed in the
    F0 session store and `client.joinById(roomId, { ticket })` against the configured
    Colyseus client (`NEXT_PUBLIC_MATCH_URL`). The room's `onAuth` verifies the ticket
    and binds the reserved seat — no client-side seat choice.
  - **Render from the per-seat `FilteredView`.** Show the viewer's own hand (`own.hand`),
    the table-visible `public` state (auction, contract/trump, current trick, scores,
    revealed widow), and every opponent as `handSizes[i]` card-backs. Whose-turn comes
    from the auto-synced `RoomMetadata` (`seatToAct`/`lifecycle`/`seatStatus`). No hidden
    information is representable client-side — it never arrives.
  - **Human intent loop (pessimistic).** Offer the legal action for the current phase —
    `bid` / `pass` / `declareTrump` / `playCard` — submit it as an `intent` message with
    a client-generated `correlationId`, disable input, and reconcile on the authoritative
    `accept` (apply new view) or `reject` (restore the truth view + surface the reason).
    Partners never produces a `bury` intent, so it is out of scope.
  - **Best-effort fairness contribution.** On each `commit` message, send one
    `contribute { clientSeed }` with fresh random bytes. The seed-assembly layer
    substitutes a deterministic fallback for any absent seat, so this is fire-once and
    non-blocking — a dropped contribution never stalls the deal.
  - **Lifecycle + async states.** Connecting / connected / errored / disconnected and
    match-complete states sufficient to watch a full hand-to-match arc and see disposal.
- **Web — render model over the two state channels.** Introduce a small table store/
  reducer that merges Colyseus's auto-synced `RoomMetadata` schema with the
  message-delivered `view`/`accept`/`reject`/`commit`/`clockState` payloads into one
  render model the components read. (`clockState` is captured but rendered in F2b.)

**Explicitly out of scope** (boundary fix → F2b, unit E):

- Clock countdown UI (the `clockState` payload is on the wire; F2a stores it, F2b renders
  the visual countdown).
- `reconnect()` / resync, reconnection-token persistence, and cold-load **ticket**
  rehydration (a hard refresh loses the in-memory ticket and `match.getActive` mints no
  new one) — **F2b**.
- Optimistic move rendering, card artwork, and animations — pessimistic + functional
  rendering only.
- Real authentication — identity stays stubbed; Clerk is unit E.
- No change to `apps/match`, `apps/api`, or `packages/*` — F2a consumes the frozen,
  already-tested wire contract (room schema, `view`/`accept`/`reject`/`commit`/`contribute`
  messages, the seat ticket) as-is.

## Capabilities

### New Capabilities

- `table-play-web`: the `apps/web` live-table surface — joining the spawned Colyseus
  room with the lobby's seat ticket, rendering the per-seat `FilteredView` plus the
  synced presence metadata, driving the human bid/declareTrump/playCard/pass intent loop
  with authoritative `accept`/`reject` reconciliation, and the best-effort per-hand seed
  contribution, such that a 1-human + 3-bot Single-Deck Partners game plays to completion
  and persists. It owns the table connection and render model; it owns no clock-countdown
  visual, reconnect/resync, or cold-load ticket re-mint (those are F2b).

### Modified Capabilities

<!-- None. The Client↔Match wire contract, the seat-ticket handoff, and the
`casual-lobby-web` lobby handoff already exist and are unchanged at the spec level;
F2a is a new client-side surface consuming them. -->

## Impact

- **Code (web only):** `apps/web/app/table/[roomId]/page.tsx` (stub → live table); new
  table render-model store + view components under `apps/web/`; consumes the existing F0
  Colyseus provider (`apps/web/lib/colyseus.tsx`) and session store
  (`apps/web/lib/store.tsx`).
- **Contracts consumed (unchanged):** `@meldrank/engine` `FilteredView`/`PublicState`,
  `@meldrank/shared` `PlayerIntent`/`CardRef`/`SignedSeatTicket`/`ActiveMatch`, and the
  `apps/match` `RoomMetadata` schema + room message protocol.
- **No backend/infra change:** no new env vars, no API or match-service edits, no schema
  or migration. Lights the Client↔Match Colyseus seam against already-deployed infra and
  makes SLE-184 unit F task 5.2 (browser → match row in Neon) finally smokeable.
- **Risk:** highest-leverage integration boundary in the MVP — concentrated in one web
  surface, against a frozen and server-tested protocol.
