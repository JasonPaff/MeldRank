## Context

`packages/engine` holds the pure, zero-runtime-dependency Game Engine. Its `State` (`packages/engine/src/state/state.ts`) was deliberately split into a `PublicState` region (table-visible) and a `PrivateState` region (`hands[]`, unrevealed `widow`, the bidder's face-down `buried` pile) so that "the Match Service's per-seat filtering is a mechanical projection, not a bespoke walk. The engine structures the state for filtering; it does not filter." This change adds that projection.

The projection is consumed by three of the engine's callers: the Match Service (`apps/match`) calls it per recipient at send time to produce each client's patch stream (Match Runtime — Design v1 §3/§4), and the web client and bots consume the resulting type. Building it here, pure and exhaustively tested, keeps hidden-information enforcement — "the single most integrity-critical mechanic" — out of the networking layer where leaks are easy to introduce.

## Goals / Non-Goals

**Goals:**

- A pure, deterministic `viewFor(state, viewer)` over the existing `State`, no mutation, no new runtime dependencies.
- A `FilteredView` type in which other seats' hands and the unrevealed widow are **structurally unrepresentable** — leakage is a compile error.
- Resolve the three agreed edges: V1 bidder sees own buried pile; V2 expose opponent hand sizes as counts; V3 spectator view (public only).
- Exhaustive tests that no private field leaks in any lifecycle phase.

**Non-Goals:**

- No Colyseus schema, networking, serialization, or patch/diff logic — that is the Match Service's job; this is the pure input to it.
- No re-specification of `State` or the lifecycle (owned by `hand-state-container` / the engine model).
- No authentication or seat-identity/reconnection concerns (Auth & Identity / Match Runtime).
- No client rendering.

## Decisions

**D1 — Live in `packages/engine` as a new `view/` module, re-exported from the package index.**
The projection is a pure function over `State`; the client and bots already import engine types, and the Match Service runs the engine as authority. Putting it in `shared` would invert the dependency (shared has no `State`). Alternative considered: a method on a state object — rejected; `State` is intentionally a plain JSON-round-trippable value with no behavior.

**D2 — `FilteredView` is a distinct type, not a narrowed `State`.**
Shape: `{ viewer; public: PublicState; own: OwnRegion | null; handSizes }`. `public` is `PublicState` reused verbatim. The view has **no `private` member and no `hands` array** — so there is simply no place to put another seat's cards. This is what makes hidden information _unrepresentable_ rather than _omitted_. Alternative considered: reuse `State` with empty/blanked private fields — rejected, because a blanked field is still a field that can be mis-populated, defeating the compile-time guarantee.

**D3 — Viewer identity is `number | null`; `null` is the spectator (V3).**
A single function handles both seated and spectator views: a seat index yields an `own` region; `null` yields `own: null` with public + counts only. Alternative considered: a separate `spectatorView` function — rejected as duplicative; the spectator case is the seated case minus the own region.

**D4 — Own region carries `hand` and `buried` (V1).**
`OwnRegion = { hand: readonly Card[]; buried: readonly Card[] }`. `buried` is the viewer's own buried pile (empty on the non-bury path, and only ever non-empty for the bidder since only the bidder buries). Note that `PrivateState.buried` is **not** a per-seat slice — it is a single, bidder-owned face-down pile shared on the state. So `own.buried` cannot be set from `state.private.buried` unconditionally; doing so would hand every seated viewer the bidder's buried cards and leak it (violating V1). The projection therefore gates `buried` on the bidder seat: `own.buried = (viewer === state.public.contract?.seatIndex) ? state.private.buried : []`. A non-bidder's own region is empty because the gate excludes it; with no contract recorded, or on the non-bury path, the pile is empty anyway so non-bidders get an empty pile either way.

**D5 — `handSizes` exposes counts for every dealt seat, contents-free (V2).**
Represented as a per-seat count keyed by seat index (or a fixed-length number array indexed by seat), derived from `state.private.hands[i].length`. It is a plain number, structurally incapable of carrying card identity. Included in both seated and spectator views so a client can render every opponent's card backs.

**D6 — Invalid seat indices are rejected, not coerced.**
`viewFor(state, s)` for an `s` that is not a dealt seat throws rather than returning a fabricated empty hand — a silently-empty view would mask a real bug in a caller (e.g. the room mis-routing a recipient). The spectator path (`null`) is the only "no own hand" case and is explicit.

**D7 — `revealedWidow` rides public state; `private.widow` is never read.**
The projection touches `state.private.hands` and `state.private.buried` only. `state.private.widow` is never referenced anywhere in the module, so even the unrevealed widow has no path into any view; the table sees the widow exclusively through `public.revealedWidow` once the lifecycle reveals it.

## Risks / Trade-offs

- **A future field added to `PrivateState` could leak if the projection is naively widened** → The `FilteredView` type carries no `private` member, so new private fields are excluded by default; adding one to a view requires a deliberate, reviewable type change. Tests assert the view's keys against an allow-list to catch accidental widening.
- **Reusing `PublicState` verbatim couples the view type to it** → Acceptable and intended: public state _is_ the table-visible contract; if it changes, the view should change with it. The coupling is one-directional and explicit.
- **Type-level guarantees are only as strong as the tests that assert them** → Add `expectTypeError`-style / `@ts-expect-error` compile-fail assertions plus runtime key-allow-list tests, exercised across every lifecycle phase so a regression in any phase is caught.
- **Shallow vs. deep copying** → The view may share references into the immutable `State` (the engine treats `State` as immutable, and the function does not mutate). Returning references avoids needless copying; the no-mutation guarantee plus `readonly` types keeps this safe. If the Match Service later needs owned copies for serialization, that is its concern, not the projection's.
