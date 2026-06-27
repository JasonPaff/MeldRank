## Why

The Match Runtime's single most integrity-critical mechanic is hidden-information enforcement: each connected seat may see only its own hand plus public table state, and hidden cards must never leave the server (Match Runtime — Design v1 §3). The engine `State` was deliberately structured for this — public regions kept structurally distinct from per-seat private regions "so the Match Service's per-seat filtering is a mechanical projection, not a bespoke walk" (`packages/engine/src/state/state.ts`). That projection does not yet exist. Building it now — as a pure, exhaustively-tested function in `packages/engine`, before any Colyseus/networking lands — keeps the integrity keystone in the pure/tested lane and makes the eventual Match Service room a thin caller rather than the place hidden-info leaks get introduced.

## What Changes

- Add a pure `viewFor(state, seat)` projection to `packages/engine` that derives a per-seat **filtered view** from the full engine `State`.
- Add a `FilteredView` type **structurally engineered so other seats' hands and the unrevealed widow cannot be represented** — leakage is a compile error, not merely a runtime convention.
- Public state (phase, turn, auction standing, contract, trump, revealed widow, laid meld, current/completed tricks, captures, score pad, results) passes through **verbatim** — it is already the table-visible set.
- The viewing seat receives **only its own hand** (`private.hands[seat]`); `private.widow` is **never** included (pre-reveal it is secret; post-reveal it is already in `public.revealedWidow`).
- **V1** — the bidder sees their **own** `private.buried` pile in their view (their own information; needed for the bidder's UX). No other seat ever sees a buried pile.
- **V2** — include opponents' **hand sizes** (counts only, never contents) so a client can render opponents' card backs.
- **V3** — support a **spectator view** (`seat = null` → public state only, no own region), so the known Next-phase spectating feature falls out of the same projection.
- Exhaustive tests proving no private field leaks across **every** lifecycle phase, plus type-level assertions that hidden regions are unrepresentable.

## Capabilities

### New Capabilities

- `seat-view-projector`: The pure projection from full engine `State` to a per-seat (or spectator) filtered view — the hidden-information boundary the Match Runtime enforces, expressed as engine-level types and a deterministic function.

### Modified Capabilities

<!-- None. This adds a new pure projection over existing State; it does not change any existing spec's requirements. The State shape it consumes is already specified by hand-state-container. -->

## Impact

- **Code**: New module in `packages/engine/src` (e.g. `view/`) exporting `viewFor` and `FilteredView`; re-exported from `packages/engine/src/index.ts`. Pure, zero new runtime dependencies — consistent with the engine's zero-runtime-dep constraint.
- **Consumers**: The Match Service (`apps/match`) will call `viewFor` per recipient at send time; the web client and bots consume the `FilteredView` type. This change adds the function/types only — no networking, no Colyseus, no persistence.
- **Design docs**: Realizes Match Runtime — Design v1 §3 (hidden-information enforcement) and §4 (the per-seat filtered view the move loop broadcasts). Consumes the `State` shape defined by the `hand-state-container` spec.
- **No breaking changes**: purely additive.
