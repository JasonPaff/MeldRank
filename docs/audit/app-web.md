# Audit: apps/web

## Summary

Overall health: **B+**. For an agentically-built app this is unusually disciplined: a single client boundary, a clean provider stack (Clerk → nuqs → TanStack Query → tRPC → Zustand → Colyseus), realtime logic fully encapsulated in two controller hooks, consistent shadcn/cva UI primitives, zod-validated env handling, and correct Clerk middleware protection. The headline problems are structural rather than local: **zero tests** despite highly testable pure logic (render-model derivation, reconnect state machine), **hand-duplicated wire contracts** between `apps/web` and `apps/match` (message shapes, metadata schema, lifecycle/status strings, the grace window) with no compile-time coupling, a **first-load auth race** on the `window.Clerk` token accessor, and a handful of dead code/dependencies (`lucide-react`, effectively `nuqs`, the store's `playerId` and `clearHandoff`). Component hygiene is good — no god components, minimal prop drilling, sensible memoization — with only small JSX-duplication cleanups worth doing.

## Current architecture

- **Routes** (App Router, all pages effectively client-rendered; no server data fetching anywhere):
  - `app/page.tsx` — lobby shell → `components/hall/casual-hall.tsx` (identity, Quick Play, Create Table, Rejoin, open-table browse list).
  - `app/sign-in/page.tsx`, `app/sign-up/page.tsx` — Clerk hosted components, hash routing.
  - `app/table/pending/[tableId]/page.tsx` — waiting room shell → `components/hall/waiting-room.tsx` + `lib/use-waiting-room.ts` (poll, seat actions, live handoff).
  - `app/table/[roomId]/page.tsx` — live table shell → `components/table/table-view.tsx` + `lib/use-table-connection.ts` (Colyseus join/reconnect controller).
  - Routes are typed via `next-typesafe-url` (`route-type.ts` per dynamic route, `$path` for navigation).
- **Providers** (`app/providers.tsx`): single `'use client'` boundary under a Server Component `app/layout.tsx`. tRPC (`@trpc/tanstack-react-query` proxy, `lib/trpc.ts`) over TanStack Query (`lib/query-client.ts` SSR-safe singleton); Colyseus client in context (`lib/colyseus.tsx`).
- **State**: two per-tree Zustand stores behind context providers — session/handoff (`lib/store.tsx`) and the table render model (`lib/table-store.tsx`, raw two-channel state → one derived `RenderModel` via `useRenderModel`). Reconnection tokens in `sessionStorage` (`lib/reconnection-token.ts`).
- **Data flow**: lobby/waiting room use tRPC queries with `refetchInterval` polling (2 s waiting room, 5 s browse list); the table is pure Colyseus messages (`view`/`accept`/`reject`/`commit`/`clockState`) plus the auto-synced `RoomMetadata` schema.
- **UI kit**: shadcn on Base UI (`components/ui/button.tsx`, `badge.tsx`, `card.tsx`) with `cva` variants and the `cn` helper (`lib/utils.ts`).

## Strengths

- **Realtime encapsulation is genuinely good.** `lib/use-table-connection.ts` owns the entire connection lifecycle (warm join, cold reconnect, capped backoff bounded by the grace window, token persistence, strict-mode-safe teardown at lines 290–300); the route component is a thin renderer. `lib/use-waiting-room.ts` mirrors the pattern for the pre-room phase. Nothing Colyseus leaks into JSX.
- **Store design**: `lib/table-store.tsx` derives one `RenderModel` from raw channel state via `useShallow` + `useMemo` (lines 205–217) — the only place memoization actually matters here, and it's done correctly. Server view always replaces wholesale; no client-side reducer to drift.
- **Client/server split is deliberate and documented**: `app/layout.tsx` stays a Server Component; SSR guards (`lib/colyseus.tsx:23`, `useIsClient` in `app/table/[roomId]/page.tsx:160`) are correct and hydration-safe (`useSyncExternalStore`, not a `useEffect` flag).
- **Env handling is exemplary**: zod schema in `packages/shared/src/env/web.ts`, explicit `process.env.NEXT_PUBLIC_*` member expressions for Next inlining (`lib/env.ts:16-21`), and a build-time Vercel guard for `CLERK_SECRET_KEY` (`next.config.mjs:23-36`).
- **Auth wiring is correct**: `middleware.ts` protects `/` and `/table(.*)` with `auth.protect()`, leaves sign-in/up public, and the matcher covers API routes. Identity is enforced server-side at the API via the bearer token; the client gate is correctly treated as UX only (`middleware.ts:4-9`).
- No `any`, no `@ts-ignore`, no TODO/FIXME anywhere in the app. The two SDK `as` casts are single-boundary and commented (`lib/use-table-connection.ts:237, 265`).
- Consistent file organization (routes thin, controllers in `lib/`, feature components in `components/hall|table`, primitives in `components/ui`) and consistent kebab-case naming.

## Findings

### [SEVERITY: High] Zero test coverage for the most stateful code in the monorepo

- No `*.test.*`/`*.spec.*` files exist under `apps/web`; `apps/web/package.json` has no `test` script, so turbo's `test` task silently skips the app entirely.
- Meanwhile the app contains the repo's trickiest client logic, and much of it is pure and trivially testable without a DOM: `buildRenderModel` and `deriveAvailableAction` (`lib/table-store.tsx:124-189`), the reconnect backoff/grace math (`lib/use-table-connection.ts:211-254`), `trpcErrorCode` (`lib/use-waiting-room.ts:214-222`), `reconnection-token.ts`, and the clock formatters (`components/table/clock.tsx:47-61`).
- Why it matters: the reconnect state machine and the render-model derivation are exactly where regressions will be silent and expensive; the match service (`apps/match`) is well tested, so the client is the weakest link in the realtime seam.
- Fix: add vitest + `@testing-library/react` (or just vitest for the pure functions first). Highest-value order: `buildRenderModel`/`deriveAvailableAction` unit tests, then a `use-table-connection` test against a mock Colyseus client covering the D3 decision table (ticket / stored token / neither) and the drop→reconnect→resync path.

### [SEVERITY: High] Client↔Match wire contract is duplicated by hand, with no compile-time coupling

- `apps/web/lib/use-table-connection.ts:35-58` re-declares `AcceptMessage`, `CommitMessage`, `RejectMessage`, and `SyncedMetadata`; `apps/web/lib/table-store.tsx:30-34` re-declares `ClockStateSnapshot` and `:76-87` `SyncedMetadataSnapshot`. The authoritative shapes live in `apps/match` as untyped `client.send(...)` payloads (`apps/match/src/colyseus/matchRoom.ts:440-455`) and the `RoomMetadata` schema (`apps/match/src/colyseus/schema.ts:25-31`).
- Message *names* (`'view'`, `'accept'`, `'reject'`, `'commit'`, `'clockState'`, `'intent'`, `'contribute'`, `'rejectContribution'`) are string literals on both sides with no shared constant.
- Why it matters: a rename or field change in the match service compiles green on both sides and only fails at runtime in the table UI. This is the single most fragile seam in the app.
- Fix: move the message payload types + a message-name const object into `@meldrank/shared` (it already carries `PlayerIntent`, `SignedSeatTicket`, `ActiveMatch`), and have both `apps/match` (in its effect-translation switch) and `apps/web` import them. Size M, mostly mechanical.

### [SEVERITY: Medium] First-load auth race: tRPC reads the token off `window.Clerk` before clerk-js has loaded

- `app/providers.tsx:54` — `const token = await window.Clerk?.session?.getToken()` inside the `httpBatchLink` headers. `CasualHall` fires `account.getMe` / `match.getActive` on mount (`components/hall/casual-hall.tsx:31-32`), which can race clerk-js's async script load: `window.Clerk` is `undefined`, the request goes out with no `Authorization` header, and the API returns UNAUTHORIZED. TanStack Query's default retry (3x with backoff) usually papers over it, so it shows up as flaky slow first loads and noisy 401s, not a hard failure.
- The hand-rolled `declare global` for `window.Clerk` (`app/providers.tsx:24-28`) is also fragile against Clerk SDK upgrades.
- Fix: gate rendering/queries on Clerk load (`<ClerkLoaded>` around children, or `enabled: isLoaded && isSignedIn` via `useAuth()`), or hold a `getToken` ref populated from `useAuth()` and read it in the link instead of the global. Size S.

### [SEVERITY: Medium] Session-store handoff is never cleaned up; `clearHandoff` and `playerId` are dead

- `lib/store.tsx:20` `clearHandoff` and `:21` `playerId`/`:26` `setPlayerId` — `clearHandoff` has **zero callers**; `playerId` is written by `components/hall/casual-hall.tsx:37-39` (an effect mirroring the query into the store) but **never read** from the store anywhere (the waiting room re-derives it from its own `getMe` query, `lib/use-waiting-room.ts:186`).
- Consequence of the missing cleanup: after a match completes and the player returns to the lobby, the stale `seatTicket`/`activeMatch` stay in the store for the tab's lifetime. A later navigation to any `/table/[roomId]` takes the warm-handoff branch with a ticket minted for a *different* room (`lib/use-table-connection.ts:263`), lands in the `setStatus('error')` path (`:278`) and shows "Connection error" instead of the accurate "No table to join".
- Fix: call `clearHandoff()` on the terminal states in `use-table-connection` (complete/error) or when `TableSurface` unmounts; delete `playerId`/`setPlayerId` and the mirroring effect in `casual-hall.tsx:35-39`, or start actually reading it. Size S.

### [SEVERITY: Medium] Server constants and enums re-hardcoded as magic values / stringly types

- `lib/use-table-connection.ts:61` — `GRACE_MS = 90_000` duplicates `apps/match/src/room/clock.ts:23` (`reconnectGraceMs: 90_000`). Commented as intentional, but a server config change silently desynchronizes the client's give-up time.
- `components/table/table-view.tsx:29` — `SEAT_COUNT = 4` hardcoded even though seat counts are variant-driven in `@meldrank/shared` and the render model already carries per-seat arrays (`model.handSizes`, `model.occupancy`).
- `lib/table-store.tsx:50, 68` — `lifecycle: null | string`, `seatStatus: readonly string[]`; `components/table/table-view.tsx:54` defaults to the magic string `'Empty'`. The real unions (`'Connected' | 'Disconnected' | 'BotControlled' | 'Empty'`, lifecycle markers) live only in `apps/match/src/room/types.ts` and are unreachable from web.
- Fix: fold these into the shared wire-contract move (finding #2): export the status/lifecycle unions and the clock config (or at least the grace constant) from `@meldrank/shared`; derive seat count from the variant already in the handoff (`activeMatch.variantId`). Size S once #2 lands.

### [SEVERITY: Medium] BidControls: stale min-bid state, no input validation, unlabeled input

- `components/table/table-view.tsx:181-182` — `const [value, setValue] = useState(minBid)`: the initial value is captured once. If `currentHigh` changes while the control is mounted (resync mid-turn, rejected bid then updated auction), the input silently keeps the stale value; the `min` attribute (`:190`) doesn't block submission.
- `:189` — `onChange={(e) => setValue(Number(e.target.value))}`: clearing the field yields `NaN`, which is submitted as the bid (`:194`). The server rejects it, so it's not a consistency bug, but it's a guaranteed-failure click.
- `:185-193` — the number input has no label or `aria-label` (accessibility miss; the rest of the app is decent here — `role="status"`/`aria-live` on banners, buttons with visible text).
- Fix: key the control on `currentHigh` (`<BidControls key={currentHigh ?? -1} …/>`), disable Bid when `!Number.isFinite(value) || value < minBid`, add `aria-label="Bid amount"`. Size S.

### [SEVERITY: Medium] Unused and vestigial dependencies

- `lucide-react` (`package.json:24`) — zero imports anywhere in `apps/web`. Dead dependency.
- `nuqs` (`package.json:27`) — the adapter is mounted (`app/providers.tsx:9, 65`) but no `useQueryState`/`parseAs*` call exists anywhere. Either drop it or leave it only if URL state is imminent; today it's provider-stack ceremony.
- `@tanstack/react-query-devtools` is a devDependency imported from production code (`app/providers.tsx:7, 73`). It no-ops in prod builds, but importing a devDependency from shipped source is a hygiene smell; the conventional guard is a `process.env.NODE_ENV` conditional dynamic import or accepting it as a regular dependency.
- Fix: remove `lucide-react`; decide on `nuqs`; leave devtools or gate it. Size S.

### [SEVERITY: Low] Centered-shell JSX duplicated four ways

- `app/table/[roomId]/page.tsx:77-89` (`ReturnToLobby`), `:92-103` (`TableBootPlaceholder`), `components/hall/waiting-room.tsx:91-100` (`Centered`), and the inline `<main className="flex min-h-screen flex-col items-center justify-center …">` in `app/page.tsx:13-15`, `app/sign-in/page.tsx:11`, `app/sign-up/page.tsx:9` are all the same layout cluster with a title/body/action.
- Also duplicated: `SUIT_GLYPH` is defined twice (`components/table/card.tsx:16-21` and `components/table/table-view.tsx:28`), and the `<p className="text-sm text-destructive">…retry…</p>` error-line pattern appears 7+ times across `casual-hall.tsx:67,80,94`, `create-table-button.tsx:42`, `open-table-list.tsx:34`, `table-view.tsx:122`.
- Why it matters: low individually, but these are the exact clusters that drift visually as the app grows.
- Fix: one `CenteredShell` component (title + children + optional action) replacing all four; move `SUIT_GLYPH` next to `TableIntent` in `components/table/` or into shared card-display helpers; optionally a tiny `<ErrorText>` component. Size S.

### [SEVERITY: Low] Waiting-room poll keeps running during the live transition; eviction redirect can race the handoff

- `lib/use-waiting-room.ts:76-83` — the 2 s `getTable` poll has no `enabled` guard for the `transitioning` phase, and the evicted-redirect effect (`:93-95`) stays armed. If the table record TTLs out or is cleaned up between "poll reports live" and the `match.getActive` fetch/navigation (`:101-129`), a NOT_FOUND poll fires `toHall()` (`router.replace('/')`) while the transition effect is about to `router.replace('/table/[roomId]')` — last writer wins. Redis keeps live tables around with a TTL (`apps/api/src/lobby/store.ts:141-151`), so this is an edge case, not a daily bug.
- Fix: add `enabled: Boolean(tableId) && !transitioning` to the poll (or short-circuit the eviction effect when `transitioning`). Size S.

### [SEVERITY: Low] `noSession` is one-way and the no-session decision ignores a late-arriving ticket

- `lib/use-table-connection.ts:89, 96, 111-117` — once `markNoSession(true)` fires, nothing ever sets it back to `false`. The effect *does* re-run when `ticketToken` changes (`:301`), so a late handoff re-attempts the connect, but the stale `noSession === true` keeps `TableSurface` on the "No table to join" screen (`app/table/[roomId]/page.tsx:116-124`) even while a connection succeeds underneath.
- In practice the handoff always precedes navigation today, so this is latent — but it will bite the first time anything sets the ticket after mount.
- Fix: reset `noSession` to `false` at the top of the connect effect (or derive it from store state instead of local `useState`). Size S.

### [SEVERITY: Low] Whole-route client rendering and per-route `'use client'` pages

- `app/table/[roomId]/page.tsx:1` and `app/table/pending/[tableId]/page.tsx:1` are `'use client'` page modules that read params via `useRouteParams` and gate on `useIsClient`. Server Components could pass validated `params` down and render the static shell (`TableBootPlaceholder`) server-side, shrinking the client entry and removing the `routeParams?.roomId` undefined dance.
- This is a fine trade-off for a realtime-only surface; noted as debt, not a defect. The `MatchCompleteBanner` prop typed as `ReturnType<typeof useRenderModel>` (`app/table/[roomId]/page.tsx:34`) should just be `RenderModel`.
- Fix (optional): convert the two pages to Server Components that render a client `<TableRoot roomId={…}>`. Size M, low urgency.

## Test coverage assessment

**None.** No test files, no test runner configured, no `test` script in `apps/web/package.json` — the app is invisible to `turbo run test`. This is the sharpest contrast in the monorepo: `apps/match` has thorough unit/integration tests around the room core, while its client counterpart (the reconnect controller, render-model derivation, waiting-room transitions) has zero. The good news: the architecture already separates pure logic from React (buildRenderModel, deriveAvailableAction, formatters, token persistence), so the first ~30 high-value tests need no DOM at all. Recommended shape:

1. Pure unit tests (vitest, no jsdom): `table-store` derivation, `clock` formatters, `reconnection-token`, `trpcErrorCode`.
2. Hook tests (jsdom + testing-library): `use-table-connection` against a stub Colyseus client (cold-load decision table, drop→backoff→resync, strict-mode double-mount token safety), `use-waiting-room` against a stub tRPC client (evicted, conflict, live handoff).
3. Later: one Playwright smoke against the walking skeleton (lobby → quick play → table renders).

## Recommended action plan

**Quick wins (S):**
1. (S) Delete dead code/deps: `lucide-react`, store `playerId`/`setPlayerId` + the mirroring effect in `casual-hall.tsx:35-39`; decide on `nuqs`.
2. (S) Wire up `clearHandoff()` on table terminal states / unmount; reset `noSession` on reconnect attempts.
3. (S) Fix `BidControls`: key on `currentHigh`, validate before submit, add `aria-label`.
4. (S) Guard the waiting-room poll during `transitioning`.
5. (S) Fix the Clerk token race (`<ClerkLoaded>` gate or `useAuth().getToken` ref in the tRPC link).
6. (S) Extract `CenteredShell`, dedupe `SUIT_GLYPH`.

**Medium:**
7. (M) Move the Client↔Match wire contract (message names + payload types + `RoomMetadata` field shape + seat-status/lifecycle unions + grace constant) into `@meldrank/shared`; import from both `apps/web` and `apps/match`. Kills findings #2 and #5 together.
8. (M) Stand up vitest for `apps/web`; land the pure-logic tests first, then the `use-table-connection` hook tests.

**Larger (optional):**
9. (M/L) Convert the two table pages to Server Component shells with client roots; consider a Playwright smoke test once the shared-contract move stabilizes the seam.
