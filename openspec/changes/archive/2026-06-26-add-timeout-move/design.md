## Context

The engine already models a clock expiry as the `timeout` system event (`state/events.ts`: `TimeoutEvent { type: 'timeout', seat }`), but `reduce` only resolves it in one place: `applyAuctionEvent` folds `'timeout'` into the same branch as `'pass'`. In every other phase a `timeout` falls through to the `reduce` default and returns the state unchanged — harmless for replay, but in the realtime layer it means a stalled seat during `TrickPlay` would hang the table with no legal progression.

"Game Engine — Abstract Model" §5 names a `TimeoutMove` module — `(hand, phaseState, variant) → intent` — and Ruling 5 (added 2026-06-25) fixes its policy: _"in any phase where passing is legal (e.g. Auction, or a discard-pass), the action is pass; otherwise play the lowest-value legal card from `LegalPlayValidator`, breaking ties by a fixed ordering (suit, then `copyIndex`)."_ It is the engine's half of the move-clock contract "Match Runtime" §5 explicitly defers here. The pieces it builds on are already in place: `LegalPlayValidator(hand, trick, trump, trickRules) → Card[]` (`play/legal.ts`), the locked rank ordering `A > 10 > K > Q > J > 9` (`play/strength.ts`), the `PlayerIntent` wire types (`@meldrank/shared`), `state.public.seatToAct`, and `variant.deck.suits` for the suit tiebreak.

## Goals / Non-Goals

**Goals:**

- A pure `TimeoutMove` implementing the Ruling 5 forced-move policy: the deterministic, auditable intent the engine plays when the seat-to-act's clock expires.
- Close the one realtime-relevant gap on the v1 Partners path: a `timeout` during `TrickPlay` now forces a legal play instead of being a silent no-op.
- Route every `timeout` through a single resolution point in `reduce`, applying the forced intent through the identical path a human intent takes (same guards), preserving deterministic replay.
- Preserve all existing behavior — including the auction-manager "a timeout passes the seat" requirement — and the engine invariants (pure, non-mutating, deterministic, zero runtime deps).

**Non-Goals:**

- A forced-declaration policy for a `DeclareTrump` timeout — Ruling 5 does not cover it; flagged below (Open Questions) for a dedicated ruling.
- The discard-pass phases (`Passing`, `Bury`) — not yet driven; their (pass-legal) timeout will fall out of the same policy once those phases land. `Bury` is the separately-sequenced next change.
- Move-clock durations, grace periods, when a timeout fires, and disconnect/leaver handling — all "Match Runtime" §5/§6 concerns. This change only produces the forced move, not the clock.

## Decisions

### D1 — New `timeout-move` capability in `src/timeout/`

A pure `TimeoutMove(state: State) → PlayerIntent | null` in its own `src/timeout/` folder with an `index.ts` re-export, consistent with `match/`, `score/`, `play/`, `meld/`, and wired into the package barrel.

_Why `state` rather than the abstract §5 `(hand, phaseState, variant)`:_ `reduce` already holds the full `State`, and the policy needs the phase, the seat-to-act, the in-progress trick, the trump, and the variant — exactly the projection `State` already carries. Threading the whole `State` (as `MatchScorer` and the other drivers do) avoids inventing a `phaseState` bag and keeps the call site a one-liner. The return is a `PlayerIntent` (or `null`), not a mutated state: the forced move is then fed back through `reduce`, so it passes the same guards a human move does.

### D2 — The forced-move policy (Ruling 5)

`TimeoutMove` reads `state.public.seatToAct`; if it is `null`, return `null`. Otherwise dispatch on `state.public.phase`:

- **`Auction`** (passing is legal) → return `{ type: 'pass', seat }`.
- **`TrickPlay`** (card-play) → return `{ type: 'playCard', seat, card }` where `card` is the lowest-value legal card (D3).
- **Any other phase** → return `null` (no defined forced move; see D5).

The pass-legal vs. card-play split is the literal Ruling 5 dichotomy. Only `Auction` and `TrickPlay` are driven phases today, so those are the two live arms; the structure leaves room for the discard-pass phases to join the pass-legal arm unchanged when they land.

### D3 — "Lowest-value legal card" and the tiebreak

Among the cards `LegalPlayValidator(hand, currentTrick, trump, variant.trick)` returns, pick the minimum under this total order:

1. **Card value** ascending — the locked rank ordering `A > 10 > K > Q > J > 9`, so the weakest rank (`9`) is lowest. This is the intrinsic rank value, **not** trick-relative strength: a `9` is lowest-value whether or not it is trump. (The same ordinal already lives in `play/strength.ts`; this change exposes a small rank-value helper rather than duplicating the table.)
2. **Suit** ascending — by the suit's index in `variant.deck.suits` (the deck's canonical order), the fixed suit ordering Ruling 5 calls for.
3. **`copyIndex`** ascending — the final tiebreak between the two physical copies.

Selecting from the `LegalPlayValidator` set (rather than the whole hand) is what makes the move legal under follow-suit / must-trump / must-beat: when the validator narrows the hand to "must beat" cards, the lowest of _those_ is chosen. The result is always non-empty for a non-empty hand (the validator guarantees at least one legal card), so the `TrickPlay` arm always yields a concrete `playCard`.

### D4 — Centralized `timeout` resolution in `reduce`

`reduce` gains a single pre-dispatch branch:

```
if (event.type === 'timeout') {
  const forced = event.seat === state.public.seatToAct ? TimeoutMove(state) : null;
  return forced === null ? state : reduce(state, forced);
}
```

The recursion re-enters `reduce` with the forced `PlayerIntent`, which lands in the normal phase branch (`pass` → `applyAuctionEvent`, `playCard` → `applyPlayCard`) and passes the identical guards. The inline `'timeout'` case is removed from `applyAuctionEvent` (the forced `pass` now arrives as a real `pass` intent), so there is exactly one place that knows how to resolve a timeout.

_Why guard on `event.seat === seatToAct`:_ a stray timeout for a seat that is not on the clock must be a no-op; resolving it against `seatToAct` regardless would force the wrong seat. The seat match makes `TimeoutMove`'s "for the seat to act" precise and keeps the realtime layer from having to pre-filter.

_Behavior preservation:_ during `Auction`, `TimeoutMove` returns a `pass` for the seat-to-act, and `reduce(state, pass)` produces the same auction step the old inline path did — so the `auction-manager` spec's "a timeout passes the seat" scenario still holds with no delta to that spec.

### D5 — `DeclareTrump` and other phases return `null`

`DeclareTrump` is the one v1 Partners on-clock phase Ruling 5 does not address: it is neither pass-legal nor a card play, and "lowest-value legal card" has no meaning for naming trump. Rather than invent a declaration policy, `TimeoutMove` returns `null` there (and for every non-acting phase), and `reduce` leaves the state unchanged — the same no-op the engine has today. This keeps the change strictly faithful to Ruling 5; the declaration policy is flagged for a ruling (Open Questions). All other phases (`Dealing`, `WidowReveal`, `Melding`, `HandScoring`, `MatchComplete`) have `seatToAct === null` anyway, so they return `null` through the first guard.

## Risks / Trade-offs

- **`DeclareTrump` timeout still hangs the clock** → A real (if narrow) v1 gap: a bidder who stalls at `DeclareTrump` has no engine-forced progression. Accepted for this change to avoid inventing a competitive-integrity ruling; surfaced as the one flagged fork for Jason (Open Questions), to land as a fast-follow once ruled.
- **"Value" reading (rank vs. counters)** → Chosen as the locked rank ordering, which coincides with counter value for the standard counter set (`9 < J < Q < K < 10 < A`), so the two readings agree on the canonical variants. Rank ordinal is preferred because it is a fixed constant (not a variant axis) and unambiguously means "weakest card." Documented so a casual simplified-counter variant does not surprise.
- **Removing the inline auction timeout case could regress auction behavior** → Mitigated by routing the forced `pass` back through the same `applyPass` path and re-asserting the auction-timeout scenario in tests; the observable outcome is identical.
- **Recursion in `reduce`** → One level deep and only for `timeout` (the forced intent is never itself a `timeout`), so it cannot loop; called out so the bound is explicit.

## Open Questions

- **Forced move for a `DeclareTrump` timeout (needs a ruling).** Ruling 5 is silent. Options: (a) **defer** — leave it a no-op until a ruling (this change's baseline); (b) declare the bidder's **longest suit**, ties broken by the fixed suit ordering (keeps the table moving with a non-self-defeating minimal choice); (c) declare the **lowest suit** by fixed ordering (purely minimal, strategically poor). Recommend deciding (b) vs. (a) when the move-clock work in "Match Runtime" §5 is scheduled; the engine seam (`TimeoutMove` returning an intent) already supports adding a `declareTrump` arm with no structural change.
