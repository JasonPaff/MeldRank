## 1. API CORS (cross-origin browser access)

- [x] 1.1 Add `WEB_APP_ORIGIN` to the API env schema (`apiEnv` in `packages/shared/src/server/env/schema.ts`) as a validated URL/origin string
- [x] 1.2 Add `WEB_APP_ORIGIN` to `.env.example` with a non-secret localhost placeholder and to the `pnpm env:check` example so the agreement check passes
- [x] 1.3 Wrap the `createHTTPServer` call in `apps/api/src/index.ts` with a CORS `middleware` that allows `WEB_APP_ORIGIN`, the tRPC methods (`GET`/`POST`/`OPTIONS`) and headers, and short-circuits the `OPTIONS` preflight (use the latest-stable `cors` package or a small hand-rolled handler)
- [x] 1.4 Manually verify from the browser/devtools: an `OPTIONS` preflight and a real `account.getMe` from `WEB_APP_ORIGIN` succeed with the expected `Access-Control-Allow-Origin` header

## 2. Web — session store handoff

- [x] 2.1 Extend `SessionState` in `apps/web/lib/store.tsx` with `seatTicket: SignedSeatTicket | null` and `activeMatch: ActiveMatch | null`, importing the types from `@meldrank/shared`
- [x] 2.2 Add a `setHandoff({ ticket, match })` setter (and a `clearHandoff`) and keep the existing `playerId`/`setPlayerId` wiring

## 3. Web — lobby route

- [x] 3.1 Replace the placeholder `apps/web/app/page.tsx` with the lobby (client component under the F0 provider tree)
- [x] 3.2 Call `account.getMe` via the tRPC TanStack-Query proxy; render the resolved `playerId`, write it into the session store, and handle loading/error states
- [x] 3.3 Call `match.getActive` on load; when non-null, render a **Rejoin** affordance that stashes the handle and navigates to `/table/[roomId]`; when null, render the Quick Play entry point
- [x] 3.4 Implement the **Quick Play** action with `casual.quickPlay` mutation: gate against double-submit via `isPending`, on success stash `{ ticket, roomId, seat, variantId }` and navigate to `/table/[roomId]`, on failure show an error state without navigating

## 4. Web — table route stub (F1/F2 boundary)

- [x] 4.1 Add `apps/web/app/table/[roomId]/page.tsx` that reads the active-match handle from the session store and renders a "connecting… — table UI lands in F2" placeholder
- [x] 4.2 Confirm the table stub initiates no Colyseus `join`/`joinById`/`create`/`reconnect` (uses the configured client at most for display, never connects)

## 5. Validation

- [x] 5.1 Run lint, typecheck, and tests via the validate agent across `packages/shared`, `apps/api`, and `apps/web`; fix any failures
- [ ] 5.2 End-to-end smoke against the running API + web: open the lobby, see identity, click Quick Play, land on the table stub with the handle populated, and confirm a match row persists (the existing server seam)
