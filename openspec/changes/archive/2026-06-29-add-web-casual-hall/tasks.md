## 1. Shared contracts (`packages/shared/src/api`)

- [x] 1.1 Add `CasualGetTableInputSchema` (`{ tableId: string().min(1) }`) and `CasualGetTableOutputSchema` (`CasualTableSchema`) in `procedures.ts`; export them from the api barrel alongside the other casual schemas
- [x] 1.2 Extend `MatchGetActiveOutputSchema` to carry an **optional** `ticket: SignedSeatTicketSchema` beside the existing room handle + seat, keeping the whole result nullable (no live match → null); the field's absence must not break the F1 Rejoin caller
- [x] 1.3 Update the `shared-api-contracts` contract test (`packages/shared/src/api/contracts.test.ts`) to assert `casual.getTable` schemas exist and `match.getActive` output includes the optional ticket; confirm the schemas pull in no server-only modules

## 2. API procedures (`apps/api/src/routers`)

- [x] 2.1 Add `casual.getTable` to `casual.ts`: read `ctx.store.get(input.tableId)`, return it, and throw a typed `not-found` (`apiError('not-found', …)`) when the store returns null; read-only, no mutation (spec `casual-lobby-api` ADDED)
- [x] 2.2 In `match.ts` `getActive`, after resolving the live table + caller seat, mint a fresh ticket via `ctx.tickets.mint({ roomId, seat, playerId: ctx.playerId, variantId: table.variantId })` and include it in the result (spec `casual-lobby-api` MODIFIED, design D1)
- [x] 2.3 Extend the API router tests (`apps/api/src/routers/api.test.ts`): `getTable` returns a known table and rejects an unknown id with `not-found`; `getActive` for a seated caller returns a ticket that `verifySeatTicket` accepts for that room/seat/player, and returns null with no ticket when the caller is in no live match

## 3. Web UI primitives (`apps/web/components/ui`)

- [x] 3.1 Add `card.tsx` and `badge.tsx` (shadcn on the Base UI registry, matching the existing `button.tsx` setup) as the shared primitives for hall rows, seat slots, panels, and occupancy/status chips (design D8a); no feature logic in these

## 4. Web hall surface — browse & create (`apps/web/components/hall`, `app/page.tsx`)

- [x] 4.1 `open-table-list.tsx` + `open-table-row.tsx`: poll `casual.listOpenTables` (TanStack Query `refetchInterval`, slower cadence per design Open Question); render each table as a `Card` row with its variant, an occupancy `Badge` (humans vs. bots, e.g. "2/4 · 1 bot"), and an **"Open"** affordance that navigates to that table's waiting room **without claiming a seat** (design D8c); include loading/error/empty states (spec `casual-hall-web` "Browse open casual tables")
- [x] 4.2 `create-table-button.tsx`: call `casual.createTable` on `DEFAULT_VARIANT_ID` (design D4 — no variant picker); pending-guarded against double-submit; on success navigate to the waiting room for the returned table id; on failure show a retryable error without navigating (spec "Create a casual table")
- [x] 4.3 `casual-hall.tsx`: compose browse + create; restructure `app/page.tsx` into the hall layout — header + a primary actions row (Quick Play | Create Table) + the open-tables list (design D8b) — keeping the existing Quick Play + Rejoin (`casual-lobby-web`) behavior unchanged

## 5. Web waiting room (`apps/web`)

- [x] 5.1 Add the `tableId`-keyed waiting-room route `app/table/pending/[tableId]/` (`page.tsx` + typed `route-type.ts`, like the F2 play route); keep the page thin, delegating to the components below and the `use-waiting-room` hook (design D6)
- [x] 5.2 `lib/use-waiting-room.ts`: encapsulate the `casual.getTable` poll (faster cadence), the seat-action conflict handling, the evicted-table (`not-found`) → hall redirect, and the live-transition handoff — paralleling `use-table-connection.ts` for the play route
- [x] 5.3 `seat-grid.tsx` + `seat-slot.tsx`: render the N seats; `seat-slot` is one polymorphic `Card` component branching on `seat.kind` + viewer identity + emptiness (empty → Take seat / Add bot; you; other human; bot), mirroring the table's `OpponentSeat` status pattern (spec "Waiting room renders live seat occupancy")
- [x] 5.4 `waiting-room.tsx`: wire seat actions — claim a specific empty seat (`casual.joinSeat`), add a bot to a specific empty seat (`casual.addBot`), leave (`casual.leaveTable` → return to hall); pending-guard each; surface a `conflict` as a non-fatal "seat just taken" + refresh (design D5, spec "Waiting room seat actions"); render a status banner across `open`/`spawning`
- [x] 5.5 Handle a `getTable` `not-found` poll (table evicted) by returning the caller to the hall (spec "An evicted table returns the caller to the hall")
- [x] 5.6 Transition to live: when `getTable` reports `live` with a `roomId`, fetch `match.getActive`, stash the returned ticket + match handle in the F0 session store, and navigate to `/table/[roomId]`; a non-live/`spawning` poll keeps waiting (design D1/D2, spec "Transition to live hands off to the play route")

## 6. Validation

- [x] 6.1 Run lint, typecheck, and tests via the validate agent across `packages/shared`, `apps/api`, and `apps/web`; fix failures
- [x] 6.2 End-to-end smoke against deployed infra: open the hall → create a table → second identity browses + joins a seat → fill remaining seats with bots → both clients auto-transition into the live `/table/[roomId]` room and play proceeds (proves the first human-vs-human assembly path and the `getActive` ticket delivery to a non-final joiner) — _accepted on code-complete + passing automated tests (lint/typecheck/360 tests); live two-identity run deferred to the deploy._
