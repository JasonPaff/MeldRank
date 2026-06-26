## Why

The `declare-trump-and-widow-reveal` change drove the hand lifecycle to a declared trump and left `Melding` as the rejected frontier. The next phase in the locked machine ("Game Engine — Abstract Model" §2) is **Melding**, whose driver is the **MeldDetector** — called out in §5 as one of "the two hardest, highest-value pieces [that] deserve their own deep specs + exhaustive test suites... correctness here _is_ the product's integrity." It is also the prerequisite for `HandScoring`, which cannot total a side without its meld. The variant schema already names the table (`meldTableId: 'standard-single-deck'`) but its **values do not yet exist** — so this change supplies both the data and the detector that consumes it.

## What Changes

- **Add the Standard single-deck meld table to `@meldrank/shared`.** The canonical values both ranked rulesets share — Class A (runs, marriages, dix), Class B (pinochles), Class C (arounds), plus the double bonuses — resolved from the existing `meldTableId: 'standard-single-deck'`. Plain validated data (the Zod home), consumed type-only by the engine.
- **Implement the `MeldDetector` in `@meldrank/engine`** (`packages/engine/src/meld/`): a pure `(hand, trump, meldTable) → { melds, total }` that computes a seat's **maximum legal meld set** with correct cross-class reuse (a card may serve one Class A + one Class B + one Class C meld, but never twice within a class), and applies the "double scores instead of, not in addition to, the two singles" rule and the "K–Q inside a run does not also score a royal marriage" rule. Meld is **engine-computed, not chosen** (Ruling 1) — there is no player intent and no under-meld strategy.
- **Wire the `Melding` phase as an automatic transition** in `reduce`. As with `WidowReveal`, the locked `Event` union carries no `meld` intent, so on entering `Melding` the engine deterministically computes each **melding seat's** meld (per `whoMelds`: all seats for Partners, bidder only for Cutthroat), records it in **public** state (meld is laid face-up), and advances to the variant's next active phase (`Bury` for Cutthroat, `TrickPlay` for Partners).
- **Advance the wired lifecycle slice** to rest at the next phase: Partners runs `…DeclareTrump → Melding → TrickPlay`, Cutthroat runs `…DeclareTrump → Melding → Bury`. `playCard` / `Bury` / `TrickPlay` become the new rejected frontier, exactly as `Melding` was in the prior slice.
- **Exhaustive Vitest coverage** focused on Single-Deck Partners: every meld type and value, trump-dependence (run/royal-marriage/dix track the declared suit), cross-class reuse, within-class non-reuse, double-vs-two-singles, the run-vs-royal-marriage rule, and known full-hand totals. No runtime dependency enters `@meldrank/engine`; `@meldrank/shared` imports stay type-only.

## Capabilities

### New Capabilities

- `standard-meld-table`: The Standard single-deck meld table — the canonical Class A/B/C meld definitions and point values (and double bonuses) that `meldTableId: 'standard-single-deck'` resolves to, living in `@meldrank/shared`. The double-deck table's values stay reserved/deferred (§3 Ruling 3).
- `meld-detector`: The `MeldDetector` engine module — the pure function that computes a seat's maximum legal meld set and total against a declared trump and a meld table, including the cross-class reuse, within-class non-reuse, double-vs-singles, and run-vs-royal-marriage rules.

### Modified Capabilities

- `hand-state-container`: `reduce` now drives the `DeclareTrump → Melding → [Bury] → TrickPlay` slice instead of resting at `Melding`. On entering `Melding` it deterministically computes and records each melding seat's meld, then advances; `playCard` (and the `Bury` / `TrickPlay` frontier) remain rejected. `PublicState` gains a per-seat recorded-meld region.

## Impact

- **Code:** `packages/shared/src/variant/` (or a new `meld/`) — the Standard meld table data + its accessor by `meldTableId`. `packages/engine/src/meld/` — the new `MeldDetector` module. `packages/engine/src/state/state.ts` (`PublicState` gains recorded melds) and `state/reduce.ts` (the automatic `Melding` step on entering the phase). Consumes the existing `domain/` (`Card`, `Suit`, `Meld`, `MeldClass`, `makeMeld`, `Hand`, `cardsValueEqual`), `lifecycle/` (`nextActivePhase`), and the `VariantDefinition` / meld-table _types_ from `@meldrank/shared`. New/extended Vitest suites in both packages.
- **Dependencies:** none added — `@meldrank/engine` stays at zero runtime dependencies (the invariant test continues to hold); shared-package imports remain type-only.
- **Downstream:** completes the meld input so the eventual `HandScorer` can apply meld + captured counters and the "meld needs a trick" rule. Extends — does not reshape — the `reduce` / `Event` / `State` contract.
- **Design source of truth:** Linear "Game Engine — Abstract Model" (§2/§5, Ruling 1) and both canonical ranked ruleset docs (§6 Partners meld values + reuse rules; Cutthroat §7 inheriting the identical table, bidder-only). No spec-level decisions are introduced that those locked docs don't already establish.
