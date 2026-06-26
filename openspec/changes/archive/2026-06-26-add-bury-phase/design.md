## Context

`Bury` is the last undriven phase of the §2 lifecycle, and the only one blocking a complete Single-Deck Cutthroat hand. The surrounding pieces already exist:

- The variant schema carries `dealing.bury = { size, restrictions }` with `BuryRestriction = 'no-melded' | 'no-trump' | 'no-dix'`; the canonical Cutthroat fixture sets `{ size: 3, restrictions: ['no-melded', 'no-trump', 'no-dix'] }`.
- `resolveActivePath` already includes `Bury` for bury-enabled variants, and the transition table has `Melding → Bury → TrickPlay`.
- `revealWidow` folds the 3-card widow into the bidder's hand at `WidowReveal`, so the Cutthroat bidder reaches `Bury` holding `handSize + widowSize` = 18 cards and must bury back down to 15.
- `passThroughMelding` computes the bidder's meld and, for Cutthroat, **rests at `Bury`** — but `reduce`'s `default` branch then rejects every event there ("`Bury` remains accepted by the type but rejected until implemented").
- `HandScorer(melds, captured, contract, buriedCounters, variant)` already credits `buriedCounters` to the bidding side; `reduce` passes `0` today.
- `enterTrickPlay` already seats the bidder (recorded contract seat) as the first-trick leader and zero-inits every dealt seat's capture tally — so it serves the Cutthroat post-bury entry unchanged.

What's missing is: a way for the bidder to **choose** the bury (a player decision, unlike engine-computed meld), the eligibility rules, the `Bury` driver in `reduce`, somewhere to keep the buried cards, and the real `buriedCounters` at scoring. Rules source: "Single-Deck Cutthroat / Auction Pinochle" §6 (bury + restrictions, Ruling 5) and §9 (buried counters count for the bidder).

## Goals / Non-Goals

**Goals:**

- A pure bury-eligibility module encoding the `no-melded` / `no-trump` / `no-dix` restrictions, variant-driven so it serves any bury config.
- Drive `Bury` in `reduce`: bidder on the clock at entry; a legal `bury` discards the cards and advances to a seeded `TrickPlay`; an illegal one is a no-op.
- Credit buried counters to the bidder at `HandScoring`.
- A full Cutthroat hand — and a full 9-deal fixed-deals Cutthroat match — playable end-to-end as a deterministic fold.
- Preserve the engine invariants (pure, non-mutating, deterministic, `State` JSON-round-trippable, zero runtime deps) and leave the Partners path untouched.

**Non-Goals:**

- A forced move for a `Bury` timeout — like the `DeclareTrump` gap from the `add-timeout-move` change, Ruling 5 does not specify a deterministic bury; flagged below. `buryableCards` gives bots/UI the eligible set, but no auto-bury is invented here.
- The Zod schema for the `bury` intent — types only, consistent with the other intents (the runtime schema lands with the Match Service boundary).
- `Passing` (still unused by both ranked variants) and double-deck bury values.

## Decisions

### D1 — New `bury` player intent (extends the locked four)

Add to `@meldrank/shared` (`src/intent/types.ts`):

```
interface BuryIntent {
  readonly type: 'bury';
  readonly seat: number;
  readonly cards: readonly CardRef[];   // exactly dealing.bury.size cards
}
type PlayerIntent = BidIntent | PassIntent | DeclareTrumpIntent | PlayCardIntent | BuryIntent;
```

and extend the engine `Event` union + `EVENT_KINDS` with `'bury'`. Bury is modeled as **one atomic intent carrying the whole bury set**, not N single-card discards: the bidder selects `bury.size` cards and confirms once, which matches the UI and keeps the phase a single accepted event.

_Why a new intent at all:_ unlike meld (engine-computed, Ruling 1), the bury is a genuine strategic choice that must arrive from the player — there is no way to drive `Bury` without a player input. `playCard` cannot be overloaded (it means "play to the trick" and is checked by `LegalPlayValidator`). This is the one place this change extends the four locked intents from "API Surface & Contracts" §4 — flagged in Open Questions for a doc sync. The mirror `CardRef[]` shape (as `playCard` uses `CardRef`) keeps it consistent and keeps replay a clean fold over intents.

### D2 — New `bury-validator` capability in `src/bury/`

A pure `buryableCards(hand, melds, trump, restrictions) → Card[]` in its own `src/bury/` folder with an `index.ts` re-export, mirroring `play/legal.ts`'s "return the legal subset" shape. It applies each active restriction:

- **`no-melded`** — exclude any card whose identity (rank + suit + `copyIndex`) matches a card in the bidder's recorded melds. By identity, so an _unused_ second copy of a melded value stays buryable.
- **`no-trump`** — exclude any card of the `trump` suit.
- **`no-dix`** — exclude the `9` of `trump` (the dix). Redundant with `no-trump` for the canonical set, but applied independently so a casual variant carrying only `no-dix` behaves correctly.

The melded-card set is the bidder's `SeatMeld.melds` flattened to their `cards` (reused across classes is fine — identity dedups). `reduce` composes legality from this set exactly as `applyPlayCard` composes from `LegalPlayValidator`: resolve each proposed `CardRef` to a held card by identity, then require count `=== bury.size`, no duplicates, and every resolved card present in `buryableCards`.

### D3 — The buried pile in private `State`

`PrivateState` gains `buried: readonly Card[]` (default `[]`, set in `createInitialState`), alongside `hands` and `widow`. The buried cards are face-down, so they live in private state where Match Runtime's per-seat filter governs visibility (the bidder may see their own discard; defenders see only that `bury.size` cards were buried — the count is derivable, so no public field is added). Keeping the actual cards (not a precomputed counter) means scoring recomputes from state and replay stays a faithful fold.

### D4 — Drive `Bury` in `reduce`

- **On entry** (`passThroughMelding`, bury-enabled path): currently returns the melded state resting at `Bury` with `seatToAct` still `null`. Change it to set `seatToAct` to the bidder (`contract.seatIndex`) so the bidder is on the clock. (Partners, which seeds `TrickPlay` here, is unchanged.)
- **`case 'Bury'`** in the top-level switch: `event.type === 'bury' ? applyBury(state, event) : state`.
- **`applyBury`**: reject unless `event.seat` is the bidder and the seat-to-act; resolve the proposed `CardRef[]` to held cards by identity; reject unless the proposed bury is legal per D2. On acceptance: remove the cards from the bidder's hand, set `private.buried`, advance along the legal `Bury → TrickPlay` edge via `nextActivePhase`, and call the existing `enterTrickPlay` to seat the bidder as leader with a fresh trick and zeroed capture tally.
- The `default` branch's "`Bury` … rejected until implemented" note is removed; `MatchComplete` remains the only terminal there.

### D5 — Buried counters at `HandScoring`

`passThroughHandScoring` computes `buriedCounters` from `state.private.buried` by summing each buried card's counter value (`variant.scoring.counters[rank]`) and passes it to `HandScorer` (replacing the hard-coded `0`). For the Partners path `private.buried` is empty, so the sum is `0` and behavior is identical. This keeps the §9 "buried counters count for the bidder as if won in tricks" rule in one place, and `HandScorer` already routes `buriedCounters` to the bidding side.

## Risks / Trade-offs

- **Extends the four locked player intents** → A real contract change ("API Surface & Contracts" §4). Unavoidable: `Bury` cannot be driven without a player input. Scoped to a single additive `bury` intent (no change to the existing four) and flagged for a doc sync; the Partners path never emits it.
- **`Bury` timeout has no forced move** → Same shape as the `DeclareTrump` gap from `add-timeout-move`: Ruling 5 doesn't specify a deterministic bury, so a stalled bidder at `Bury` has no engine-forced progression yet. Accepted; surfaced in Open Questions. `buryableCards` already exposes the eligible set, so a forced-bury policy can be added later with no structural change.
- **`no-dix` redundant with `no-trump`** → Applied independently anyway, so a casual variant that carries one without the other is correct; documented so the redundancy on the canonical set isn't mistaken for a bug.
- **Buried cards hidden but counter-bearing** → Stored as real cards in private state (not a precomputed number), so scoring and replay both recompute deterministically and Match Runtime controls visibility.

## Open Questions

- **Forced move for a `Bury` timeout (needs a ruling).** Out of scope here, mirroring the `DeclareTrump` open question. A sensible future baseline: auto-bury the `bury.size` **lowest-value** eligible cards (fewest counters surrendered), ties broken by the same fixed suit-then-`copyIndex` ordering `TimeoutMove` uses for `playCard` — a minimal, deterministic, non-self-defeating discard. Decide alongside the `DeclareTrump` timeout policy when "Match Runtime" §5 move-clocks are scheduled.
- **"API Surface & Contracts" §4 sync.** That doc enumerates four player intents; this change adds `bury`. The Linear doc should be updated to five and note `bury` is bury-variant-only (no ranked-Partners use). Engine-side it is purely additive.
