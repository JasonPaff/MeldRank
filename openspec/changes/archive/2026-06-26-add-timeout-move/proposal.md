## Why

The engine models a clock expiry as the `timeout` system event, but only the `Auction` phase resolves one today (inline, as a pass) — a `timeout` during `TrickPlay` falls through `reduce`'s phase guard and leaves the state unchanged, so a stalled seat would hang the table. "Game Engine — Abstract Model" §5 names a `TimeoutMove` module and Ruling 5 (added 2026-06-25) fixes its policy: the deterministic, auditable forced move the realtime layer applies when a seat's clock runs out. This is the engine half of the move-clock contract "Match Runtime" §5 defers here, and the on-clock seat is part of the v1 Single-Deck Partners NOW path. It is also the last "Game Engine — Abstract Model" §5 module besides the (separately-sequenced) `Bury` phase still unbuilt.

## What Changes

- Add a pure `TimeoutMove(state) → PlayerIntent | null` to `@meldrank/engine`, per "Game Engine — Abstract Model" §5 and Ruling 5: it computes the deterministic forced **intent** for the seat currently to act when that seat's clock expires.
- Implement the Ruling 5 policy: in a phase where **passing is legal** (the driven case is `Auction`; future discard-pass phases follow the same rule) the forced move is a `pass`; otherwise (the driven case is `TrickPlay`) it plays the **lowest-value legal card** from the `LegalPlayValidator` set, breaking ties by a fixed ordering — suit (deck order) then `copyIndex` — so the move is reproducible from the replay and never advantages or disadvantages the seat beyond the minimal legal action.
- Centralize `timeout` resolution in `reduce`: a `timeout` for the seat-to-act is resolved by computing the forced intent via `TimeoutMove` and applying it through the **identical** intent path a human move would take; a `timeout` for any other seat (or where no forced move is defined for the phase) leaves the state unchanged. This subsumes the auction-phase inline timeout handling while preserving its observable "a timeout passes the seat" behavior.
- Return `null` for phases that have no Ruling 5 forced move (notably `DeclareTrump`, plus all non-acting phases), leaving the state unchanged there. The forced-declaration policy for a `DeclareTrump` timeout is **not** covered by Ruling 5 and is flagged for a ruling (see design.md), not invented here.

## Capabilities

### New Capabilities

- `timeout-move`: the pure `TimeoutMove(state) → PlayerIntent | null` module — the deterministic forced-move policy of "Game Engine — Abstract Model" Ruling 5 (pass where passing is legal; otherwise the lowest-value legal card, ties by suit then `copyIndex`).

### Modified Capabilities

- `hand-state-container`: `reduce` now resolves the `timeout` system event uniformly through `TimeoutMove` and applies the forced intent through the normal intent path (previously a `timeout` was handled only inside the `Auction` branch and was a no-op in every other phase). The closed-event-union and phase-guard requirements are otherwise unchanged.

## Impact

- **`packages/engine`** — new `src/timeout/` module (`TimeoutMove`, exported via `index.ts`); a change to `src/state/reduce.ts` to route `timeout` through `TimeoutMove` and drop the inline auction-only timeout case. Reuses the existing `LegalPlayValidator` (no change to it). The engine's zero-runtime-dependency invariant is preserved (consumes the `PlayerIntent`/`VariantDefinition` types only).
- **`auction-manager` spec** — unaffected: its "Deterministic auction timeout is a pass" requirement still holds, since the forced pass `TimeoutMove` produces yields the identical auction step. No delta needed.
- **Downstream (design-only for now)** — `TimeoutMove` is the forced move "Match Runtime" §5 invokes when a move clock expires; no code in `apps/match` changes here.
- No breaking changes: `reduce`'s signature is unchanged and all prior accepted/rejected outcomes are preserved; the only behavioral change is that a `timeout` during `TrickPlay` now forces a legal play instead of being a silent no-op.
