## Why

F2a (`add-web-table-play`) lit the Client↔Match Colyseus seam: a browser joins the
spawned room with its seat ticket, renders the per-seat `FilteredView`, drives the human
intent loop, and plays a 1-human + 3-bot Single-Deck Partners game to completion whose
result persists to Neon. The MVP walking skeleton (SLE-184) now **walks** — but only on
the happy path. Three deliberate F2a non-goals make the live table brittle for anyone
actually using it:

- **No clock countdown.** The room runs authoritative move clocks and already pushes a
  `clockState` payload (and a synced `clockDeadline`); F2a captures it but renders nothing,
  so a player has no idea how long they have before a timeout/auto-action fires.
- **A dropped connection ends the game.** Any pre-completion disconnect drops straight to
  an error/return-to-lobby state — even though the match room holds the seat open for a
  **90-second reconnection grace window** (`allowReconnection`) and pushes a full
  authoritative resync the moment the client returns. The server-side resilience is built
  and tested; the client simply never reconnects.
- **A hard refresh forfeits the game.** The seat ticket lives only in the in-memory session
  store, so reloading `/table/[roomId]` loses it and dead-ends at "return to lobby" — the
  player cannot get back to a game still waiting for them.

This change is **F2b — table resilience**: the second of unit F's two table slices
(F2a play → **F2b resilience**). It closes those three gaps and is scoped to **client-only
work against the already-deployed, already-tested wire contract** — the match room's
reconnection + resync behavior and the `clockState`/`clockDeadline` payloads exist and are
frozen. F2b adds no server, API, contract, schema, or env change. With F2b, the table
survives the disconnects and refreshes a real session produces, completing unit F before
auth (unit E) layers on.

## What Changes

- **Web — live clock countdown.** Render the authoritative move clock the room already
  sends: a live countdown for the seat on the clock (derived from the `clockState.deadline`
  / synced `clockDeadline`, ticking locally against `Date.now()`), plus each seat's
  remaining base/reserve banks from `clockState.seats[]`. The server stays the timeout
  authority — the countdown is informational and clamps at zero; no client-side skew
  correction.

- **Web — in-table reconnect with resync.** On a non-consented, pre-completion drop, enter
  a new `reconnecting` status and call `client.reconnect(reconnectionToken)` against the
  room's grace window instead of going straight to `error`. On success, re-attach the
  message handlers and let the server's resync repopulate the render model (it re-pushes
  `view` + `clockState`); retry with backoff until the grace window closes, then fall back
  to `error`/return-to-lobby. A server-initiated close that follows a `matchResult` view
  stays the success terminal (match complete) — that path never reconnects.

- **Web — cold-load (refresh) rehydration.** Persist the room's `reconnectionToken` (keyed
  by `roomId`, in `sessionStorage`) on every successful (re)connect, and clear it on a
  consented leave, match completion, or a terminal error. On a cold `/table/[roomId]` mount
  with **no** in-memory seat ticket but a stored token for that room, attempt
  `client.reconnect(token)` (which bypasses `onAuth`, needing no re-minted ticket) rather
  than showing return-to-lobby. With no stored token, the F2a return-to-lobby affordance is
  unchanged. A token whose grace has expired fails gracefully back to lobby (the room
  refuses reconnection into a resolved/expired seat).

- **Web — store + status surface.** Extend the table store: add `reconnecting` to
  `TableStatus`, thread the captured `clockState` into the derived render model, and expose
  the per-seat clock banks + on-clock deadline to the view components. A small reconnection
  controller owns token persistence and the reconnect/backoff loop.

**Explicitly out of scope:**

- Optimistic move rendering, card artwork, animations — still pessimistic + functional
  (F2a stance, unchanged).
- Real authentication / Clerk-authenticated rejoin — identity stays stubbed; cold-load
  rejoin rides the Colyseus reconnection token within the grace window, **not** a re-minted
  seat ticket. Long-gap / post-grace rejoin and a ticket-returning `match.getActive` are
  unit E.
- Spectator view, multi-table, in-table chat.
- Any change to `apps/match`, `apps/api`, or `packages/*` — F2b consumes the frozen,
  already-tested reconnection + clock wire contract as-is.

## Capabilities

### New Capabilities

- `table-resilience-web`: the resilience layer over the `apps/web` live table — rendering
  the authoritative move-clock countdown the room already sends, reconnecting through
  Colyseus's grace-window reconnection token (with server resync) after a mid-game drop, and
  rehydrating a session across a hard refresh from a persisted reconnection token, such that
  a transient disconnect or a page reload no longer forfeits an in-progress 1-human + 3-bot
  Single-Deck Partners game. It owns the clock-countdown view, the reconnection controller,
  and reconnection-token persistence; it owns no server reconnection logic (already in
  `apps/match`), no re-minted seat ticket, and no real-auth rejoin (unit E).

### Modified Capabilities

<!-- None at the spec level. The Client↔Match reconnection + clock wire contract
(`allowReconnection`/`reconnect` resync, `clockState`/`clockDeadline`) already exists in
`apps/match` and is unchanged; the `table-play-web` capability's join/render/intent
behavior is unchanged. F2b adds a new client-side resilience surface consuming them. -->

## Impact

- **Code (web only):** `apps/web/app/table/[roomId]/page.tsx` (reconnect lifecycle + cold-load
  rehydration branch), `apps/web/lib/table-store.tsx` (`reconnecting` status, `clockState`
  → render model), a new reconnection-token persistence/controller helper under
  `apps/web/lib/`, and new clock-countdown view components under `apps/web/components/table/`.
  Consumes the existing F0 Colyseus provider (`client.reconnect`) and F2a table store.
- **Contracts consumed (unchanged):** the `apps/match` room reconnection behavior
  (`allowReconnection` + `reconnect` resync, `room.reconnectionToken`) and the
  `clockState`/`clockDeadline` payloads; `@meldrank/engine` view types as in F2a.
- **No backend/infra change:** no new env vars, no API or match-service edits, no schema or
  migration. Completes SLE-184 unit F (table) by hardening the seam F2a lit.
- **Risk:** moderate and contained to one web surface — the trickiest parts are the
  reconnect/backoff state machine and clearing stale persisted tokens so a cold load never
  tries to rejoin a finished game; both degrade safely to the existing return-to-lobby path.
