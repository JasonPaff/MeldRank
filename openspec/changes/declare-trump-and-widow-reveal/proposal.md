## Why

The `dealer-and-auction-manager` change drove the hand lifecycle as far as a settled auction `Bid` and left `declareTrump` / `playCard` in the `Event` union but rejected by a not-yet-implemented guard. The next slice in the locked build order (engine → outward, "Game Engine — Abstract Model" §2/§5) is the **contract-completion** stretch: name trump, and — for widow variants — expose the widow to the bidder. This is the prerequisite the MeldDetector cannot start without (meld is computed against a declared trump), so it is the correct next change.

## What Changes

- **Activate the `declareTrump` intent in `reduce`.** During the `DeclareTrump` phase, a `declareTrump` is legal only when the seat is the contract winner (the auction's recorded `Bid` seat) and `trump` is one of the deck's four suits. A legal declaration records the trump on the state and advances to the variant's next active phase (`Melding` for both ranked variants, since neither enables `Passing`); illegal declarations are rejected with state unchanged, consistent with the existing typed-rejection contract (no throw on the hot path).
- **Add the automatic `WidowReveal` transition** for widow variants (Cutthroat). The locked `Event` union carries no player intent for it, so on auction conclusion the engine deterministically reveals the widow — recording it in **public** state (the canonical widow is `exposed`, so all seats see it) and folding it into the bidder's hand — then settles at `DeclareTrump`. Partners (no widow) advances `Auction → DeclareTrump` directly, unchanged.
- **Advance the wired lifecycle slice** from `Auction` to "ready for `Melding`": Partners runs `Auction → DeclareTrump → Melding`, Cutthroat runs `Auction → WidowReveal → DeclareTrump → Melding`. `Melding` / `playCard` become the new rejected frontier (accepted by type, rejected by the guard), exactly as `declareTrump` was in the prior slice.
- **Record the declared trump on `State`** so downstream modules (MeldDetector, LegalPlayValidator, scorers) read it without a side channel, and record the revealed widow publicly so the reveal is auditable in a replay fold.
- **Exhaustive Vitest coverage** focused on Single-Deck Partners, with Cutthroat exercising the widow reveal (hand grows by the widow size, widow recorded publicly). No Zod or any runtime dependency enters `@meldrank/engine`; `@meldrank/shared` imports stay type-only.

## Capabilities

### New Capabilities

- `declare-trump`: The `DeclareTrump` phase driver — `declareTrump` legality (contract winner only, a real suit), recording the trump onto state, and advancing to the next active phase. The deterministic forced move for the phase is out of scope (Ruling 5 has no "pass" in `DeclareTrump`; a trump-declaration default belongs with the broader timeout policy that lands alongside TrickPlay).
- `widow-reveal`: The automatic `WidowReveal` transition for widow variants — deterministic reveal on auction conclusion, recording the exposed widow in public state and merging it into the bidder's hand, with no addition to the locked `Event` union. Skipped entirely by no-widow variants.

### Modified Capabilities

- `hand-state-container`: `reduce` now drives the `Auction → [WidowReveal] → DeclareTrump → (ready for Melding)` slice instead of resting at the won `Bid`. `declareTrump` is no longer rejected; `Melding` / `playCard` become the rejected frontier. `State` gains the declared-trump and revealed-widow public regions.

## Impact

- **Code:** `packages/engine/src` — new `trump/` (or `declare/`) and `widow/` phase modules; `state/state.ts` (`PublicState` gains the declared trump and the revealed widow); `state/reduce.ts` (the `DeclareTrump` case and the `WidowReveal` step on auction conclusion). Consumes the existing `domain/` (`Contract`, `makeContract`, `Suit`, `Hand`), `lifecycle/` (transition table, `resolveActivePath`), and `auction/` modules, plus the `DeclareTrumpIntent` and `VariantDefinition` _types_ from `@meldrank/shared`. New/extended Vitest suites in `@meldrank/engine`.
- **Dependencies:** none added — `@meldrank/engine` stays at zero runtime dependencies (the invariant test continues to hold); shared-package imports remain type-only.
- **Downstream:** completes the contract so the next engine change (**MeldDetector**) can compute melds against `state.public.trump`; extends — does not reshape — the `reduce`/`Event`/`State` contract. The widow-reveal seam is where Match Runtime animates the exposed widow from recorded public state.
- **Design source of truth:** Linear "Game Engine — Abstract Model" (§2/§5), "API Surface & Contracts — Design v1" (§4, the `declareTrump` intent), and both canonical ranked ruleset docs (`trumpDeclaredBy: bid-winner`; Cutthroat's 3-card exposed widow). No spec-level decisions are introduced that those locked docs don't already establish.
