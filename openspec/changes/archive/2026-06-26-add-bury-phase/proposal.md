## Why

`Bury` is the last unimplemented phase of the hand lifecycle ("Game Engine — Abstract Model" §2) and the only thing blocking a complete Single-Deck Cutthroat / Auction Pinochle hand. Everything around it is already in place: the variant schema carries the bury config and restrictions, `WidowReveal` folds the widow into the bidder's hand (leaving the bidder over-sized), `HandScorer` already accepts and credits `buriedCounters`, and `reduce` already rests Cutthroat at `Bury` after `Melding` — but it then rejects every event there ("`Bury` remains accepted by the type but rejected until implemented"). Implementing `Bury` closes the lifecycle: combined with the existing `MatchScorer` (fixed-deals / individual-placement), it makes a full 9-deal Cutthroat match playable end-to-end and completes the engine's "one engine, both canonical variants" claim.

## What Changes

- Add a pure bury-eligibility module to `@meldrank/engine` — `buryableCards(hand, melds, trump, restrictions) → Card[]` — encoding the "Single-Deck Cutthroat" §6 / Ruling 5 restrictions (`no-melded`, `no-trump`, `no-dix`), driven by the variant's `dealing.bury` axes so it serves any bury configuration.
- Add a new `bury` **player intent** (`{ type: 'bury', seat, cards: CardRef[] }`) to `@meldrank/shared` and the engine's `Event` union: the bidder selects exactly `bury.size` cards to discard face-down. This extends the four locked intents (`bid`, `pass`, `declareTrump`, `playCard`) — see design.md; "API Surface & Contracts" §4 needs a corresponding sync.
- Drive the `Bury` phase in `reduce`: on entering `Bury` (the bury-enabled path after `Melding`), the **bidder** is set to act; a valid `bury` from the bidder (exactly `bury.size` held, distinct, eligible cards) removes those cards from the bidder's hand into a buried pile and advances `Bury → TrickPlay`, seeding the trick loop; an invalid bury leaves the state unchanged.
- Track the buried pile in private `State` and credit its counters to the bidder at `HandScoring`: compute `buriedCounters` from the buried cards' counter values (per `variant.scoring.counters`) and pass it to `HandScorer` (the Partners path stays `0`).
- Make a full Cutthroat hand — and a full fixed-deals Cutthroat match — playable end-to-end as a deterministic fold over an event log.

## Capabilities

### New Capabilities

- `bury-validator`: the pure bury-eligibility rules — which cards the bidder may bury under the variant's `no-melded` / `no-trump` / `no-dix` restrictions, and what makes a proposed bury legal (exact size, all held, all eligible, no duplicates).

### Modified Capabilities

- `hand-state-container`: the closed `Event` union gains the `bury` intent; the phase guard now **accepts** a `bury` from the bidder at a resting `Bury` (replacing "rejected until implemented") and rejects it otherwise; lifecycle advancement gains the `Bury → TrickPlay` edge driven by the bury intent (seeding the trick loop) with `HandScoring` crediting buried counters; and the private state gains the buried pile.

## Impact

- **`packages/engine`** — new `src/bury/` module (`buryableCards`, exported via `index.ts`); changes to `src/state/reduce.ts` (drive `Bury`, set the bidder to act on entry, seed `TrickPlay` after a valid bury, supply real `buriedCounters` at `HandScoring`) and `src/state/state.ts` (a `private.buried` pile). Engine zero-runtime-dependency invariant preserved (consumes the `PlayerIntent`/`VariantDefinition` types only).
- **`packages/shared`** — a new `BuryIntent` added to the `PlayerIntent` union (`src/intent/types.ts`) and its barrel export. Types only; the matching Zod schema arrives with the Match Service boundary, as with the other intents.
- **Design docs (out of repo)** — "API Surface & Contracts" §4 enumerates four player intents; adding `bury` requires a doc sync. Flagged in design.md, not silently assumed.
- No breaking changes to existing engine functions: `reduce`'s signature is unchanged, the Partners path is untouched (no bury phase, `buriedCounters` stays `0`), and the only newly-accepted event is a `bury` at the `Bury` phase that previously rejected everything.
