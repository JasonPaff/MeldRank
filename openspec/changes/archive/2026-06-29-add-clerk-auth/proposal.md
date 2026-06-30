## Why

Identity is currently a stub: the API derives `ctx.playerId` from an `x-stub-player-id`
header (defaulting every caller to a single `stub-player`), and the web client sends no
identity at all. The architecture was deliberately built so this swap touches one seam
(design D5; Auth & Identity). With the walking skeleton live and smoke-verified, real
authentication is the gating prerequisite for everything player-scoped — distinct seats,
durable participant identity, profiles, and the ranked ladder. This change replaces the
placeholders with the locked Clerk implementation.

## What Changes

- Replace the centralized stub-identity seam (`apps/api/src/identity.ts`) with real Clerk
  verification: the API authenticates a Bearer session token and resolves the Clerk user
  to an internal `players.id` UUID (**resolve-or-create**), which becomes `ctx.playerId`.
- `ctx.playerId` and `SeatTicket.playerId` carry the internal `players.id` UUID (not the
  Clerk user id). Every downstream consumer (lobby seats, seat ticket, match `onAuth`)
  already treats it as an opaque string — the value changes, the contracts do not.
- Add a Clerk webhook endpoint (`POST /api/webhooks/clerk`) that verifies `svix`
  signatures and upserts `players` rows on `user.created`/`user.updated`. The webhook is
  the authoritative sync; the API's resolve-or-create is the lazy fallback for the race
  where a request arrives before the webhook lands. `display_name` is derived from Clerk
  (username → first name → fallback); onboarding remains reported complete (no onboarding
  UI this change).
- Web client: mount `ClerkProvider`, add sign-in / sign-up routes and a sign-out
  affordance, protect the lobby and table routes via `clerkMiddleware`, and attach the
  Clerk session token as a `Bearer` Authorization header on the tRPC `httpBatchLink`.
- The API CORS allowlist gains the `Authorization` header (the web origin is already
  allowlisted).
- `apps/match` is **unchanged**: identity reaches it inside the HMAC seat ticket, which
  is minted only after the API has authenticated the caller. The match persistence writer
  stays player-FK-free (`match_participants`/`abandon_events` remain a later change).

## Capabilities

### New Capabilities
- `auth-identity`: The authentication and identity-resolution contract — Bearer session
  verification at the API edge, Clerk-user-to-`players.id` resolve-or-create (Redis-cached),
  the Clerk webhook sync of `players` rows, and the rule that an unauthenticated
  player-scoped request is rejected.

### Modified Capabilities
- `account-and-reference-api`: `getMe` resolves the real authenticated caller and returns
  the Clerk-derived display identity; onboarding stays reported complete.
- `web-client-foundation`: the client requires a Clerk session — `ClerkProvider`, route
  protection, sign-in/up surfaces, and Bearer-token attachment on API calls.
- `environment-config`: the Clerk keys become required for `apps/api`/`apps/web`, and a
  new `CLERK_WEBHOOK_SECRET` is added to the API environment contract.

## Impact

- **apps/api**: `identity.ts` / `buildContext` (stub → Clerk verify + resolve-or-create);
  `ApiDeps` gains a player resolver with DB + Redis-cache access; new public webhook route
  mounted in both serving entries (standalone `.listen()` and the Vercel function); CORS
  allowed-headers; `apiEnv` gains `CLERK_WEBHOOK_SECRET`.
- **apps/web**: `layout.tsx` / `providers.tsx` (ClerkProvider above the tRPC client, Bearer
  header on the link); new `middleware.ts`; sign-in/up routes; required publishable key.
- **packages/shared**: `SeatTicket.playerId` doc note (now a real UUID); env schemas
  (`apiEnv`, `webEnv`) for the Clerk variables.
- **apps/match**: none.
- **Dependencies**: `@clerk/nextjs` (web), `@clerk/backend` and `svix` (api), latest stable.
- **`.env.example`**: `CLERK_WEBHOOK_SECRET` added; Clerk key placeholders documented as
  required.
