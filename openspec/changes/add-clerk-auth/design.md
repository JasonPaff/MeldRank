## Context

Identity is stubbed today (design D5; Auth & Identity). The API resolves `ctx.playerId`
through one seam — `resolveStubIdentity` in `apps/api/src/identity.ts` — which reads an
`x-stub-player-id` header or defaults to `'stub-player'`. The web client sends no identity.
The system was built so this is a single-seam swap:

- `players` already carries `clerk_user_id` (nullable, partial-unique, biconditional check
  `type='human' ⟺ clerk_user_id IS NOT NULL`).
- `CLERK_SECRET_KEY` (api) and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (web, optional) are
  already declared; `.env.example` has placeholders.
- `apps/match` receives identity only inside the HMAC seat ticket; it never reads identity
  from a request, so it is outside the auth path entirely.
- The match persistence writer is deliberately player-FK-free (`match_participants` /
  `abandon_events` are untouched), so no `players.id` is written today — which is why the
  literal `'stub-player'` string works without a `players` row.

Deployment topology matters: `apps/web` is on Vercel and `apps/api` on Fly — a cross-origin
boundary. The API already CORS-allowlists the single `WEB_APP_ORIGIN`.

This change replaces the placeholders with the locked Clerk implementation. Decisions were
settled in exploration: internal-UUID `playerId`, webhook + lazy resolve-or-create,
Bearer-token transport, FK-free writer retained.

## Goals / Non-Goals

**Goals:**

- Authenticate the API caller from a Clerk Bearer session and resolve to an internal
  `players.id` UUID, exposed unchanged as `ctx.playerId`.
- Sync `players` rows from Clerk via webhook, with a lazy resolve-or-create fallback.
- Wire Clerk into the web client: provider, route protection, auth surfaces, and Bearer
  token attachment on tRPC calls.
- Keep the swap confined to the web client and the API identity edge; leave `apps/match`,
  the seat-ticket contract, and every procedure body unchanged.

**Non-Goals:**

- Writing `match_participants` / `abandon_events` (the writer stays FK-free — a later change).
- Seeding `players` rows for bots (only needed once seats are persisted with FKs).
- A real onboarding flow / display-name editor (onboarding stays reported complete;
  display name is Clerk-derived).
- Any organizations / billing / roles surface.
- Changing `apps/match`, the HMAC seat ticket, or any tRPC procedure body.

## Decisions

### D1: `playerId` is the internal `players.id` UUID, not the Clerk user id

`ctx.playerId` and `SeatTicket.playerId` carry the internal UUID. Identity resolution turns
the Clerk user id into a `players.id` on every authenticated request.

- **Why:** decouples the domain from Clerk's id format; gives humans and bots one id space
  (bots already hold UUIDs with null `clerk_user_id`); keeps the door open to persist
  participants by FK later without a second id scheme.
- **Alternative (rejected):** `playerId` = Clerk id string. Zero hot-path lookup, but
  couples the lobby store, seat ticket, and every future FK to Clerk, and forces a parallel
  id scheme for bots that doesn't match humans.
- **Cost:** a lookup per authenticated request, mitigated by D3.

### D2: Resolve-or-create unifies the webhook and the lazy path

Identity resolution is one operation — "find the `players` row for this Clerk id, or create
it" — reached from two directions:

```
Clerk ──user.created/updated──► POST /api/webhooks/clerk ─► UPSERT players (authoritative)
                                                                 │ pre-warms
request (Bearer) ─► verify ─► clerkUserId ─► cache ─► DB ─► [miss] INSERT ... ON CONFLICT
                                                                 (clerk_user_id) RETURNING id
```

The webhook is authoritative and keeps `display_name`/`avatar` fresh; the request-time
create is the fallback for the race where a request beats the webhook. The create is a
single statement: `INSERT INTO players (type, clerk_user_id, display_name) VALUES ('human',
$1, $2) ON CONFLICT (clerk_user_id) DO UPDATE SET ... RETURNING id`. This is concurrency-safe
against the partial-unique index (two concurrent first requests converge on one row, both
get the same id) and needs no interactive transaction — matching the Neon HTTP-driver
constraint the persistence writer already works around.

- **Why both:** webhook alone has a cold-start race (first request before first webhook);
  lazy alone re-derives `display_name` from the token and misses profile updates. Together
  the webhook is the steady-state truth and lazy is self-healing.

### D3: `clerk_user_id → players.id` is Redis-cached

Resolution checks a Redis key first (Redis is already constructed in the API runtime). Hit
returns the UUID with no DB read; miss falls through to the resolve-or-create and writes the
mapping back. The mapping is immutable for a user's lifetime, so the cache needs no
invalidation in the steady state (a long TTL is sufficient).

- **Alternative considered:** per-instance LRU. Rejected as the primary store (Fly runs
  multiple instances, each would cold-cache), though an in-process layer above Redis is a
  cheap future optimization.

### D4: Bearer-token transport across the Vercel↔Fly boundary

The web client attaches `Authorization: Bearer <getToken()>` on the tRPC `httpBatchLink`;
the API verifies with `@clerk/backend` (`authenticateRequest` / `verifyToken`) against
`CLERK_SECRET_KEY`. The API CORS config adds `Authorization` to allowed headers
(`WEB_APP_ORIGIN` is already allowlisted).

- **Why not the `__session` cookie:** the web and API are different registrable domains
  (`*.vercel.app` ↔ `*.fly.dev`), so a Clerk cookie is third-party — blocked by browsers and
  awkward with CORS credentials. Bearer is the standard pattern for a separate API host.
- **Wiring note:** the tRPC client is constructed once in `useState` inside `Providers`, so
  the link's `headers` callback cannot call the `useAuth()` hook directly. It reads the
  token imperatively (`window.Clerk?.session?.getToken()`) at request time, with
  `ClerkProvider` mounted outermost so the Clerk singleton exists before any call.

### D5: `apps/match` stays out of the auth path; the writer stays FK-free

The match service is untouched: identity arrives only inside the HMAC seat ticket the API
mints after authenticating the caller. No `@clerk/*` dependency enters `apps/match`, and the
seat-ticket shape and `onAuth` verification are unchanged. The persistence writer keeps its
FK-free form, so this change introduces no `players.id` write outside the identity edge.

- **Why:** preserves the clean boundary the original design earned and keeps the blast radius
  to web + API identity edge + one webhook route.

### D6: The API gains a player-resolver dependency

`buildContext(deps, source)` currently sees only `deps` + headers; `db`/`redis` live in
`ApiRuntime` but not in `ApiDeps`. Resolve-or-create needs both. `ApiDeps` gains a `players`
resolver (wrapping the DB query + the Redis cache + the create), constructed once in
`createApiRuntime` and injected like the other deps. The webhook handler reuses the same
resolver's upsert. Both serving entries (standalone `.listen()` and the Vercel function)
route through `buildContext` and mount the webhook route, so neither path drifts.

- **Why a resolver dep, not a raw `db` in context:** keeps the identity logic testable in
  isolation and mirrors the existing dependency-injection shape (`store`, `tickets`, `spawn`).

### D7: `display_name` derivation; onboarding stays complete

On create/upsert, `display_name` is derived from the Clerk user: `username` → `firstName`
(+`lastName`) → a stable fallback. `getMe` continues to report `onboardingComplete: true`.
A real onboarding/name-edit flow is a later change.

## Risks / Trade-offs

- **Lazy-create race under concurrency** → the single `ON CONFLICT (clerk_user_id) ...
  RETURNING id` statement makes both racers converge on one row and id; the partial-unique
  index is the guard. No interactive transaction needed.
- **Token unavailable at client-construction time** → the link reads `getToken()`
  imperatively per request (not at `useState` time), with `ClerkProvider` outermost, so a
  freshly-signed-in session is picked up without rebuilding the client.
- **Webhook lag on a brand-new user** → covered by the lazy create; the later webhook upsert
  reconciles `display_name`/`avatar`. No request is blocked waiting on the webhook.
- **CORS regression** → the only CORS change is adding the `Authorization` allowed header;
  the allowlisted origin is unchanged. A missed preflight surfaces immediately in dev.
- **`apps/match` accidentally pulled into auth** → guarded by D5: no `@clerk/*` dep added to
  match, seat-ticket contract untouched; the integration seam tests already exercise the
  ticket path.
- **Required-key flip breaks an unconfigured environment** → the Clerk keys become required;
  `.env.example` placeholders + `pnpm env:check` keep the contract visible, and fail-fast
  loading names a missing key at boot rather than failing obscurely at runtime.

## Migration Plan

1. Provision the Clerk instance; set `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` (api) and
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (web) in each environment; register the webhook
   endpoint URL in the Clerk dashboard.
2. Ship the API edge (resolver + Bearer verification + webhook route + CORS header) and the
   web client (provider, middleware, auth surfaces, Bearer link) together — the web cannot
   authenticate against an API still on the stub, and vice versa.
3. No data migration: `players.clerk_user_id` already exists; rows are created on first
   sign-in / first webhook.
4. **Rollback:** revert the change set. Because no schema change and no new `players.id`
   writes outside the identity edge are introduced, rollback restores the stub seam cleanly;
   any rows created during the window are harmless (orphan-free, FK-free).

## Open Questions

- Should any procedure be public (signed-out), e.g. `variant.list` / `listOpenTables`, or do
  all routes require auth for the MVP? (Current assumption: all player-scoped procedures
  require auth; read-only reference procedures can be revisited if a signed-out landing view
  is wanted.)
- Exact `display_name` fallback ordering and uniqueness handling (Clerk usernames may be
  absent) — to confirm at implementation against the Clerk user shape.
