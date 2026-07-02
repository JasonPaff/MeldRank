# Audit: Cross-cutting duplication & code reuse

## Summary

Overall the monorepo is in unusually good shape for duplication: the `@meldrank/shared` package genuinely is the single source of truth for the variant schema, intents, seat tickets, the spawn seam, env parsing, and the DB projection, and all tsconfigs/eslint extend a single root config. The one significant hole is the **Client↔Match Colyseus wire protocol**: every message name is a raw string literal typed independently in `apps/match` and `apps/web`, and every payload shape is hand-written twice (web-side interfaces vs. server-side ad-hoc object literals), with no shared constants, no shared types, and no runtime validation — the highest-drift-risk seam in the system. Second tier: `apps/match` re-implements three engine deal-orchestration functions near-verbatim (documented, but a rules change will drift them), and the variantId→variant lookup is duplicated between the API catalog and a hardcoded ternary in the match room that silently defaults unknown ids to Partners. The rest is small web-app-local duplication (suit glyph maps, page-shell Tailwind clusters, zustand provider boilerplate) and triplicated Dockerfiles.

## Findings

### [SEVERITY: High] Colyseus wire protocol (message names + payload types) duplicated between apps/match and apps/web with no shared contract

The entire realtime message contract exists twice, connected only by string literals and structurally-hoped-compatible hand-written types. `packages/shared` — which owns every *other* wire contract (tRPC I/O, spawn seam, result event) — has nothing for this seam.

**Message-name string literals (8 names, every one duplicated):**

| Message | Server site | Client site |
|---|---|---|
| `intent` | `apps/match/src/colyseus/matchRoom.ts:192` | `apps/web/lib/use-table-connection.ts:309` |
| `contribute` | `apps/match/src/colyseus/matchRoom.ts:195` | `apps/web/lib/use-table-connection.ts:174` |
| `view` | `apps/match/src/colyseus/matchRoom.ts:440` | `apps/web/lib/use-table-connection.ts:152` |
| `commit` | `apps/match/src/colyseus/matchRoom.ts:443` | `apps/web/lib/use-table-connection.ts:170` |
| `accept` | `apps/match/src/colyseus/matchRoom.ts:446` | `apps/web/lib/use-table-connection.ts:157` |
| `reject` | `apps/match/src/colyseus/matchRoom.ts:449` | `apps/web/lib/use-table-connection.ts:163` |
| `rejectContribution` | `apps/match/src/colyseus/matchRoom.ts:452` | `apps/web/lib/use-table-connection.ts:180` |
| `clockState` | `apps/match/src/colyseus/matchRoom.ts:455` | `apps/web/lib/use-table-connection.ts:177` |

**Payload shapes written twice:**

- `AcceptMessage` / `RejectMessage` / `CommitMessage` — hand-written client interfaces at `apps/web/lib/use-table-connection.ts:35-49`; the server builds the same shapes as untyped object literals at `apps/match/src/colyseus/matchRoom.ts:443-455` from the `Effect` union (`apps/match/src/room/types.ts:371-411`). Nothing ties them together — e.g. the server's `commit` sends `{ handNonce, commit }` and the client's `CommitMessage` declares both but only reads `handNonce`; renaming a field on either side compiles clean and breaks silently at runtime.
- `ClockStateSnapshot` (`apps/web/lib/table-store.tsx:30-34`) re-declares the server's `clockState` effect payload (`apps/match/src/room/types.ts:398-406`) including an inline re-write of `SeatClockSnapshot` (`apps/match/src/room/types.ts:114-116`) as `{ remainingBaseMs; remainingReserveMs; seat }`.
- `SyncedMetadata` (`apps/web/lib/use-table-connection.ts:52-58`) structurally mirrors the Colyseus `RoomMetadata` schema (`apps/match/src/colyseus/schema.ts:25-34`) field-for-field (`lifecycle`, `seatToAct`, `clockDeadline`, `occupancy`, `seatStatus`), plus a second plain-array mirror `SyncedMetadataSnapshot` at `apps/web/lib/table-store.tsx:76-87`.
- Inbound: `IntentMessage` / `ContributeMessage` are declared only server-side (`apps/match/src/colyseus/matchRoom.ts:47-55`) and the handlers cast the raw client payload with **no Zod validation** — a malformed client message reaches `RoomCore` unchecked, even though `PlayerIntent` already lives in shared as types-only awaiting "the matching Zod schemas … when that boundary is built" (`packages/shared/src/intent/types.ts:8-10`).

**Canonical home:** a new `packages/shared/src/match/wire.ts` (or `protocol.ts`): exported message-name constants (e.g. `MATCH_MSG = { view: 'view', ... } as const`), Zod schemas for the client→server payloads (`IntentMessage`, `ContributeMessage` — finally delivering the promised `PlayerIntent` schema), and shared types for the server→client payloads and the room-metadata snapshot. Both `matchRoom.ts` and `use-table-connection.ts`/`table-store.tsx` import from it; the match room validates inbound messages at the boundary.

### [SEVERITY: Medium] Engine deal orchestration re-implemented in apps/match (3 functions, near-verbatim)

`apps/match/src/room/deal.ts` copies three private functions from `packages/engine/src/state/reduce.ts` so the room can deal with the fairness layer's full-width `Rng` instead of the engine's 32-bit-seeded one (the header comment at `deal.ts:15-24` documents this deliberately):

- `nextActivePhase` — `apps/match/src/room/deal.ts:36-44` is **verbatim** `packages/engine/src/state/reduce.ts:524-532`.
- `dealHand` — `apps/match/src/room/deal.ts:70-83` duplicates `applyDeal` at `packages/engine/src/state/reduce.ts:98-114`; the only real difference is the rng source (`rng` param vs `createSeededRng(event.seed)`) and error-vs-no-op on a missing next phase.
- `nextHandBase` — `apps/match/src/room/deal.ts:53-61` duplicates `startNextHand` at `packages/engine/src/state/reduce.ts:472-484` (dealer rotation + scorePad/handsMadeAsBidder carry-over), minus the trailing `applyDeal` call.

Drift risk is concrete: any change to the engine's phase-advance rules, auction opening, or the set of hand-boundary-preserved fields (e.g. adding a new match-scope counter next to `handsMadeAsBidder`) must be re-made by hand in `apps/match` or live matches diverge from replay-fold semantics — the exact invariant the copy exists to protect.

**Canonical home:** `packages/engine`. Export an rng-injectable orchestration seam — e.g. `applyDealWithRng(state, rng)` and `startNextHandBase(state)` (or accept an `Rng` on the `deal` event) — and reduce `apps/match/src/room/deal.ts` to thin re-exports or delete it.

### [SEVERITY: Medium] variantId→variant resolution duplicated; match side silently defaults unknown ids

- API catalog: `apps/api/src/variants.ts:20-26` (`CANONICAL` list + `get(id)` returning `null` on miss, surfaced as a typed `not-found`).
- Match room: `apps/match/src/colyseus/matchRoom.ts:570-572` —
  ```ts
  return variantId === 'single-deck-cutthroat' ? SINGLE_DECK_CUTTHROAT : SINGLE_DECK_PARTNERS;
  ```
  Any unknown/new `variantId` silently becomes Partners.

Aggravating: the spawn request already carries the full frozen `variant` snapshot (`packages/shared/src/api/spawn.ts:31-38`, `variant: VariantDefinitionSchema`), but the gateway's `toCreateOptions` drops it on the floor (`apps/match/src/gateway/spawn.ts:77-79` forwards only `variantId`), forcing the room to re-derive via the hardcoded ternary. Adding a third variant to the API catalog would produce rooms that run the wrong ruleset with no error anywhere.

**Consolidation:** thread `request.variant` through `MatchCreateOptions` and have `onCreate` parse/use it (the schema is already shared), or export a `CANONICAL_VARIANTS_BY_ID` map from `packages/shared/src/variant` used by both sides — and in either case fail loudly on an unresolvable variant.

### [SEVERITY: Medium] Reconnect grace window (90 s) hardcoded independently in web

- Server authority: `DEFAULT_CLOCK_CONFIG.reconnectGraceMs: 90_000` at `apps/match/src/room/clock.ts:23` (consumed at `apps/match/src/room/core.ts:956` and `matchRoom.ts:279`).
- Client copy: `const GRACE_MS = 90_000` at `apps/web/lib/use-table-connection.ts:61`, bounding the reconnect retry loop (`use-table-connection.ts:214`). The comment ("the client need not know it exactly") acknowledges the copy.

If the server profile diverges (the config seam exists precisely so ranked/casual can diverge — `clock.ts:14-16`), the web client will give up reconnecting too early or uselessly retry past the server's window. **Consolidation:** export the default from `packages/shared` (it is plain data), or better, surface the room's actual `reconnectGraceMs` in the synced `RoomMetadata`/`clockState` payload so the client tracks the live config instead of any constant.

### [SEVERITY: Low] SUIT_GLYPH map and SUITS list duplicated (web ×2, engine, shared)

- `SUIT_GLYPH` written twice in the same app: `apps/web/components/table/card.tsx:16-21` and `apps/web/components/table/table-view.tsx:28`.
- The four-suit list as a literal three times: `apps/web/components/table/table-view.tsx:27`, `packages/engine/src/meld/meld.ts:25`, and `packages/shared/src/variant/canonical.ts:17` (`ALL_SUITS`, not exported). Note `packages/bots/src/brain.ts:90` does it right — it derives suits from `ctx.variant.deck.suits`.
- Related hardcode: `SEAT_COUNT = 4` at `apps/web/components/table/table-view.tsx:29` instead of deriving from metadata/variant — wrong the day a 2–3 player variant renders.

**Consolidation:** export `SUITS` (= `SuitSchema.options`) from `packages/shared/src/variant`; move `SUIT_GLYPH` to a single web module (e.g. `card.tsx` exporting it); derive seat count from `occupancy.length`/variant. Web's declare-trump buttons should ideally use the variant's `deck.suits` like the bot does.

### [SEVERITY: Low] Hex-encoding helper duplicated in web instead of reusing @meldrank/fairness

- Canonical: `toHex`/`fromHex` at `packages/fairness/src/encoding.ts:15-18` (isomorphic, explicitly the wire form for the fairness handshake; the match server uses them at `matchRoom.ts:7`).
- Copy: local `toHex` at `apps/web/lib/use-table-connection.ts:329-331` encoding the `contribute` clientSeed — the *other half of the same handshake*. `apps/web/package.json` lacks the `@meldrank/fairness` dep, which is presumably why it was re-written.

**Consolidation:** add `@meldrank/fairness` (isomorphic by design — the browser verifier is a stated consumer, `encoding.ts:6-8`) to web and import `toHex`; the client-side fair-deal verifier will need the package anyway.

### [SEVERITY: Low] Zustand store context/provider/hook boilerplate duplicated twice in web

- `apps/web/lib/store.tsx:42-60` and `apps/web/lib/table-store.tsx:191-235`: identical pattern — `createContext(null)`, lazy-`useState` provider, and a throwing `useXStore(selector)` hook (table-store adds a `useTableStoreApi` raw accessor). ~25 lines each, same error-message shape.

**Consolidation:** one generic `createStoreContext<TState>()` helper in `apps/web/lib` returning `{ Provider, useSelector, useApi }`. Small win now; prevents a third copy when the next scoped store appears.

### [SEVERITY: Low] Centered full-page shell markup/Tailwind cluster repeated ~8×; two near-identical shell components

The cluster `flex min-h-screen flex-col items-center justify-center gap-4 p-8` (± `gap-6`/`p-6`, no `justify-center`) appears at:
- `apps/web/app/page.tsx:14`
- `apps/web/app/sign-in/page.tsx:11`
- `apps/web/app/sign-up/page.tsx:9`
- `apps/web/app/table/[roomId]/page.tsx:81, 96, 134`
- `apps/web/components/hall/waiting-room.tsx:58, 94`

And two components are near-duplicates of each other: `Centered` (`apps/web/components/hall/waiting-room.tsx:91-100`) vs `ReturnToLobby`/`TableBootPlaceholder` (`apps/web/app/table/[roomId]/page.tsx:77-103`) — same `<main>` + title + muted message shell, the latter adding a button.

**Consolidation:** a `PageShell`/`CenteredMessage` component in `apps/web/components/ui`.

### [SEVERITY: Low] Lobby→table handoff snippet duplicated in web

The destructure-and-handoff sequence (`const { ticket, ...match } = active; setHandoff({ match, ticket: ticket ?? null }); router.push/replace($path({ route: '/table/[roomId]' … }))`) appears at:
- `apps/web/components/hall/casual-hall.tsx:42-45` (`rejoin`)
- `apps/web/lib/use-waiting-room.ts:117-119` (live transition)
- Near-variant at `apps/web/components/hall/casual-hall.tsx:50-53` (quick play, from the ticket payload)

**Consolidation:** a `handoffToTable(active)` helper (in `store.tsx` next to `setHandoff` or a small `lib/handoff.ts`).

### [SEVERITY: Low] Card identity key rebuilt inline in web despite engine export

- Canonical: `cardIdentityKey` at `packages/engine/src/domain/card.ts:47-49` (`` `${rank}-${suit}-${copyIndex}` ``), exported from the engine root (`domain/index.ts:6`).
- Copy: React `key={`${card.rank}-${card.suit}-${card.copyIndex}`}` at `apps/web/components/table/table-view.tsx:106`. Web already imports from `@meldrank/engine`. Trivial fix, prevents key-format drift.

### [SEVERITY: Low] Three near-identical Dockerfiles

`apps/api/Dockerfile`, `apps/match/Dockerfile`, `apps/bots/Dockerfile` are the same multi-stage pnpm-workspace build differing only in `EXPOSE` (3001 / 2567 / none) and the `pnpm --filter` target in `CMD`. A base-image change (Node bump, pnpm store config, adding a prune step) must be made three times.

**Consolidation:** one root `Dockerfile` with `ARG APP` / `ARG PORT` (`fly deploy --build-arg`), or accept the triplication knowingly — it is low-churn config.

### [SEVERITY: Low] Two constant-time comparison implementations

- `bytesEqual` over `Uint8Array` at `packages/fairness/src/encoding.ts:66-75`.
- `timingSafeEqual` over hex strings at `packages/shared/src/server/api/ticket.ts:40-49`.

Same XOR-accumulator pattern, different input types, both correct. Only worth unifying if shared ever grows a byte-level util module; flagged so a third copy doesn't appear.

## Non-issues checked (verified NOT duplicated)

- **Rank/Suit/Card vocabulary** — single-sourced in `packages/shared/src/variant/schema.ts:18-23`; the engine re-exports type-only (`packages/engine/src/domain/card.ts:1-18`) exactly to prevent drift. `CardRef` (`packages/shared/src/intent/types.ts:26-30`) intentionally mirrors `Card` shape as a decoupled wire type — documented, not accidental.
- **PlayerIntent** — one definition in shared; web's `TableIntent` is a proper `Extract<…>` subset (`apps/web/components/table/intents.ts:9`), not a copy.
- **Seat tickets** — schema (`packages/shared/src/api/ticket.ts`), HMAC sign/verify (`packages/shared/src/server/api/ticket.ts`); API mints (`apps/api/src/lobby/tickets.ts`), match verifies (`matchRoom.ts:229-243`) — both import, zero copies.
- **Spawn seam** — path, secret header, trace header, and request/response Zod schemas all shared (`packages/shared/src/api/spawn.ts:52-53`, `trace.ts`); both `apps/api/src/spawn/client.ts` and `apps/match/src/gateway/spawn.ts` consume them.
- **Env parsing** — one `parseEnv` (`packages/shared/src/env/load.ts`), layered per-process schemas with shared shape fragments (`packages/shared/src/server/env/schema.ts:14-83`); all three services boot through the shared loaders; web's `NEXT_PUBLIC_*` contract is separate by Next.js inlining necessity (`apps/web/lib/env.ts` explains why).
- **tsconfig/eslint** — every workspace `tsconfig.json` extends root `tsconfig.base.json`; single root `eslint.config.mjs`; no per-workspace lint/prettier fragments.
- **Shuffle/RNG** — one Fisher–Yates (`packages/engine/src/dealer/deal.ts:26`); the two seed-expansion algorithms (`createSeededRng` mulberry32 in engine vs full-width `rngFromSeed` in fairness) are intentionally distinct constructions, documented on both sides.
- **Utility helpers** — exactly one `cn()` (`apps/web/lib/utils.ts:5`); exactly one sleep/`delay` (`matchRoom.ts:575`); no duplicated id generation (`randomUUID` used directly everywhere); clock formatting (`formatBank`/`formatRemaining`) exists once (`apps/web/components/table/clock.tsx`).
- **tRPC contract** — routers use shared input/output schemas from `packages/shared/src/api/procedures.ts` throughout (`apps/api/src/routers/*.ts`); the web client gets types via `AppRouter` — no hand-written client mirrors. `trpcErrorCode` helper exists once (`apps/web/lib/use-waiting-room.ts:214`).
- **Result event / replay / DB projection** — `MATCH_RESULT_CHANNEL`, `MatchResultEvent`, `ReplayBlobV1` in shared; `apps/match/src/persistence/writer.ts` reuses the shared `projectHand` and drizzle schema, no re-projection.
- **Bot suit handling** — `packages/bots/src/brain.ts:90-93` derives suits from `variant.deck.suits`, no hardcoded list.
- **Seat helpers** — engine `deriveSeats` (team membership) vs match `seating.ts` (connection/seat assignment) solve different problems; no overlap.

## Recommended action plan (ordered)

1. **[M] Shared Colyseus wire-protocol module** — add `packages/shared/src/match/wire.ts`: message-name constants, Zod schemas for `intent`/`contribute` inbound payloads (delivering the long-promised `PlayerIntent` runtime schema), types for `view`/`accept`/`reject`/`commit`/`clockState`/`rejectContribution` payloads and the `RoomMetadata` snapshot. Adopt in `matchRoom.ts` (with inbound validation) and `use-table-connection.ts`/`table-store.tsx`. Highest drift-risk elimination in the repo.
2. **[S] Engine-owned rng-injectable deal orchestration** — export `applyDealWithRng` + a public `startNextHandBase` from `packages/engine`; shrink `apps/match/src/room/deal.ts` to imports. Removes three copied engine internals.
3. **[S] Fix variant resolution in the match room** — thread the spawn request's `variant` snapshot through `toCreateOptions`/`MatchCreateOptions` (or share a `VARIANTS_BY_ID` map) and fail loudly on unknown ids. Prevents a silent wrong-ruleset bug when variant #3 lands.
4. **[S] Grace-window single source** — export the default from shared or carry `reconnectGraceMs` in synced metadata/`clockState`; delete web's `GRACE_MS`.
5. **[S] Web card/suit dedupe** — shared `SUITS` export, single `SUIT_GLYPH`, reuse `cardIdentityKey`, drop `SEAT_COUNT` hardcode (derive from occupancy/variant).
6. **[S] Web shell + boilerplate dedupe** — `PageShell`/`CenteredMessage` component; `createStoreContext` helper; `handoffToTable` helper; add `@meldrank/fairness` to web and delete local `toHex`.
7. **[M] (Optional) Parameterize the Dockerfile** — single root Dockerfile with `ARG APP/PORT`, or explicitly accept the triplication. Lowest value; do last.
