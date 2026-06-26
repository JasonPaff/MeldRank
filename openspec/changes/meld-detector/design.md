## Context

`declare-trump-and-widow-reveal` (archived) drove the lifecycle to a declared trump: the auction records a won `Bid` on `public.contract`, an optional `WidowReveal` folds the exposed widow into the bidder's hand, and a legal `declareTrump` records `public.trump` and advances to `Melding`. There the lifecycle currently rests — `Melding` has no driver and `playCard` is rejected by the phase guard.

This change implements the **Melding** phase: the `MeldDetector` ("Game Engine — Abstract Model" §5, one of the two highest-value engine pieces) and the Standard meld table it scores against. The variant schema already references the table by id (`melding.meldTableId: 'standard-single-deck'`) but the values do not exist yet; the domain layer already defines `Meld { type, cards, value, class }`, `MeldClass = 'A' | 'B' | 'C'`, and `makeMeld`. Both canonical rulesets share the identical meld table; they differ only in `whoMelds` (Partners `all-seats`, Cutthroat `bidder-only`).

Constraints carried in from the foundation: `reduce` stays pure/total/deterministic with typed rejection (no throw on the hot path); `State` stays plain and JSON-round-trippable with public/private separation; `@meldrank/engine` stays at **zero runtime dependencies** (`@meldrank/shared` imported type-only); the `Event` union is **closed** — there is no `meld` intent, and meld is engine-computed, not chosen (§3 Ruling 1).

## Goals / Non-Goals

**Goals:**

- Add the Standard single-deck meld table (Class A/B/C values + double bonuses) to `@meldrank/shared`, resolvable from `meldTableId: 'standard-single-deck'`, consumed by the engine as data/types only.
- Implement a pure `MeldDetector(hand, trump, meldTable) → { melds, total }` computing the maximum legal meld with correct cross-class reuse, within-class non-reuse, the run-vs-royal-marriage rule, and double-vs-two-singles.
- Wire `Melding` as a deterministic transient transition (like `WidowReveal`): on entering `Melding`, compute each melding seat's meld, record it publicly, and advance to the next active phase (`Bury` for Cutthroat, `TrickPlay` for Partners).
- Exhaustive Vitest coverage (Partners-focused), preserving every foundation invariant.

**Non-Goals:**

- `HandScoring` and the "meld counts only if the side wins a trick" rule (§6 ruling 6) — a later change; the detector records the meld; whether it ultimately scores is HandScoring's call.
- `Bury`, `TrickPlay`, `Passing`, and the `playCard` driver — later changes (`Passing` is disabled by both ranked variants regardless).
- The `standard-double-deck` table values (§3 Ruling 3 keeps them reserved) and any casual/house meld tables.
- Any `apps/match` / `apps/web` wiring, and any Zod runtime validation entering the engine.

## Decisions

### D1 — The Standard meld table lives in `@meldrank/shared` as plain data, resolved by id

Add the table beside the variant schema (e.g. `packages/shared/src/variant/meld-table.ts`) as a plain, validated constant keyed by `meldTableId`, with an accessor `getMeldTable(id)`. The engine imports the table **type** and receives the data as a parameter (or reads the constant) without a runtime dependency, exactly as it consumes `VariantDefinition` today.

- **Why:** `@meldrank/shared` is the designated home of game data/Zod; the schema already declares `meldTableId`, so the values belong next to it. Passing the table into `MeldDetector` keeps the detector a pure function of its inputs (§5 signature `(hand, trump, meldTable)`) and testable in isolation.
- **Alternative considered:** hardcode the Standard values inside the engine. Rejected — it scatters the "what a game is" data away from the schema, blocks the future casual/double-deck tables from slotting in by id, and diverges from §5's explicit `meldTable` parameter.

### D2 — Meld table shape: declarative meld definitions grouped by class, not procedural detectors

Model the table as data the detector interprets: each entry names a meld `type`, its `class`, its point `value`, an optional `double` bonus value, and a structural pattern (which ranks/suits/copies it requires, and whether it is trump-relative). The detector is one interpreter over this data, not one bespoke function per meld.

- **Why:** keeps the values declarative and auditable against the ruleset doc, and lets a future double-deck/house table reuse the same interpreter. The set of _pattern kinds_ is small and closed (trump-run, marriage, dix, pinochle, around), so the interpreter stays bounded.
- **Trade-off:** a fully generic pattern language is overkill for five shapes. Mitigation: encode the five known pattern kinds as a small tagged union rather than a mini-DSL; the table supplies parameters, the detector knows the kinds.

### D3 — `Melding` is a deterministic transient transition, mirroring `WidowReveal` (D2 of the prior change)

The closed `Event` union has no event targeting `Melding`, so the engine cannot rest there. When `declareTrump` concludes and the next active phase is `Melding`, `reduce` computes melds in the same step and continues advancing to the next resting phase:

- determine the melding seats from `variant.melding.whoMelds` (`all-seats` → every seat; `bidder-only` → the `public.contract` seat);
- for each, run `MeldDetector(hand, public.trump, table)` and record `{ melds, total }` in a new public field;
- advance `DeclareTrump → Melding → Bury` (Cutthroat) or `→ TrickPlay` (Partners), honoring each transition-table hop; the resting phase is the one after `Melding`.

- **Why:** keeps `reduce` total over the closed union and fully deterministic/auditable; the rules-relevant fact (each seat's laid-down meld) lands in public state for Match Runtime to render and for HandScoring to consume, with no new event.
- **Alternative considered:** add a system `meld` event so the engine rests at `Melding`. Rejected — same reasoning as the widow reveal: it expands the locked union for a step with no player decision.

### D4 — Recorded melds are public, keyed by seat

Add `public.melds: readonly SeatMeld[]` (or a seat-indexed record) where each entry holds the seat index, its `Meld[]`, and `total`. Non-melding seats (Cutthroat defenders) get no entry (or an explicit empty/`null`), so the projection stays mechanical.

- **Why:** meld is laid face-up for the whole table (§6), so it is public, not per-seat private; recording it publicly keeps Match Runtime's per-seat filter a mechanical projection and makes the meld reconstructable from a replay fold.
- **Alternative considered:** store melds only transiently and recompute at scoring. Rejected — the laid meld is a visible game event players must see at melding time, and re-deriving at scoring risks drift; recording once is the auditable choice.

### D5 — Reuse algorithm: independent per-class selection, double-replaces-singles, run consumes its trump K–Q

Because a card may serve at most one meld per class and the three classes are independent, the maximum meld is the union of the best selection **within each class** computed independently:

- **Class A:** detect the trump Run first; a Run **consumes** its trump K and Q for marriage purposes (no Royal Marriage from a Run's own K–Q — a Royal Marriage needs a _second_ trump K or Q). Score remaining trump K–Q pairs as Royal Marriages (40) and non-trump K–Q pairs as Marriages (20); score each trump 9 as a Dix (10). Where both copies of the Run are present, score one Double Run (1500) instead of two single Runs.
- **Class B:** count Q♠/J♦ pinochle pairs; two pairs → one Double Pinochle (300) instead of two Pinochles.
- **Class C:** for each named rank, one-of-each-suit → an "around" (single value); all eight copies → the double bonus instead of two singles.

Within a class, each physical card (distinguished by `copyIndex`) is consumed at most once; across classes the same card is freely reused (the detector tracks consumption per class, independently).

- **Why:** the "one meld per class, reuse across classes" rule (§6) makes the classes separable, so the global maximum is the sum of per-class maxima — no cross-class search needed. The only intra-class subtleties (run-consumes-its-KQ, double-replaces-singles) are local to Class A and the doubleables.
- **Alternative considered:** a general constraint-solver/maximization over all melds at once. Rejected as unnecessary — the class-independence property makes a direct, provably-maximal construction possible, and direct code is far easier to test exhaustively (which §5 demands).

### D6 — Module layout mirrors `auction/`, `declare/`, `widow/`

Add `packages/engine/src/meld/` exposing the pure `MeldDetector` (and any small helpers), re-exported from the engine root. `reduce`'s `DeclareTrump`-conclusion path routes through it when advancing into `Melding`. The Standard table and its accessor live under `packages/shared/src/variant/`.

## Risks / Trade-offs

- **Meld correctness is product-critical (§5: "correctness here _is_ the product's integrity")** → A wrong value or missed reuse case silently corrupts every score. Mitigation: exhaustive Vitest per meld type, per reuse rule, and known full-hand totals computed by hand; treat the ruleset doc §6 tables as the oracle.
- **`Melding` is never the resting phase marker (same shape as `WidowReveal`)** → A consumer keying purely off `phase` won't observe `Melding`. Mitigation: melds are recorded in `public.melds`, so the beat is reconstructable from state and replay; document that runtimes render melding from that field.
- **"Meld needs a trick" not applied here** → `public.melds` records the full computed meld even for a side that may later take no trick, which could be misread as final score. Mitigation: the detector's output is the _laid_ meld; HandScoring (later change) applies the trick gate (§6 ruling 6). Documented in Non-Goals.
- **Double-deck table reserved but referenced by the enum** → `getMeldTable('standard-double-deck')` has no values. Mitigation: the accessor signals the reserved/deferred state (no populated set) rather than returning a partial table; no ranked variant uses it.

## Open Questions

- **Recorded-meld shape (D4):** seat-indexed array vs. record keyed by seat; and whether non-melding seats get an explicit empty entry or are simply absent. Defaulting to a seat-indexed array with melding seats only; open to a ruling if HandScoring prefers another shape.
- **Meld table location (D1):** `packages/shared/src/variant/meld-table.ts` beside the schema vs. a dedicated `packages/shared/src/meld/`. Defaulting to beside the variant schema since it is resolved by a schema field; reversible.
