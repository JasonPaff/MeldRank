## Why

The engine→room→bots→persistence spine is complete and a Single-Deck Partners match self-plays to a durable record, but every surface above it is dark: `apps/api` is a `health`-only tRPC stub, nothing requests a room, and no client could obtain a seat. This is **step 2 (units D + G)** of the MVP first-deploy roadmap (Linear SLE-184): the thinnest API layer that lights the **Client↔API↔Match** path end-to-end. Until the API can create a casual table, spawn an authoritative room, and mint the seat ticket a client presents at the socket, there is no integration spine to deploy and the highest-risk seams stay unproven. Source of truth: **API Surface & Contracts — Design v1** and **Lobby & Matchmaking — Design v1**.

## What Changes

- **Add the shared Zod contract surface (`packages/shared`, unit G).** Procedure input/output schemas for the minimal procedure set, the API↔Match **room-spawn HTTP request/response** pair, the **seat-ticket** payload, the ephemeral **casual-table / seat / bot** Redis state shapes, and the cross-cutting conventions this change relies on (cursor-pagination envelope, a small typed error taxonomy). Imported by both `apps/api` and `apps/match` for end-to-end types.
- **Add the minimal tRPC routers (`apps/api`, unit D).** `account.getMe` (over **stubbed identity**), `variant.list` / `variant.get` (resolved Variant Definitions), and the casual lobby procedures `casual.createTable` / `casual.listOpenTables` / `casual.joinSeat` / `casual.leaveTable` / `casual.addBot` / `casual.quickPlay`, plus `match.getActive`. Ranked, profile, leaderboard, notifications, report, and admin procedures are **deferred**.
- **Hold casual-table / seat / bot lobby state in Redis (ephemeral).** Tables, their seat occupancy, and bot fills live in Upstash Redis as transient state — no new Postgres schema. This matches the eventual Lobby design and keeps the skeleton's lobby naturally disposable.
- **Drive room spawn over an internal HTTP seam (not Redis pub/sub).** When a table is ready to play, the API calls an **authenticated internal HTTP endpoint** on the match service that runs Colyseus `matchMaker.createRoom('match', …)` with the frozen variant + seating assignment + bot count and returns a room handle synchronously. This honors the design's intent (the API drives spawn, server-authoritative seating) while sidestepping the Upstash REST client's inability to hold a subscription. **Deviation flagged & ruled 2026-06-27** from API Surface §5's literal "Redis pub/sub" wording.
- **Mint and verify the seat ticket (stubbed identity).** On a successful seat/join the API mints a signed seat ticket (stub `playerId`, room id, seat index, expiry) server-side; the match service verifies the ticket's signature and binds the connection to its reserved seat at the room's `onAuth` hook (today the room has no auth gate).
- **Wire the `apps/api` clients.** Construct and use the db/redis clients already validated-but-idle in `apps/api/src/index.ts`; add the internal HTTP server route to `apps/match`.

Out of scope (deferred): real Clerk auth + webhooks + `account.completeOnboarding/updateProfile/requestDeletion` (unit E); the web lobby + table UI (unit F); ranked queue / rating / leaderboard / profile / notifications / report / admin procedures; per-endpoint rate-limit values (Auth §11, Next); infra provisioning (unit H).

## Capabilities

### New Capabilities

- `shared-api-contracts`: the isomorphic Zod contract surface in `@meldrank/shared` for this slice — the tRPC procedure I/O schemas, the room-spawn HTTP request/response pair, the seat-ticket payload, the ephemeral casual-table/seat/bot Redis state shapes, and the shared cursor-pagination envelope + typed error taxonomy the procedures use.
- `account-and-reference-api`: the read-only API entry points that need no lobby state — `account.getMe` resolved over stubbed identity, and `variant.list` / `variant.get` returning resolved Variant Definitions for table creation and rules reference.
- `casual-lobby-api`: the casual table lifecycle in `apps/api` over ephemeral Redis state — `createTable`, `listOpenTables`, `joinSeat`, `leaveTable`, `addBot`, `quickPlay`, and `match.getActive` — including when a full table triggers room spawn and mints each human seat's ticket.
- `match-spawn-gateway`: the match service's authenticated **internal HTTP** spawn entry point that maps a spawn request (frozen variant + seating assignment + bot count) onto `matchMaker.createRoom('match', …)` and returns a room handle to the API.

### Modified Capabilities

- `match-room-lifecycle`: the room gains a seat-ticket **`onAuth`** gate — a joining connection must present a valid, unexpired, signature-checked ticket and is bound to its reserved seat; room creation accepts the seating assignment supplied by the spawn gateway. Previously join carried only a stubbed in-room identity with no ticket verification.

## Impact

- **Packages:** `@meldrank/shared` gains the `shared-api-contracts` surface (new Zod schemas + a server-side seat-ticket sign/verify helper, alongside the existing `MatchResultEvent`). No change to the engine, fairness, or db schema.
- **Code — `apps/api`:** new tRPC routers (`account`, `variant`, `casual`, `match`) replacing the `health`-only stub root; constructs and uses the db + redis clients; an internal HTTP client to the spawn gateway; Redis-backed casual-table store.
- **Code — `apps/match`:** a new authenticated internal HTTP route → `matchMaker.createRoom`; an `onAuth` seat-ticket verification in `MatchRoom`; `onCreate` accepts the seating assignment. The pure `RoomCore`, the engine, and persistence are untouched.
- **Data:** no new Postgres migrations; casual-lobby and seat-ticket state are ephemeral in Upstash Redis. `match_participants` still deferred (player FKs → unit E).
- **Contracts / seams:** establishes the Client↔API tRPC surface, the API↔Match internal HTTP spawn seam, and the seat-ticket the Client↔Match WebSocket consumes — the three integration seams the walking skeleton must light.
- **Dependencies:** `apps/api` adds the tRPC HTTP adapter wiring + an HTTP client and the `@meldrank/shared/server` redis/db clients; `apps/match` reuses its existing Colyseus HTTP server for the internal route. No engine/runtime additions. All new deps at latest stable.
