## 1. Store + render-model surface

- [x] 1.1 Add `'reconnecting'` to `TableStatus` in `apps/web/lib/table-store.tsx` (`complete | connected | connecting | reconnecting | error`)
- [x] 1.2 Thread the captured `clockState` into the derived render model: have `buildRenderModel` read `clockState` (currently ignored) and expose the on-clock `deadline` plus per-seat `seats[]` banks on `RenderModel`; include `clockState` in the `useRenderModel` shallow selector
- [x] 1.3 Verify no store write happens on every countdown frame — the live tick lives in a view-local timer (task 3), the store holds only the latest `clockState`/`clockDeadline`

## 2. Reconnection token persistence

- [x] 2.1 Add a reconnection-token helper under `apps/web/lib/` that reads/writes/clears `{ roomId → reconnectionToken }` in `sessionStorage` (SSR-guarded; tab-scoped), with a stable storage key
- [x] 2.2 Persist the current `room.reconnectionToken` on every successful `joinById` **and** every successful `client.reconnect` (refresh on reconnect, not just first join)
- [x] 2.3 Clear the stored token for the room on a client-initiated leave (unmount/navigation), on match completion (`complete`), and on the terminal `error` state

## 3. Clock countdown UI

- [x] 3.1 Add a small view-local timer hook (≈250 ms interval, cleaned up on unmount) that recomputes `max(0, deadline - Date.now())` for the on-clock seat; clamp at zero, no skew correction
- [x] 3.2 Add clock view components under `apps/web/components/table/`: the on-clock seat's live countdown, and each seat's `remainingBaseMs` / `remainingReserveMs` banks from `clockState.seats[]`
- [x] 3.3 Wire the clock into `TableView`: show the countdown for `onClockSeat`, render no active countdown when no move is pending, and confirm it reads the deadline from `clockState.deadline` with the synced `clockDeadline` as fallback

## 4. In-table reconnect controller

- [x] 4.1 Add a resilience controller (hook/helper under `apps/web/lib/`) owning: consented-vs-non-consented leave classification, the reconnect/backoff loop, and a single in-flight-reconnect guard (mirroring the F2a `disposed` flag; one timer; full teardown on unmount)
- [x] 4.2 In `apps/web/app/table/[roomId]/page.tsx`, change the pre-completion `onLeave` path: instead of setting `error`, set `reconnecting` and call `client.reconnect(reconnectionToken)`; keep the `matchComplete` → `complete` and client-initiated-leave paths non-reconnecting
- [x] 4.3 On reconnect success, re-attach `onStateChange` / `onMessage('view'|'accept'|'reject'|'commit'|'clockState'|'rejectContribution')` / `onLeave` / `onError` (reuse the F2a handler wiring) and set status back to `connected`; the server resync re-pushes `view` + `clockState`
- [x] 4.4 Backoff + grace bound: retry with a short capped backoff, tracking elapsed since the first drop; once the grace window (server default 90 s, with a small margin) is exhausted, set `error` and clear the stored token
- [x] 4.5 Clear the in-flight intent (`pendingCorrelationId`) when entering `reconnecting` so the resynced `view` re-derives the available action (confirm against the server resync semantics — design Open Question)

## 5. Cold-load rehydration

- [x] 5.1 In the table route mount effect, implement the design D3 decision table: in-memory ticket present → F2a `joinById`; ticket absent + stored token present → `client.reconnect(storedToken)`; both absent → return-to-lobby
- [x] 5.2 On a cold `client.reconnect` rejection (grace expired / match resolved / invalid token), clear the stored token and render the return-to-lobby affordance — never retry indefinitely
- [x] 5.3 Confirm warm-handoff (ticket present) behavior is byte-for-byte the F2a path, and the no-ticket-no-token branch still renders the F2a "No table to join" affordance

## 6. Reconnecting UI state

- [x] 6.1 Render a non-blocking "reconnecting…" indicator over the last authoritative view while `status === 'reconnecting'`, keeping the held `view` visible until the resync replaces it
- [x] 6.2 Disable the intent controls during `reconnecting` (it is not the viewer's turn mid-reconnect); re-enable on the resynced view per the normal turn gating

## 7. Validation

- [x] 7.1 Run lint, typecheck, and tests via the validate agent across `apps/web` (and any touched `packages/*`); fix failures
- [x] 7.2 End-to-end smoke against deployed infra — clock: Quick Play → table → confirm the on-clock countdown ticks down and per-seat banks render during a live game
- [x] 7.3 End-to-end smoke — mid-game reconnect: drop the connection mid-hand (e.g. kill the socket / toggle network) and confirm the table reconnects within grace, resyncs the authoritative view, and play continues; let the grace window lapse once and confirm the clean fall-back to return-to-lobby
- [x] 7.4 End-to-end smoke — cold refresh: hard-refresh `/table/[roomId]` mid-game and confirm the session rehydrates from the stored token and rejoins the same seat; refresh after the game ends and confirm it returns to lobby (stale token cleared), not a rejoin attempt
