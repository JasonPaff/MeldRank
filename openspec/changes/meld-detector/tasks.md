## 1. Standard meld table (`@meldrank/shared`)

- [x] 1.1 Add the Standard single-deck meld table beside the variant schema (e.g. `variant/meld-table.ts`) as plain validated data: declarative meld definitions grouped by class with `type`, `class`, `value`, optional `double`, and a small tagged-union pattern kind (trump-run, marriage, dix, pinochle, around), per design D2
- [x] 1.2 Populate the canonical values from "Single-Deck Partners" §6 — Class A: Run 150 / Double Run 1500, Royal Marriage 40, Marriage 20, Dix 10; Class B: Pinochle 40 / Double Pinochle 300; Class C: Aces 100/1000, Kings 80/800, Queens 60/600, Jacks 40/400
- [x] 1.3 Add a `getMeldTable(meldTableId)` accessor that resolves `'standard-single-deck'` to the populated table and signals the reserved/deferred state for `'standard-double-deck'` (no populated set, §3 Ruling 3)
- [x] 1.4 Export the table type, the constant, and the accessor from the `@meldrank/shared` surface (consumable by the engine as data/types only — no runtime dep added)
- [x] 1.5 Unit tests: every Class A/B/C value matches the ruleset oracle; `getMeldTable('standard-single-deck')` returns the full table; the double-deck id is reserved, not populated

## 2. MeldDetector module (`@meldrank/engine`)

- [x] 2.1 Add a `meld/` module exposing a pure `MeldDetector(hand, trump, meldTable) → { melds, total }` (returns domain `Meld[]` via `makeMeld` + summed `total`); no input mutation, deterministic, zero runtime deps
- [x] 2.2 Class A detection (design D5): detect the trump Run first and consume its trump K–Q (no Royal Marriage from a Run's own K–Q); score remaining trump K–Q as Royal Marriage (40), non-trump K–Q as Marriage (20), each trump 9 as Dix (10); both Run copies → one Double Run (1500) instead of two singles
- [x] 2.3 Class B detection: Q♠+J♦ → Pinochle (40); both copies of each → one Double Pinochle (300) instead of two singles
- [x] 2.4 Class C detection: one of a named rank in all four suits → that "around" (single value); all eight copies → the double bonus instead of two singles
- [x] 2.5 Enforce reuse rules: each physical card (by `copyIndex`) consumed at most once **within** a class; classes computed independently so a card freely reuses **across** classes; sum per-class maxima into `total`
- [x] 2.6 Exhaustive Vitest: each meld type and value; trump-relative melds track the declared suit (Run/Royal Marriage/Dix); empty/no-meld hand scores 0; a Q♠ serving Marriage + Pinochle + Queens-around; within-class non-reuse; run-vs-royal-marriage (single trump K–Q vs. a second K/Q); double-vs-two-singles for run, pinochle, and arounds; known full-hand totals computed by hand

## 3. State shape — recorded melds (`@meldrank/engine`)

- [x] 3.1 Extend `PublicState` (`state/state.ts`) with a public recorded-meld region (seat-indexed, melding seats only — design D4): each entry carries the seat index, its `Meld[]`, and `total`
- [x] 3.2 Initialize the field in `createInitialState` (empty) and confirm `State` stays plain and JSON-round-trippable (no `Map`/`Set`, no behavior)

## 4. Melding transition wiring (`@meldrank/engine`)

- [x] 4.1 In the `declareTrump`-conclusion path of `reduce`, when the next active phase is `Melding`, determine melding seats from `variant.melding.whoMelds` (`all-seats` → every seat; `bidder-only` → the `public.contract` seat)
- [x] 4.2 Compute each melding seat's meld via `MeldDetector(hand, public.trump, getMeldTable(variant.melding.meldTableId))`, record it in `public.melds`, and continue advancing through `Melding` to the next resting phase (`Bury` for Cutthroat, `TrickPlay` for Partners), honoring each transition-table hop (design D3)
- [x] 4.3 Route `playCard` (and any `Bury`/`TrickPlay`-and-later event) to the not-yet-implemented guard so the wired slice is exactly `… → DeclareTrump → Melding → (ready for Bury/TrickPlay)`
- [x] 4.4 Unit tests: Partners declares trump → all four seats' melds recorded → rests at `TrickPlay`; Cutthroat declares trump → only the bidder's meld recorded → rests at `Bury`; illegal/out-of-phase events still rejected unchanged

## 5. Wire-up & validation

- [x] 5.1 Export the `meld` public surface (the `MeldDetector`) from `@meldrank/engine`'s root
- [x] 5.2 Extend the integration test: a full Partners hand folds `deal → (auction) → declareTrump` to recorded melds at every seat and the `TrickPlay` phase marker; a Cutthroat hand folds through to a bidder-only meld and the `Bury` marker; folding each event log twice is deep-equal (replay determinism)
- [x] 5.3 Confirm the zero-runtime-deps invariant still holds (engine `package.json` has no `dependencies`; `@meldrank/shared` imports remain type-only) — the existing invariant test must stay green
- [x] 5.4 Run lint, typecheck, and the full Vitest suite via the validate agent and resolve any findings
