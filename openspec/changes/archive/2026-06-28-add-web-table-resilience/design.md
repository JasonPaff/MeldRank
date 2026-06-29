## Context

F2a (`add-web-table-play`) shipped the live table: `apps/web/app/table/[roomId]/page.tsx`
joins the spawned Colyseus room with the lobby's seat ticket, merges the two state channels
(auto-synced `RoomMetadata` schema + discrete `view`/`accept`/`reject`/`commit`/`clockState`
messages) into a route-scoped Zustand table store (`apps/web/lib/table-store.tsx`), drives
the pessimistic human intent loop, and plays a 1-human + 3-bot Single-Deck Partners game to
completion + persistence. Three F2a non-goals are this slice's scope: clock-countdown UI,
in-table reconnect/resync, and cold-load (refresh) rehydration.

The wire contract F2b consumes already exists in `apps/match` and is **frozen**:

- **Reconnection (server-side, built + tested).** When a `Live` seat drops, the Colyseus
  adapter's `onLeave` holds the seat open with `allowReconnection(client, graceSeconds)` for
  the configured **90 s casual grace** (`DEFAULT_CLOCK_CONFIG.reconnectGraceMs`). A return
  within the window runs the pure `reconnect(core, token, newSessionId, now)`, which restores
  the seat and **pushes a full authoritative resync (`view` + `clockState`)**. The grace
  timer otherwise fires `expireGrace` → bot-takeover/abandonment. The room **refuses
  reconnection into a resolved match**. The client mechanism is Colyseus's
  `room.reconnectionToken` + `client.reconnect(token)` (`@colyseus/sdk` 0.17), which bypasses
  `onAuth` — no re-minted seat ticket.
- **Clocks.** The synced `RoomMetadata` carries `clockDeadline` (injected ms, `-1` when no
  pending move). The `clockState` message carries `{ actingSeat, deadline, seats: [{ seat,
remainingBaseMs, remainingReserveMs }] }`. F2a already captures `clockState` into the store
  (`setClockState`) and renders nothing.

F2b is **web-only**: no change to `apps/match`, `apps/api`, or `packages/*`. See proposal.md
for motivation; "Game Client & Table UI — Design v1" and "Match Runtime — Design v1" (Linear)
for the locked surface; F2a's design.md (D5, D6, Open Questions) for the limitations this
slice resolves.

## Goals / Non-Goals

**Goals:**

- Render a live move-clock countdown for the on-clock seat and each seat's remaining
  base/reserve banks, from the payloads the room already sends.
- Reconnect through the grace window after a mid-game drop, re-attach handlers, and let the
  server resync repopulate the render model — instead of forfeiting to an error state.
- Survive a hard refresh: rehydrate the session from a persisted reconnection token and
  rejoin without a seat ticket, within the grace window.
- Keep all of the above client-only against the frozen reconnection + clock contract.

**Non-Goals:**

- Optimistic move rendering, artwork, animation (F2a stance, unchanged).
- Real-auth rejoin / Clerk, ticket-returning `match.getActive`, post-grace (long-gap) rejoin
  — unit E.
- Clock-skew correction between client and server clocks (the server is the timeout
  authority; the countdown is informational).
- Any `apps/match` / `apps/api` / `packages/*` change.

## Decisions

### D1 — Clock countdown rendered locally from the authoritative deadline

The seat on the clock shows a countdown computed as `max(0, deadline - Date.now())`,
re-evaluated on a lightweight interval (≈250 ms) and clamped at zero; `deadline` is the
`clockState.deadline` for the acting seat (falling back to the synced `clockDeadline` when no
`clockState` has arrived yet). Each seat additionally shows its `remainingBaseMs` /
`remainingReserveMs` from `clockState.seats[]` as static bank labels, refreshed whenever a new
`clockState` arrives. The countdown is **informational** — the server enforces the actual
timeout/auto-action — so no clock-skew correction or server-time handshake is attempted; a few
hundred ms of drift is acceptable for the skeleton.

- The `clockState` payload is threaded into the derived render model (F2a stored it but
  `buildRenderModel` ignored it); the ticking itself lives in a small view-local timer hook so
  the store is not written on every frame.

_Alternative considered:_ drive the countdown purely off the synced `clockDeadline`. Rejected
— `clockState` additionally carries the per-seat banks the UI wants, and a single source for
both the active deadline and the banks keeps the render model coherent.

### D2 — Reconnect via the Colyseus reconnection token, server drives resync

After a successful `joinById`/`reconnect`, the room exposes `room.reconnectionToken`. On a
**non-consented, pre-completion** `onLeave`, the controller transitions status to
`reconnecting` and calls `client.reconnect(reconnectionToken)`. On success it re-attaches the
same `onStateChange`/`onMessage`/`onLeave`/`onError` handlers and sets status back to
`connected`; the server's `reconnect` resync re-pushes `view` + `clockState`, so the render
model **repopulates itself** — the client reconstructs nothing.

- **Consented vs. non-consented.** A leave the client itself initiated (unmount/navigation
  via `room.leave()`, guarded by the existing `disposed` flag) and a server close that follows
  a `matchResult` view (`matchComplete` → `complete`) never reconnect. Every other drop while
  not yet complete is treated as reconnectable within grace.
- **Backoff within grace.** Retry `client.reconnect` with a short backoff (e.g. 1 s, capped)
  until the 90 s grace window is exhausted (track elapsed since the first drop), then set
  `error` and show return-to-lobby. The window length is the server's; the client need not know
  it exactly — it bounds attempts by elapsed wall-clock with a small margin.

_Alternative considered:_ re-mint a seat ticket via `match.getActive` and re-`joinById`.
Rejected for F2b — it needs an API change and real identity to be correct; the reconnection
token already authorizes the exact dropped seat within grace with zero server work. (Post-grace
rejoin is unit E.)

### D3 — Cold-load rehydration from a persisted reconnection token

Persist `{ roomId, reconnectionToken }` to `sessionStorage` (tab-scoped; survives reload, not
tab close) on **every** successful (re)connect, and **clear** it on a consented leave, match
completion, or terminal error. On a cold `/table/[roomId]` mount:

| in-memory ticket       | stored token for this `roomId` | action                                                         |
| ---------------------- | ------------------------------ | -------------------------------------------------------------- |
| present (warm handoff) | —                              | F2a path: `joinById` with the ticket                           |
| absent                 | present                        | `client.reconnect(storedToken)` — bypasses `onAuth`, no ticket |
| absent                 | absent                         | F2a path: render return-to-lobby, connect nothing              |

A stored token whose grace has already expired makes `client.reconnect` reject; that is caught
and degrades to the return-to-lobby affordance (and the stale token is cleared). Because the
room refuses reconnection into a resolved match, a token left over from a finished game is also
safe — it fails closed.

- `sessionStorage` (not `localStorage`) so the token is naturally scoped to the tab and does
  not linger across browser sessions; it is also explicitly cleared on every terminal state, so
  a cold load never tries to rejoin a game that already ended in this tab.

_Alternative considered:_ persist the seat **ticket** instead of the reconnection token.
Rejected — the ticket is a bearer credential for `onAuth` with a longer life and broader
authority; the reconnection token is single-seat, single-session, grace-bounded, and exactly
the right scope to stash.

### D4 — `reconnecting` as a first-class status; resilience controller owns the machine

`TableStatus` gains `'reconnecting'` (`complete | connected | connecting | reconnecting |
error`). A small resilience controller (a hook/helper under `apps/web/lib/`) owns: token
persistence, the consented/non-consented leave classification, the reconnect/backoff loop, and
the cold-load decision table (D3). The route component keeps owning the store provider and the
intent submit; the controller is what `onLeave`/`onError`/mount call. This keeps the already-
dense `TableSurface` effect from growing a second tangled state machine.

- The render layer shows a non-blocking "reconnecting…" banner over the last good view during
  `reconnecting` (the held `view` is still the truth until resync replaces it), and disables the
  intent controls (it is not your turn to act mid-reconnect). On success the banner clears; on
  grace exhaustion it becomes the F2a connection-error state.

## Risks / Trade-offs

- **[Reconnect storm / leak]** — a botched backoff loop could spawn overlapping reconnect
  attempts or leak rooms. Mitigation: a single in-flight reconnect guarded like F2a's `disposed`
  flag; one timer; tear everything down on unmount; bound attempts by elapsed grace.
- **[Stale token rejoins a finished game]** (D3) — Mitigation: clear the token on every terminal
  state, and the server independently refuses reconnection into a resolved match, so the worst
  case is a caught rejection → return-to-lobby.
- **[Clock drift]** (D1) — the countdown may disagree with the server by client/server skew.
  Accepted: the server is the timeout authority; the number is informational and clamps at zero.
- **[`reconnectionToken` freshness]** — Colyseus refreshes the token on each (re)connection, so
  persisting only at join time could leave a stale token after a reconnect. Mitigation: re-persist
  on **every** successful (re)connect (D3), not just the first.
- **[Double-reconnect across cold-load + drop]** — a refresh during an active drop could race the
  in-table reconnect and the cold-load rehydration. Mitigation: cold load only runs on a fresh
  mount with no live room; the in-table path only runs while a room object exists — the two are
  mutually exclusive by construction.

## Open Questions

- **Grace-window surfacing:** should the reconnecting banner show a countdown to the grace
  deadline (the client can approximate it from the drop time + 90 s) or just a spinner? Lean
  spinner for F2b; a grace countdown is easy to add if desired.
- **Post-grace / long-gap rejoin (unit E):** once the grace window closes the seat is abandoned to
  a bot; getting _back in_ after that needs a re-minted ticket and real identity. Confirmed out of
  scope here; flagged for unit E.
- **Reconnect during the viewer's own pending intent:** if a drop happens between `send('intent')`
  and `accept`/`reject`, the resync `view` is the post-move (or unchanged) authority. F2b clears
  pending on entering `reconnecting` and lets the resync view re-derive the available action —
  confirm this matches the server's resync semantics during implementation.
