## 1. Shared contracts (`packages/shared`) — unit G

- [x] 1.1 Add the tRPC procedure input/output Zod schemas for the minimal set (`account.getMe`, `variant.list`, `variant.get`, `casual.createTable`, `casual.listOpenTables`, `casual.joinSeat`, `casual.leaveTable`, `casual.addBot`, `casual.quickPlay`, `match.getActive`) to the isomorphic surface; export from the `@meldrank/shared` root.
- [x] 1.2 Add the shared cursor-pagination envelope (`{ cursor?, limit }` → `{ items, nextCursor }`) and the typed error taxonomy (`unauthorized | forbidden | not-found | rate-limited | validation | conflict`).
- [x] 1.3 Add the room-spawn request/response schema pair (frozen variant + per-seat seating assignment + bot count → room handle).
- [x] 1.4 Add the seat-ticket payload schema (`{ roomId, seat, playerId, variantId, exp }`) to the isomorphic surface; add the HMAC sign/verify helper to `@meldrank/shared/server` only.
- [x] 1.5 Add the ephemeral casual-table state schema (id, frozen variant, per-seat occupancy, status `open|spawning|live`, list/re-find fields).
- [x] 1.6 Unit-test the contracts: schema round-trips, ticket sign→verify (and reject on tampered/expired/wrong-secret), and that the sign/verify helper is absent from the isomorphic root.

## 2. Env & secrets

- [x] 2.1 Add the internal spawn secret and the seat-ticket signing secret to the server env contract and `pnpm env:check` (match service needs both; API needs both — the spawn secret to call, the signing secret to mint).

## 3. Match service spawn gateway + onAuth — `apps/match`

- [x] 3.1 Add the authenticated internal HTTP route (e.g. `POST /internal/rooms`) on the existing Colyseus HTTP server; reject when the internal secret is missing/mismatched (fail closed).
- [x] 3.2 Map a validated spawn request onto `matchMaker.createRoom('match', …)` with the frozen variant, seating assignment, and bot count; return the room handle; return an error (no handle) on creation failure.
- [x] 3.3 Extend `MatchRoom.onCreate` to accept the seating assignment (which seats are bot-filled vs human-reserved) and fill bot seats accordingly at creation.
- [x] 3.4 Add `MatchRoom.onAuth` seat-ticket verification: check signature, expiry, and `roomId` match; bind the connection to the ticket's reserved seat; reject otherwise. Keep `RoomCore` pure (verification is adapter-level).
- [x] 3.5 Unit-test the gateway (secret gate, request→createRoom mapping, failure path) and `onAuth` (valid binds seat; tampered/expired/mismatched rejects).

## 4. API routers + lobby state — `apps/api`

- [x] 4.1 Replace the `health`-only tRPC root with the router tree (`account`, `variant`, `casual`, `match`); construct and inject the db + redis clients (currently validated-but-idle) and an HTTP client for the spawn gateway.
- [x] 4.2 Add the centralized stub-identity resolver (`resolveStubIdentity(ctx) → { playerId }`) and route every `player`-scoped procedure through it.
- [x] 4.3 Implement `account.getMe`, `variant.list`, `variant.get` (read-only; `variant.get` returns typed `not-found` on miss).
- [x] 4.4 Implement the Redis casual-table store: create/read/list/update with a TTL and an atomic, race-safe seat/bot claim (conflict → typed `conflict`).
- [x] 4.5 Implement `casual.createTable`, `casual.listOpenTables`, `casual.joinSeat`, `casual.leaveTable`, `casual.addBot` (accept `difficulty`, seat random-legal bot).
- [x] 4.6 Implement the full-table → spawn flow: transition `open → spawning`, call the spawn gateway, mint a seat ticket per human seat on the returned handle, transition to `live`; roll back to `open` (or evict) + typed error on spawn failure.
- [x] 4.7 Implement `casual.quickPlay` (create-only: fresh table on the default variant Single-Deck Partners, bot-fill remaining seats, spawn, return the caller's ticket) and `match.getActive` (live room handle + seat, or empty).
- [x] 4.8 Unit-test the routers with a faked redis + spawn client: seat-claim race returns one winner, spawn-failure rollback, ticket minted only on a spawned room, `getActive` populated vs empty.

## 5. End-to-end integration & validation

- [x] 5.1 Add an integration test that drives the seam: `quickPlay` (1 stub-human + 3 bots) → spawn gateway creates the room → the minted ticket passes `onAuth` and binds the seat → the match plays out and persists (reusing the existing persistence path) and `match.getActive` reflects state through `live`.
- [x] 5.2 Run the `validate` agent (lint, typecheck, test) across `packages/shared`, `apps/api`, and `apps/match`; resolve findings.
- [x] 5.3 Update Linear SLE-184 to check off units D + G with a short done-note once the seams are green.
