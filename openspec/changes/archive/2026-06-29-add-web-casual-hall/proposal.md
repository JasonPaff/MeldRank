## Why

The MVP walking skeleton (Linear SLE-184) is complete, but it proved only the
**Quick Play** path: a player clicks one button and is bot-filled into a fresh room.
The full casual-table API already exists and is tested — `casual.createTable`,
`listOpenTables`, `joinSeat`, `leaveTable`, `addBot` — yet the web client wires none
of it. The consequence is concrete: **today two humans cannot play each other through
the product**; every game is one human plus three bots. This change finishes the
deferred F1 hall screens, delivering the "casual social hall" half of the locked v1
sentence (Feature Triage) and the first genuinely human-vs-human play.

Grounding the work surfaced one non-obvious seam. When humans assemble a table, the
room spawns only as the **last** seat fills, and the spawn flow mints a ticket for
every human seat but returns it only to the caller who filled that seat. The earlier
joiners get an active-match record but no ticket — and the table route can only enter
a room with a ticket (or a reconnect token they don't have). Because ticket minting is
pure, stateless HMAC signing with no replay tracking (Auth & Identity §6), the fix is
to have `match.getActive` mint and return a fresh ticket for the caller's live match,
rather than build any new delivery transport.

## What Changes

- **Web — the casual hall (new surface).** Add the browse / create / join / leave /
  add-bot screens and the **waiting room** that the F1 lobby deferred:
  - **Browse open tables** — poll `casual.listOpenTables` and render joinable tables.
  - **Create a table** — `casual.createTable` on the default variant (Single-Deck
    Partners), then route the creator into the waiting room.
  - **Waiting room** (keyed by `tableId`) — render the table's seats filling live
    (poll the new `casual.getTable`), let the caller claim a specific empty seat
    (`joinSeat`), drop a bot into one (`addBot`), or leave (`leaveTable`). A table
    spawns automatically when its last seat fills (existing server behavior — no host
    "Start" control).
  - **Transition to live** — when the table goes `live`, fetch the caller's seat
    ticket via `match.getActive` and hand off to the existing `/table/[roomId]` play
    route (warm `joinById`).
  - Quick Play and the active-match Rejoin affordance remain; the landing page
    composes the hall alongside them.
- **API — single-table read (Gap A).** Add `casual.getTable({ tableId })`, returning
  the current ephemeral table record so the waiting room can poll its `Filling` state
  (which `listOpenTables`/`match.getActive` cannot show — a full table leaves the open
  list, and `getActive` returns only `live` matches).
- **API — `match.getActive` returns a seat ticket (Gap B).** For a caller seated in a
  `live` match, `getActive` now mints and returns a fresh signed seat ticket alongside
  the room handle. This delivers the ticket to non-final joiners and makes the existing
  Rejoin path robust (a warm `joinById` for anyone, no reliance on a persisted
  reconnect token).
- **Contracts.** Add the `casual.getTable` input/output schemas to the binding
  contract inventory and extend the `match.getActive` output to carry the optional
  signed seat ticket.

**Explicitly out of scope** (boundary fix):

- Any change to `apps/match` / the Colyseus room or its `onAuth` seat-ticket auth —
  the seat ticket stays the single entry credential; this change only mints/delivers
  it earlier.
- No new realtime transport in the lobby — the hall is pull-based (polling), matching
  the existing F1 model.
- Ranked floor, profiles/stats, chat, notifications, onboarding — separate features.
- Multi-variant play — v1 casual create defaults to Single-Deck Partners; a variant
  picker is deferred.

## Capabilities

### New Capabilities

- `casual-hall-web`: the `apps/web` casual-hall surface — browse open tables, create a
  table, the seat-by-seat waiting room (join / add-bot / leave with live seat-fill),
  and the `Filling → live` transition that fetches the seat ticket and hands off to the
  play route. Owns the hall UI and its async/error/empty states; owns no room
  connection or game rendering (that is `table-play-web`).

### Modified Capabilities

- `casual-lobby-api`: adds `casual.getTable({ tableId })` (single-table read for the
  waiting-room poll); `match.getActive` is extended to mint and return a fresh seat
  ticket for the caller's live match (in addition to the room handle), so every seated
  human — not only the seat-filler — can obtain a valid entry credential.
- `shared-api-contracts`: the binding procedure-schema inventory gains
  `casual.getTable`, and the `match.getActive` output schema gains an optional signed
  seat ticket. Wire shape only; behavior is owned by `casual-lobby-api`.

## Impact

- **Code:** `apps/web` (new hall + waiting-room routes/components, landing-page
  composition, `listOpenTables`/`getTable` polling, seat-claim/add-bot/leave call
  sites, the live-transition ticket fetch); `apps/api` (`casual.getTable` procedure;
  `match.getActive` mints a ticket via the existing `TicketMinter`); `packages/shared`
  (`CasualGetTable` schemas; `MatchGetActiveOutput` gains the ticket field).
- **Contracts/dependencies:** no new wire transports and no new client libraries —
  reuses the F0 tRPC/TanStack-Query/Zustand foundation and the existing seat-ticket
  schema. The `match.getActive` output shape change is additive (optional field).
- **Downstream:** none of `apps/match`, the seat-ticket `onAuth` contract, or the
  match runtime is touched. Unit-E Clerk identity already flows through `getMe`/
  `getActive` and the seat ticket unchanged. This surface is later extended (not
  replaced) by the ranked lobby floor.
