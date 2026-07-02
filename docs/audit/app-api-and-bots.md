# Audit: apps/api + apps/bots

## Summary

Overall grade: **B+**. `apps/api` is a small (~1.1k LOC source), well-factored tRPC backend with genuinely strong fundamentals for an agentically-built codebase: every mutating route is auth-gated, all inputs/outputs are zod-validated, the env is schema-validated at boot, the Clerk webhook verifies svix signatures, and logging is structured with per-request trace ids. The headline issues are (1) a real concurrency hole in the Redis lobby store — `releaseSeat` and the other status transitions are plain read-modify-writes that can race the atomic Lua seat claim and silently undo a successful join; (2) the spawn HTTP client has no timeout, so a hung match service can strand a table in `spawning` for up to an hour; and (3) `apps/bots` is a vestigial deployed stub — it starts, logs three lines, and exits, does not even depend on the real bot package (`packages/bots`, which runs in-process inside `apps/match`), yet is still wired into the Fly CD matrix. Test coverage of the routers/webhook/resolver is good, but `identity.ts` (the actual Clerk token verification edge) has zero tests despite a comment claiming otherwise.

## Current architecture

- **Entry**: `apps/api/src/index.ts` — a single standalone `@trpc/server` HTTP server (`createHTTPServer`) on Fly.io (scale-to-zero, `apps/api/fly.toml`). Middleware applies single-origin CORS (`src/cors.ts`), short-circuits OPTIONS, and hand-routes `POST /api/webhooks/clerk` to the non-tRPC webhook handler before the tRPC adapter.
- **Routers** (`src/routers/`): `health` (public), `account.getMe`, `variant.list/get` (public, static catalog from `src/variants.ts`), `casual.*` (create/list/join/leave/getTable/addBot/quickPlay), `match.getActive`. All non-reference procedures use `protectedProcedure`.
- **Auth**: `src/identity.ts` verifies `Authorization: Bearer` Clerk session tokens via `@clerk/backend` `verifyToken` with `authorizedParties` pinned to `WEB_APP_ORIGIN`; `src/players.ts` resolves Clerk user id → internal `players.id` (Redis-cached 30d, `INSERT ... ON CONFLICT` create). `src/webhook.ts` is the svix-verified Clerk sync (`user.created`/`user.updated` upsert).
- **State**: casual tables live only in Redis (`src/lobby/store.ts`, 1h TTL) with an atomic Lua seat-claim script; Postgres (Drizzle over Neon HTTP, schema in `packages/shared/src/server/db/schema/`) is touched by the API only for the `players` table. Seat tickets are HMAC-minted (`src/lobby/tickets.ts`); rooms are spawned via an internal secret-authenticated HTTP call to the match service (`src/spawn/client.ts`, orchestrated by `src/lobby/spawn-flow.ts`).
- **apps/bots**: a 31-line boot stub (`apps/bots/src/index.ts`) that validates env, constructs db/redis/logger, logs "worker started", and returns. It depends on `@meldrank/engine` + `@meldrank/shared` but **not** on `@meldrank/bots` — the real bot brain (`packages/bots`) is consumed in-process by `apps/match` (`apps/match/src/colyseus/matchRoom.ts`). It nonetheless has a Dockerfile, `fly.toml`, and a slot in the CD matrix (`.github/workflows/deploy.yml:81`).

## Strengths

- **Auth on every endpoint that needs it**: `protectedProcedure` (`apps/api/src/trpc.ts:110-113`) gates all account/casual/match procedures; only `health` and the read-only static `variant.list/get` are public — appropriate. Identity is resolved once per request at a single seam (`src/context.ts:63-86`), never re-read in procedure bodies.
- **Validation everywhere**: every procedure declares `.input()` and `.output()` zod schemas from `@meldrank/shared`; Redis payloads are re-validated on read (`store.ts:127-131`); the spawn response is schema-parsed (`client.ts:52`).
- **Env handling is exemplary**: layered zod schemas (`packages/shared/src/server/env/schema.ts`), fail-fast at boot with aggregated errors, per-process surfaces.
- **Webhook security is correct**: raw-body svix verification (`webhook.ts:79`, `webhook.ts:96-103`), 400 with no mutation on bad signature, idempotent upsert (so replayed deliveries are harmless without svix-id bookkeeping).
- **Consistent error model**: a typed taxonomy (`ApiError`, `trpc.ts:72-100`) mapped onto tRPC codes, with structured failure logging middleware (`trpc.ts:58-69`) distinguishing `warn` (client errors) from `error` (server faults).
- **CORS is single-origin, never `*`** (`cors.ts:17-24`), matching the documented single-origin deployment constraint.
- **The two-claimers seat race is genuinely solved** with a Lua script plus a pure mirror used by the test fake (`store.ts:84-116`), and the race is tested (`routers/api.test.ts:178-197`).
- No `any` casts, no TODO/FIXME debris, no copy-paste route handlers; the shared `spawnIfFull` flow is properly factored out of the three routes that use it.

## Findings

### [SEVERITY: High] Lobby store non-claim transitions race the atomic seat claim (lost updates)

- `apps/api/src/lobby/store.ts:205-219` (`releaseSeat`), `store.ts:221-233` (`markSpawning`), `store.ts:235-243` (`markLive`), `store.ts:245-254` (`rollbackToOpen`) are all plain read → mutate → `SET` sequences against the same Redis key the Lua `CLAIM_SCRIPT` (`store.ts:84-97`) mutates atomically.
- The doc comment (`store.ts:16-19`) asserts "every other transition is driven by the single caller who atomically filled the last seat" — but `releaseSeat` is driven by *any* seated player at *any* time. Concrete race: p3's `joinSeat` claim commits via Lua; p2's concurrent `leaveTable` read the pre-claim table and writes it back → p3's committed seat silently vanishes even though p3 received a success response. A leave racing `markSpawning` can likewise resurrect an `open` status on a table that is mid-spawn.
- `releaseSeat` also ignores `table.status` entirely (`store.ts:205-219`): leaving a `spawning`/`live` table rewrites its seats, and calling it while not seated "succeeds" with a version bump instead of a conflict.
- **Fix**: move `releaseSeat` (and ideally the status transitions) into Lua scripts following the existing `CLAIM_SCRIPT`/`applyClaim` mirror pattern, or add an optimistic version check (`WATCH`-equivalent: script that compares `version` before writing). Have `releaseSeat` reject non-`open` tables and non-seated callers with typed reasons.

### [SEVERITY: Medium] apps/bots is a vestigial deployed stub that doesn't contain the bots

- `apps/bots/src/index.ts:12-27`: `main()` validates env, constructs db/redis clients, logs three lines, and returns — the process exits immediately. There is no loop, no queue consumer, no server.
- It does not depend on `@meldrank/bots` (`apps/bots/package.json:13-16` lists only engine + shared); the actual bot logic in `packages/bots` runs in-process inside the match service (`apps/match/src/colyseus/matchRoom.ts`). The name collision (`@meldrank/bots-worker` vs `@meldrank/bots`) invites confusion.
- Yet it is a full Fly app: `apps/bots/Dockerfile`, `apps/bots/fly.toml` (512MB VM), and CD wiring at `.github/workflows/deploy.yml:81` — every change to `@meldrank/shared` or `@meldrank/engine` triggers a Docker build and deploy of a process that immediately exits (stopped machine or restart-loop depending on Fly's restart policy).
- **Fix**: decide explicitly. If a standalone bot worker is on the roadmap soon, keep the shell but remove it from the deploy matrix until it does something. If bots stay in-process with match (the current reality), delete `apps/bots` and destroy the Fly app; resurrecting a 31-line shell later is cheap. Either way, stop paying the CI/deploy cost now.

### [SEVERITY: Medium] Spawn HTTP call has no timeout — tables can strand in `spawning`

- `apps/api/src/spawn/client.ts:40-48`: the `fetch` to the match service's `/internal/rooms` has no `AbortSignal`/timeout. A hung (not failed) match service — plausible given documented Fly cold starts — blocks the request indefinitely and the table sits in `spawning`.
- While in `spawning`, the table is out of `lobby:open` (`store.ts:231`) and rejects all claims and re-spawn attempts (`spawn-flow.ts:42-45`), with no recovery path until the 1h Redis TTL (`store.ts:73`) evicts it. The same stuck state occurs if the API process dies between `markSpawning` (`spawn-flow.ts:42`) and `rollbackToOpen` (`spawn-flow.ts:54`).
- **Fix**: pass `AbortSignal.timeout(~10_000)` in the fetch options (S). For crash resilience, stamp `spawningAt` on the table and let `getTable`/`listOpen` treat an over-age `spawning` table as rollback-eligible.

### [SEVERITY: Medium] Clerk token verification edge (`identity.ts`) has zero tests — and a comment claims otherwise

- `apps/api/src/routers/api.test.ts:110` says "The identity edge itself is covered in `identity.test.ts`" — no such file exists anywhere in the repo. `bearerToken` parsing (`identity.ts:30-36`), `deriveDisplayNameFromClaims` (`identity.ts:44-52`), and `createClerkAuth`'s null-on-invalid behavior (`identity.ts:59-78`) are untested. This is the security-critical seam of the service.
- The catch-all `catch { return null; }` at `identity.ts:72-75` also swallows *every* failure (including e.g. network errors reaching Clerk's JWKS) as "unauthenticated" with no log line, making auth outages indistinguishable from bad tokens.
- **Fix**: add `identity.test.ts` covering `bearerToken` edge cases and the verifier (inject/mock `verifyToken`); log verification failures at `debug`/`warn` with an error class so operational failures are visible.

### [SEVERITY: Medium] `user.deleted` webhook events are ignored — deleted Clerk users are never anonymized

- `apps/api/src/webhook.ts:84` handles only `user.created`/`user.updated`. A Clerk-side deletion leaves the `players` row `active` with the stale display name/avatar forever, and the 30-day Redis identity cache (`players.ts:86`) keeps resolving. (Access itself is revoked at the token layer, so this is data hygiene, not an auth hole.)
- The schema already anticipates this: `player_status` has an `anonymized` value (`drizzle/0000_omniscient_valeria_richards.sql`, `players.ts` schema) that nothing ever sets.
- **Fix**: handle `user.deleted` by setting `status = 'anonymized'`, scrubbing `display_name`/`avatar`, and deleting the Redis cache key.

### [SEVERITY: Medium] Missing FK/uniqueness indexes in the initial migration

- `drizzle/0000_omniscient_valeria_richards.sql` creates only three indexes (`players_clerk_user_id_key`, `matches_completed_at_idx`, `abandon_events_player_id_idx`). No index on `match_participants.match_id`, `match_participants.player_id`, `match_hands.match_id`, `match_hand_lines.match_hand_id`, or `abandon_events.match_id` — every "history for player X" / "hands for match Y" query will seq-scan as data grows. Schema source: `packages/shared/src/server/db/schema/` (only `abandon.ts:25` and `matches.ts:27` define indexes).
- Also missing natural uniqueness guards: `match_participants (match_id, seat_index)` and `match_hands (match_id, hand_number)` — a double-write bug would silently duplicate rows.
- **Fix**: one additive migration with the five FK indexes plus the two composite unique indexes. Cheap now, painful later. Migration hygiene otherwise fine (single squashed 0000, journal + snapshot present in `drizzle/meta/`).

### [SEVERITY: Medium] Production images run `tsx` over the full unpruned workspace

- `apps/api/Dockerfile` and `apps/bots/Dockerfile:13-23`: the runtime stage copies the *entire* workspace with a full `pnpm install` (dev dependencies included — vitest, eslint, typescript all ship to prod) and starts via `tsx src/index.ts` (`apps/api/package.json:10`). No build/prune stage, no `pnpm deploy --prod`.
- This inflates image size and cold-start time — which directly matters because the API scales to zero (`apps/api/fly.toml:22-24`) and Fly cold starts are already a known pain point for this deployment.
- **Fix**: add a `tsc` (or esbuild) build step and a `pnpm deploy --prod --filter @meldrank/api` prune stage; run `node dist/index.js`.

### [SEVERITY: Low] Display-name derivation duplicated between token edge and webhook

- `apps/api/src/identity.ts:44-52` (`deriveDisplayNameFromClaims`) and `apps/api/src/webhook.ts:44-53` (`deriveDisplayNameFromUser`) implement the same D7 fallback chain (username → first+last → `Player <id-suffix>`) twice with slightly different code. A future change to the fallback rule will be applied to one and missed in the other.
- **Fix**: extract one `deriveDisplayName({ username, firstName, lastName, id })` helper (the two call sites just adapt field names).

### [SEVERITY: Low] Error-taxonomy inconsistency in the spawn flow

- `apps/api/src/lobby/spawn-flow.ts:44` throws a raw `TRPCError({ code: 'CONFLICT' })` while every router conflict uses `apiError('conflict')` (e.g. `routers/casual.ts:57`), so this one path lacks the `apiErrorCode` field clients/tests key on. Same for the raw `INTERNAL_SERVER_ERROR`s at `spawn-flow.ts:55,60` and `routers/casual.ts:105,112,118` (intentional per the comment for 500s, but the CONFLICT is a plain inconsistency).
- **Fix**: change `spawn-flow.ts:44` to `apiError('conflict', ...)`.

### [SEVERITY: Low] `listOpenTables` does N+1 Upstash round-trips

- `apps/api/src/lobby/store.ts:176-192`: `SMEMBERS` then one `GET` per table id, sequentially awaited in a loop — over Upstash's HTTP REST transport each iteration is a network round trip, and pagination filtering happens *after* fetching everything. Fine at MVP scale; degrades linearly with open-table count.
- **Fix**: `MGET` all table keys in one call (or `Promise.all`), and note the cursor model already tolerates it.

### [SEVERITY: Low] Webhook body read is unbounded

- `apps/api/src/webhook.ts:96-103` buffers the entire request body into memory before signature verification, with no size cap. Anyone who discovers the public path can POST arbitrarily large bodies; verification only rejects *after* full buffering.
- **Fix**: reject bodies over a small cap (e.g. 256KB) inside `readRawBody` by tracking accumulated length and destroying the request.

### [SEVERITY: Low] Doc-comment drift: references to a removed second "serverless" serving entry

- `apps/api/src/cors.ts:5-6` ("the serverless function reflects the same map onto its `Response`"), `cors.ts:13-15` ("both paths"), `src/context.ts:37` ("Both serving entries call this exactly once"), `src/context.ts:60-61` ("Both entries") — there is exactly one serving entry (`index.ts`). Comments describe an architecture that no longer exists, which misleads future maintenance (human or agent).
- **Fix**: sweep the stale comments (S). While there: the CORS `Access-Control-Allow-Headers` (`cors.ts:22`) omits `x-meldrank-trace-id` even though `buildContext` (`context.ts:66-71`) explicitly supports an inbound browser-supplied trace header — add it when/if the web client starts sending one.

### [SEVERITY: Low] No graceful shutdown

- `apps/api/src/index.ts:60`: `server.listen(port)` with no SIGTERM/SIGINT handler. Fly sends SIGTERM on `auto_stop_machines = "stop"` (`fly.toml:23`), so in-flight requests are dropped on every idle stop.
- **Fix**: `process.on('SIGTERM', () => server.close(...))` with a short drain timeout.

## Test coverage assessment

Good shape for the surface that exists, with one hole. Three test files, all fast in-process unit/behavior tests via `createCaller` and fakes:

- `apps/api/src/routers/api.test.ts` (300 lines) — router behavior: auth rejection, seat-claim race (single winner), spawn-failure rollback, ticket minting only on spawn, `getActive` incl. real HMAC verification, pagination smoke. The `FakeRedis.eval` mirrors the Lua script via the exported `applyClaim`, which keeps the atomic path honest.
- `apps/api/src/webhook.test.ts` — signature verification exercised with the real svix library (sign + verify round trip), tamper/missing-header rejection, non-user-event pass-through.
- `apps/api/src/players.test.ts` — resolver: lazy create, cache short-circuit, concurrent convergence, webhook refresh.

Gaps: `identity.ts` untested (see Medium finding — the comment pointing at a nonexistent `identity.test.ts` suggests it was planned and dropped); no tests for `createHttpSpawnClient` (URL building, non-2xx throw, header propagation), the webhook Node HTTP adapter (`handleClerkWebhookRequest`), `buildContext` trace-id logic, or CORS middleware; no test for the `releaseSeat`-vs-claim race (unsurprising, since it's a real bug). `apps/bots` has no tests, which is fine — there is nothing to test.

## Recommended action plan

Quick wins (do in one pass):

1. **(S)** Add `AbortSignal.timeout` to the spawn fetch — `spawn/client.ts:40`.
2. **(S)** `apiError('conflict')` in `spawn-flow.ts:44`; sweep stale "both entries/serverless" comments in `cors.ts`/`context.ts`.
3. **(S)** Cap the webhook body size in `webhook.ts:96-103`; add SIGTERM handling in `index.ts`.
4. **(S)** Write `identity.test.ts` (bearer parsing, claims fallback, invalid-token → null) and log verification failures instead of silently swallowing.
5. **(S)** Remove `apps/bots` from the deploy matrix (`.github/workflows/deploy.yml:81`) pending the keep/delete decision below.
6. **(S)** Extract the shared display-name derivation helper used by `identity.ts` and `webhook.ts`.

Bigger items:

7. **(M)** Make `releaseSeat` (and status transitions) atomic — Lua scripts with the existing pure-mirror pattern, plus status/occupancy guards and a race regression test. Highest-value correctness fix in this scope.
8. **(M)** Additive migration: FK indexes on `match_participants(match_id)`, `match_participants(player_id)`, `match_hands(match_id)`, `match_hand_lines(match_hand_id)`, `abandon_events(match_id)`; unique `(match_id, seat_index)` and `(match_id, hand_number)`.
9. **(M)** Handle `user.deleted` in the webhook (anonymize + cache invalidation), using the existing `anonymized` status.
10. **(M)** Compile + prune the production Docker images (both apps if `apps/bots` survives); run `node dist/` instead of `tsx src/`.
11. **(S/M)** Decide `apps/bots`' fate: delete it (bot logic lives in `apps/match` via `packages/bots`) or give it a real long-lived entry when standalone bot scheduling lands. Also consider renaming `@meldrank/bots-worker` vs `@meldrank/bots` to remove the near-collision.
12. **(S)** Batch `listOpenTables` reads with `MGET` when lobby traffic grows.
