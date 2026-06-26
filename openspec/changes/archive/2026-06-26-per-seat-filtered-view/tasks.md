## 1. Types

- [x] 1.1 Add a `view/` module in `packages/engine/src` with a `FilteredView` type: `{ viewer: number | null; public: PublicState; own: OwnRegion | null; handSizes }`, reusing `PublicState` verbatim and carrying NO `private` member and NO other-seat hand field (D2).
- [x] 1.2 Define `OwnRegion = { hand: readonly Card[]; buried: readonly Card[] }` (D4) and the contents-free `handSizes` shape (per-dealt-seat count keyed/indexed by seat) (D5). Use `readonly` throughout.

## 2. Projection function

- [x] 2.1 Implement `viewFor(state, viewer: number | null)`: pure, non-mutating, deterministic; `public` passes through verbatim; `handSizes` derived from `state.private.hands[i].length` for every dealt seat.
- [x] 2.2 Seated path: set `own.hand = state.private.hands[seat]` and `own.buried = state.private.buried` read from the viewer's own slice (non-bidder own buried is naturally empty; empty on the non-bury path) (D4). NOTE: `state.private.buried` is a single bidder-owned pile (not a per-seat slice), so `own.buried` is gated on `viewer === contract.seatIndex` to honor the spec's "non-bidder never sees buried cards" (V1); non-bidders receive an empty pile.
- [x] 2.3 Spectator path (`viewer === null`): `own = null`; public + handSizes only (D3, V3).
- [x] 2.4 Reject an invalid/undealt seat index by throwing rather than fabricating an empty hand (D6). Never reference `state.private.widow` anywhere in the module (D7).
- [x] 2.5 Re-export `viewFor` and `FilteredView` (and helper types) from `packages/engine/src/index.ts`.

## 3. Tests

- [x] 3.1 Per-seat derivation: own hand equals `state.private.hands[seat]`; public region deeply equals `state.public`; determinism (two calls deeply equal); input `State` not mutated.
- [x] 3.2 Hidden-info exclusion (runtime): a view's key set matches an allow-list — no `private`, no other-seat hands, no unrevealed widow — asserted across EVERY lifecycle phase (Dealing → Auction → WidowReveal → DeclareTrump → Bury → Melding → TrickPlay → HandScoring → MatchComplete).
- [x] 3.3 Hidden-info exclusion (compile-time): `@ts-expect-error` assertions proving another seat's hand and the unrevealed widow cannot be read from a `FilteredView`.
- [x] 3.4 Bury (V1): bidder's own view includes `buried` equal to `state.private.buried`; non-bidder views expose no buried contents; own buried empty on the Partners (non-bury) path.
- [x] 3.5 Hand sizes (V2): counts equal each seat's `hands[seat].length` and convey no card identity; verified for both seated and spectator views.
- [x] 3.6 Spectator (V3): public deeply equals `state.public`, handSizes present, `own === null`; no hidden cards in any phase.
- [x] 3.7 Invalid seat index throws (D6).

## 4. Validation

- [x] 4.1 Run lint, typecheck, and tests via the validate agent and confirm a clean summary.
