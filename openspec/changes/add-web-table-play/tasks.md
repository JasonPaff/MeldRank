## 1. Table render-model store

- [x] 1.1 Add a table store under `apps/web/lib/` (Zustand, provider-scoped like the F0 session store) holding the latest `FilteredView` and the latest synced `RoomMetadata` snapshot, plus the pending-intent correlation id and a connection-status enum (`connecting`/`connected`/`complete`/`error`)
- [x] 1.2 Expose a derived render model selector (own hand, public table state, per-seat hand sizes + status, on-clock seat, available-action descriptor) and the mutators the message handlers call (`applyView`, `applyMetadata`, `setPending`, `clearPending`, `setStatus`)
- [x] 1.3 Import the wire/render types from `@meldrank/engine` (`FilteredView`, `PublicState`) and `@meldrank/shared` (`PlayerIntent`, `CardRef`); add no new dependencies

## 2. Colyseus connection lifecycle

- [x] 2.1 In the table route, read `seatTicket` + `activeMatch` from the session store; when `seatTicket` is absent (cold load) render a return-to-lobby affordance and do not connect
- [x] 2.2 On mount under the client boundary, `joinById(roomId, { ticket })` via `useColyseus()`; on success set status `connected`, on `onAuth`/join rejection set status `error` with a return-to-lobby affordance
- [x] 2.3 Attach `onStateChange` (→ `applyMetadata`), `onLeave`, and `onError` handlers; leave the room and tear down handlers on unmount
- [x] 2.4 Treat a server-initiated disconnect that follows a view carrying a final `matchResult` as the `complete` terminal state; treat any other pre-completion drop as `error`

## 3. Server→client message handling

- [x] 3.1 `onMessage('view')` and the `view` inside `accept`/`reject` → `applyView` (wholesale replace)
- [x] 3.2 `onMessage('accept')` → apply view + `clearPending` when the `correlationId` matches the in-flight intent
- [x] 3.3 `onMessage('reject')` → apply the authoritative view, surface the reason, `clearPending`
- [x] 3.4 `onMessage('commit')` → fire the best-effort contribution (task 5)
- [x] 3.5 `onMessage('clockState')` → store the payload for F2b (captured, not yet rendered)

## 4. Human intent loop

- [x] 4.1 Derive the available action from `public.phase` + `public.seatToAct` + viewer seat per design D3 (verify the actual `LifecyclePhase` names against `@meldrank/engine` when wiring); render only when it is the viewer's turn and no intent is pending
- [x] 4.2 Render the phase action controls: bid value + pass (Auction), trump suit picker (trump declaration), and selectable own-hand cards (TrickPlay)
- [x] 4.3 On action, generate a `correlationId`, `setPending`, and `room.send('intent', { intent, correlationId })`; disable all action controls while pending or when it is not the viewer's turn
- [x] 4.4 Confirm no `bury` intent path is reachable (Partners only) and no optimistic state mutation occurs before `accept`

## 5. Best-effort seed contribution

- [x] 5.1 On each `commit`, generate 32 random bytes (`crypto.getRandomValues`), hex-encode, and `room.send('contribute', { clientSeed })` exactly once per `handNonce`; never block rendering or the intent loop on it or on `rejectContribution`

## 6. Table view components

- [x] 6.1 Replace the F1 stub `apps/web/app/table/[roomId]/page.tsx` with the live table wired to the store and connection lifecycle (keeping the typed `useRouteParams` route param)
- [x] 6.2 Build the table layout: own hand, opponents as `handSizes` card-backs with seat status, current/completed tricks, contract/trump + auction standing, running scorepad, and the connecting/error/complete states
- [x] 6.3 Functional/legible card rendering (text or simple chips per design Open Question) — no artwork/animation

## 7. Validation

- [x] 7.1 Run lint, typecheck, and tests via the validate agent across `apps/web` (and any touched `packages/*`); fix failures
- [ ] 7.2 End-to-end smoke against deployed infra: lobby → Quick Play → table joins the reserved seat → play a full 1-human + 3-bot Single-Deck Partners game to completion → confirm a `matches` row persists in Neon (closes SLE-184 unit F task 5.2)
