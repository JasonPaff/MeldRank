## 1. Dependencies and environment contract

- [x] 1.1 Add `@clerk/backend` and `svix` to `apps/api`, and `@clerk/nextjs` to `apps/web`, at latest stable versions
- [x] 1.2 Add `CLERK_WEBHOOK_SECRET` (required) to the `apiEnv` schema in `@meldrank/shared/server`; confirm `CLERK_SECRET_KEY` stays required
- [x] 1.3 Make `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` required in the public `webEnv` schema (drop `.optional()`)
- [x] 1.4 Document `CLERK_WEBHOOK_SECRET` in `.env.example` and confirm the Clerk key placeholders; run `pnpm env:check` to verify agreement

## 2. API identity resolver (resolve-or-create + cache)

- [x] 2.1 Add a player resolver to the API deps: `clerk_user_id → players.id` with Redis-cache read-through, DB lookup, and `INSERT ... ON CONFLICT (clerk_user_id) DO UPDATE ... RETURNING id` create (Clerk-derived `display_name`)
- [x] 2.2 Construct the resolver in `createApiRuntime` (it needs `db` + `redis`) and add it to `ApiDeps` / `ApiContext` typing
- [x] 2.3 Replace `resolveStubIdentity` usage in `buildContext`: verify the Bearer session via `@clerk/backend` against `CLERK_SECRET_KEY`, resolve to internal `players.id`, set `ctx.playerId`; reject unauthenticated player-scoped calls with the typed `unauthorized` error
- [x] 2.4 Remove the stub seam (`identity.ts` `resolveStubIdentity`/`STUB_PLAYER_*`) and any now-dead references
- [x] 2.5 Update the `SeatTicket.playerId` doc comment in `@meldrank/shared` (real UUID, no longer a stub)

## 3. Clerk webhook sync

- [x] 3.1 Add a public `POST /api/webhooks/clerk` route that verifies the `svix` signature against `CLERK_WEBHOOK_SECRET` (reject missing/invalid signatures with no mutation)
- [x] 3.2 On `user.created` / `user.updated`, upsert the `human` `players` row via the shared resolver (Clerk-derived `display_name`/`avatar`); ensure the route bypasses the Bearer identity edge
- [x] 3.3 Mount the webhook route in the standalone `.listen()` serving entry (the only entry; the Vercel function was removed when the API moved to Fly); `Authorization` is already in the API CORS allowed headers

## 4. Web client Clerk integration

- [x] 4.1 Add `ClerkProvider` (from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) outermost in the provider tree so it wraps the tRPC client
- [x] 4.2 Attach the Clerk session token as an `Authorization: Bearer` header on the tRPC `httpBatchLink`, reading the token imperatively per request (e.g. `window.Clerk?.session?.getToken()`)
- [x] 4.3 Add `middleware.ts` with `clerkMiddleware` protecting the lobby and table routes; keep sign-in / sign-up public
- [x] 4.4 Add sign-in and sign-up surfaces and a sign-out affordance

## 5. Verification

- [x] 5.1 Add/adjust API tests: authenticated resolve-or-create (existing + new user), concurrent first-request convergence, cache hit path, unauthenticated rejection, webhook upsert + signature rejection
- [x] 5.2 Confirm `apps/match` is untouched — no `@clerk/*` dependency, seat-ticket and `onAuth` tests still green
- [x] 5.3 Run the validate agent (lint, typecheck, test) and resolve any failures
- [ ] 5.4 Manual smoke: sign in on web → lobby/quick-play → seat ticket mints with a UUID `playerId` → table joins; unauthenticated visit redirects to sign-in
