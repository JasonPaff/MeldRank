## Context

F0 (`add-web-client-scaffold`, archived) wired `apps/web`'s foundation: a typed tRPC
client on the TanStack Query proxy targeting `NEXT_PUBLIC_API_URL`, a shared
`QueryClient`, the Zustand session store (`playerId` placeholder + setter), a
configured-but-unconnected `colyseus.js` client, and the root provider tree. The API
(unit D, `add-api-and-contracts`) already serves the casual procedures this slice
calls — `account.getMe`, `casual.quickPlay`, `match.getActive` — over a standalone
tRPC HTTP server (`createHTTPServer`) with stub identity. The wire contracts live in
`@meldrank/shared` (`CasualQuickPlayOutput` = `{ table, ticket }`, `ActiveMatch` =
`{ roomId, seat, variantId } | null`).

Two gaps block a browser playing the happy path: (1) the API has no CORS, so the
cross-origin browser call fails at preflight (flagged in F0's design); (2) the web
app has no lobby — `app/page.tsx` is a no-network placeholder. This change closes
both, scoped to the **minimal happy path** (Quick Play + active-match rejoin),
deferring create/list/join/add-bot screens and all room rendering. Constraints: the
locked stack and latest-stable dependency policy (Technical Architecture §7); no new
client libraries beyond F0; identity stays stubbed (Clerk is unit E).

## Goals / Non-Goals

**Goals:**

- Prove the Client↔API tRPC seam from a real browser end-to-end (preflight → `getMe`
  → `quickPlay` → navigate), the highest remaining integration risk.
- Produce the lobby→table handoff (seat ticket + match handle in the session store)
  that F2's table UI consumes, with a clean F1/F2 boundary.
- Land the CORS prerequisite as a small, isolated transport change on the API.

**Non-Goals:**

- Create / list / join / leave / add-bot lobby screens (later F1 pass — pure UI over
  existing procedures).
- Any Colyseus room join, per-seat view rendering, intent loop, clocks, or
  reconnect/resync — **F2**.
- Real auth, auth middleware, or credentialed sessions — unit E.
- Production CORS hardening beyond a single configured origin (no wildcard, no
  multi-origin allowlist this slice).

## Decisions

### CORS at the standalone HTTP server, configured by `WEB_APP_ORIGIN`

The API runs `@trpc/server/adapters/standalone`'s `createHTTPServer`, which exposes a
`middleware` option (a Node `(req, res, next)` handler) that runs before the tRPC
handler. CORS lands there: reflect/allow the single `WEB_APP_ORIGIN`, allow the tRPC
methods (`GET`, `POST`, `OPTIONS`) and the `content-type`/`authorization`/tRPC batch
headers, and short-circuit the `OPTIONS` preflight with `204`. The origin is a new
`WEB_APP_ORIGIN` key on `apiEnv` (`packages/shared/src/server/env/schema.ts`),
`.env.example`, and the `pnpm env:check` example — never hardcoded.

- **Why a single configured origin, not `*`:** the app sends identity headers (and
  Clerk credentials later); a wildcard is incompatible with credentialed requests and
  is the wrong default for a real deploy. One env-driven origin is the minimal correct
  shape and extends to an allowlist later without a contract change.
- **Why the adapter `middleware` over a separate proxy/server:** keeps CORS in the one
  place the server boots, no extra process, no framework. The `cors` npm package (or a
  tiny hand-rolled handler) plugs straight into `middleware`; choose whichever is
  latest-stable and smallest at apply time.
- **Alternative considered — front the API with Next.js route handlers / rewrites:**
  rejected; it collapses the cross-origin seam the MVP is specifically trying to light
  (API is a distinct Vercel deploy at `NEXT_PUBLIC_API_URL`) and hides a real deploy
  concern behind same-origin dev convenience.

### Lobby as a client route calling procedures via the TanStack Query proxy

The lobby replaces `app/page.tsx`. It reads data with `useQuery(trpc.account.getMe
.queryOptions())` and `useQuery(trpc.match.getActive.queryOptions())`, and acts with
`useMutation(trpc.casual.quickPlay.mutationOptions())` — the F0 proxy, no new client
wiring. Loading/error/empty states come from the query/mutation status flags. The
mutation's `isPending` gates the Quick Play button against double-submit.

- **Why call sites here, not a server component:** the tRPC client is the `'use
client'` browser client (the whole point is to exercise the browser seam incl.
  CORS); these are interactive, identity-scoped reads, not SSR data. Keep the lobby a
  client component under the F0 provider tree.

### Navigation + handoff: stash in the store, route by `roomId`

On a successful `quickPlay`/rejoin, write `{ ticket, roomId, seat, variantId }` into
the Zustand session store, then `useRouter().push('/table/' + roomId)`. The table
route (`app/table/[roomId]/page.tsx`) is an explicit F1 stub: it reads the handle
from the store and renders a "connecting… (table UI lands in F2)" placeholder,
joining no room.

- **Why the store carries the ticket, not the URL:** the signed seat ticket is a
  bearer credential for `onAuth` — it does not belong in a shareable/loggable URL.
  `roomId` in the path is fine (it's a public room handle); the ticket rides in
  client memory for F2 to present on `joinById`.
- **Why a stub table route now:** it closes the navigation loop and fixes the F1/F2
  seam so F2 is "fill the placeholder," not "invent the entry." `match.getActive`
  already returns enough to rebuild the handle on a cold load, so the in-memory stash
  is a convenience, not the only source of truth.
- **Active-match-on-load:** surface an explicit **Rejoin** affordance rather than
  auto-redirecting. Auto-redirect on every lobby visit is surprising and traps a user
  who wants to abandon; an explicit control is the safer default (revisit when
  abandonment UX lands).

### Session store extension shape

Add to `SessionState`: `seatTicket: SignedSeatTicket | null`, `activeMatch: { roomId,
seat, variantId } | null`, plus a single `setHandoff(...)` setter (and a `clear`).
Types reuse `@meldrank/shared` (`SignedSeatTicket`, `ActiveMatch`) so the store and
the wire agree. This is the F0-deferred "table-reconciliation fields" beginning,
narrowed to exactly what the handoff needs.

## Risks / Trade-offs

- **CORS misconfig silently blocks the whole seam** → the failure is a browser
  preflight error, easy to misread as a client bug. Mitigation: a task to verify the
  preflight (`OPTIONS`) and a real `getMe` from the browser against the configured
  origin; keep `WEB_APP_ORIGIN` in `env:check` so a missing/typo'd origin fails fast.
- **In-memory handoff lost on table-route refresh** → a hard refresh of
  `/table/[roomId]` drops the in-memory ticket. Acceptable in F1 (the route is a
  stub); F2 must rehydrate from `match.getActive` (which returns the handle) and
  re-mint/re-fetch the ticket path as needed. Noted so F2 doesn't assume the stash
  always survives.
- **Stub identity = no real per-user isolation** → all browsers share the stub
  `playerId`, so `getActive` can appear to "leak" a match across tabs. Expected under
  the stub; resolved by unit E (Clerk). Don't build UX that assumes true per-user
  identity yet.
- **Single-origin CORS** → won't cover preview deploys / multiple web origins. Trade
  accepted for the skeleton; widen to an allowlist when infra (unit H) brings up
  preview URLs.

## Open Questions

- Lobby route path: keep the lobby at `/` (replace the placeholder) or move it to
  `/lobby` and leave `/` as a marketing/redirect shell? Leaning `/` for the skeleton;
  cheap to change. (Resolve at apply time.)
- CORS implementation: the `cors` package vs. a ~10-line hand-rolled `middleware`
  handler — pick the latest-stable, smallest option when the work lands.
