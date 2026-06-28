## Context

The match runtime is complete through persistence (units A–C): a Single-Deck Partners table self-plays with 1 stub-human + 3 bots and writes a durable record. But nothing above the runtime exists — `apps/api` is a `health`-only tRPC stub, `apps/match` only _publishes_ results, and there is no way for a client to reach a seat. This change builds **units D + G** of the MVP roadmap (SLE-184 step 2): the minimal API + shared contracts that light the three integration seams of the walking skeleton.

```
   apps/web ──tRPC──▶ apps/api ──internal HTTP──▶ apps/match
   (later, F)         (this change)   spawn req     matchMaker.createRoom
                          │  ▲                          │
                   mint seat ticket ◀──room handle──────┘
                          │
                          ▼  (ticket presented at onAuth)
                   client ──Colyseus WS──▶ MatchRoom (verifies ticket)
                          ▲
            Redis (Upstash): ephemeral table/seat/bot state
```

Constraints that shape the design:

- **Stack is locked** (Technical Architecture §7): tRPC client↔API, Colyseus client↔room, Upstash Redis for API↔Match coordination, Zod everywhere, schemas in `@meldrank/shared`.
- **Upstash Redis is the REST client** (`@meldrank/shared/server`): it can `PUBLISH` and run normal commands but **cannot hold a subscription**, and `apps/api` is stateless/serverless on Vercel — so a "publish spawn request, await reply over pub/sub" pattern is not directly buildable.
- **Identity is stubbed** this slice (SLE-184 lock): no Clerk yet; the room already carries a stubbed in-room identity but has **no `onAuth` gate**.
- **Design source of truth** lives in Linear: API Surface & Contracts v1 (the procedure/transport inventory), Lobby & Matchmaking v1 (casual table lifecycle), Auth & Identity v1 (seat-ticket concept).

Three decisions were ruled with Jason on 2026-06-27 before drafting: **(1)** D+G ship as one change; **(2)** identity stays stubbed (Clerk → unit E); **(3)** casual-table state lives in Redis (ephemeral). A fourth — the spawn-seam transport — was flagged as a deviation from the locked design and ruled below (D1).

## Goals / Non-Goals

**Goals:**

- A working **Client↔API tRPC surface** for the minimal procedure set, end-to-end typed from `@meldrank/shared` Zod schemas.
- A working **API↔Match spawn seam**: the API can create an authoritative room with a frozen variant, a seating assignment, and bot fills, and get back a room handle.
- A **server-side seat ticket** the API mints and the room verifies at `onAuth`, binding a connection to its reserved seat.
- Casual table lifecycle (create / list / join / leave / add-bot / quick-play) + `match.getActive`, backed by **ephemeral Redis** with no new Postgres schema.
- Keep `apps/match`'s pure `RoomCore`, the engine, and persistence **untouched** — all additions are adapter-level.

**Non-Goals:**

- Real Clerk auth, webhooks, onboarding, profile mutations (unit E).
- Web lobby / table UI (unit F).
- Ranked queue, rating, leaderboard, profile, notifications, report, admin procedures.
- Durable persistence of lobby/table state, `match_participants`, or a matchmaking history.
- Per-endpoint rate-limit values and the full error taxonomy (only the subset this slice uses).
- Infra provisioning / first deploy (unit H) — this change is validated locally/in tests.

## Decisions

### D1 — Room spawn over an internal authenticated HTTP endpoint (not Redis pub/sub)

The API calls `POST /internal/rooms` on the match service with `{ variantId, seating, bots }`; the route runs Colyseus `matchMaker.createRoom('match', options)` and returns `{ roomId, … }` **synchronously**. The match service already runs an HTTP server (Colyseus' transport), so the route is a small addition. The endpoint is authenticated with a shared internal secret (env), since it is service-to-service and never client-reachable.

- **Why:** Upstash REST cannot hold a subscription and the API is serverless, so the design doc's literal "Redis pub/sub request → await room-handle reply" is not buildable without a second (TCP) Redis client or a polling consumer loop. A synchronous HTTP request/reply is the simplest thing that honors the design's _intent_ — the API drives spawn, the server owns seating — with the least new machinery.
- **Alternatives considered:**
  - _Colyseus `matchMaker` with a shared Redis driver/presence in the API:_ most Colyseus-native, no custom protocol — but couples the serverless API to Colyseus internals and requires a TCP `@colyseus/redis-driver` (ioredis), contradicting the REST-only client and the stateless API.
  - _Redis list + polled reply (literal to the design):_ API `LPUSH`es a spawn request; the long-lived match process consumes and writes a room handle to a reply key with a TTL; API polls over REST. Honors "Redis-mediated" but adds polling latency and a consumer loop on the match side for no skeleton benefit.
- **Deviation note:** This is a flagged, ruled deviation from API Surface §5's "Redis pub/sub" wording. Redis is still used here — for the ephemeral lobby state and the seat-ticket store — just not for the spawn request/reply. Revisit if/when a TCP Redis or a real message bus is introduced.

### D2 — Casual table / seat / bot state lives in ephemeral Redis

A casual table is a small JSON record keyed in Redis (e.g. `lobby:table:{id}`) holding its frozen variant, per-seat occupancy (stub `playerId` | bot | empty), and status (`open` → `spawning` → `live`). `listOpenTables` reads an index set; seat/bot mutations are guarded so two joiners can't claim the same seat (a per-table optimistic check / Redis `WATCH`-style guard or a Lua/transaction primitive available on Upstash).

- **Why:** matches the eventual Lobby design, needs no Postgres migration, and a skeleton lobby is naturally disposable. Tables carry a TTL so abandoned ones self-evict.
- **Alternatives considered:** _match service owns table state_ (rejected — blurs the API/Match boundary the seams are meant to prove); _Postgres-backed tables_ (rejected — premature durability for a walking skeleton).

### D3 — Server-minted, signature-verified seat ticket (stubbed identity)

The API mints a seat ticket on a confirmed seat/join: a small payload `{ roomId, seat, playerId (stub), variantId, exp }` signed with an HMAC over a shared secret (env). The client presents the ticket to Colyseus; `MatchRoom.onAuth` verifies signature + expiry + room match and returns the seat binding, rejecting otherwise. The ticket schema and the sign/verify helper live in `@meldrank/shared` (the helper server-only).

- **Why:** server-authoritative seating means the client cannot choose its own seat; a signed ticket is the design's chosen mechanism (Auth §6) and works unchanged when stub `playerId` is later replaced by a Clerk-resolved one (unit E only swaps where `playerId` comes from).
- **Alternatives considered:** _Colyseus seat reservation tokens_ (rejected — ties the ticket to Colyseus' reservation lifecycle and matchMaker internals, harder to evolve toward the Auth design); _no ticket, trust the client_ (rejected — defeats server-authoritative seating even in a skeleton).

### D4 — One change, four small capabilities, contracts-first

G lands as a `shared-api-contracts` capability; D splits into `account-and-reference-api` (read-only, no lobby state), `casual-lobby-api` (the table lifecycle + spawn trigger + ticket mint), and `match-spawn-gateway` (the match-side internal endpoint). `match-room-lifecycle` is modified for the `onAuth` gate. Contracts are authored first so both apps compile against the same types.

- **Why:** keeps each spec coherent and reviewable; mirrors the fine-grained capability style already in `openspec/specs/`. The split also maps cleanly onto the task ordering (contracts → match gateway/auth → API routers → integration test).

### D5 — Stubbed identity is a single seam, not scattered

A `resolveStubIdentity(ctx)` helper in `apps/api` returns `{ playerId }` from a header/default for now; every `player`-scoped procedure goes through it. Unit E replaces only this helper + adds the `onAuth` ticket→Clerk linkage, without touching procedure bodies.

## Risks / Trade-offs

- **[Spawn HTTP deviates from the locked design doc.]** → Captured as a flagged, ruled deviation (D1); Redis still mediates lobby + ticket state. The seam is small and swappable if a real bus arrives.
- **[Seat-claim race in Redis under concurrent joiners.]** → Guard seat/bot mutations with an atomic check (Upstash transaction/Lua or compare-and-set on a per-table version); on conflict return a typed `conflict` error and let the client re-read. Skeleton concurrency is low, but the guard prevents double-seating.
- **[Internal spawn endpoint is unauthenticated-by-default if the secret is missing.]** → Fail closed: the route rejects when the internal secret is unset/!match; the secret is part of `pnpm env:check` so a missing value fails fast at boot.
- **[Stub identity could leak into deployed environments.]** → The stub resolver is explicit and centralized (D5); unit E removes it. Keep it behind the same env gate so a production build without Clerk can't silently accept stub identities.
- **[Ticket replay / sharing.]** → Short expiry + room-bound payload + single-use binding at `onAuth` (a ticket is valid only for its room+seat). Full anti-replay hardening is an Auth-slice concern, noted not solved here.
- **[Redis table state orphaned if spawn fails after seats fill.]** → Table status transitions are explicit (`open`→`spawning`→`live`); a failed spawn rolls back to `open` (or evicts via TTL), surfaced as a typed error to the caller.

## Migration Plan

No data migration — all new state is ephemeral Redis or in-memory rooms. Deployment order (later, unit H): the match service must expose the internal route and share the ticket/internal secrets with the API before the API's spawn calls succeed. Rollback is config-only: the API's spawn calls fail closed and the lobby simply cannot start matches; nothing durable is written. New env keys (internal spawn secret, seat-ticket signing secret) are added to the env contract and `pnpm env:check`.

## Resolved Questions (ruled with Jason 2026-06-27)

- **Quick-play matching → always create fresh + bot-fill.** For the skeleton, `quickPlay` auto-creates a new table on the default variant (**Single-Deck Partners**), bot-fills the remaining seats, and spawns immediately. The "find a suitable open table to join" selection logic (Lobby §4.1 / §9 open item) is deferred — not needed to prove the spine. `casual-lobby-api` reflects create-only.
- **Bot difficulty → accept in the contract, ignore in behavior.** `casual.addBot` keeps `difficulty` in its input schema (future-proofs the wire, matches the design), but the seated bot is always the random-legal brain this slice; unit C grows the tiers with no contract change.
- **Error taxonomy subset → emit `validation` + `not-found` + `conflict`.** These are the only codes the skeleton genuinely hits. `unauthorized` / `forbidden` / `rate-limited` stay reserved in the taxonomy for unit E + rate-limiting. A spawn-gateway failure surfaces as a standard internal error (not a typed client-facing code).
