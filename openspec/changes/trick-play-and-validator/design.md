## Context

`meld-detector` (archived) drove the lifecycle through `Melding`: a legal `declareTrump` records `public.trump`, the deterministic `Melding` pass-through records each melding seat's meld in `public.melds`, and `reduce` then rests at the variant's next active phase — `TrickPlay` for Partners, `Bury` for Cutthroat. There the lifecycle currently rests: `TrickPlay` has no driver and `playCard` is rejected by the phase guard's `default` case.

This change implements the **TrickPlay** phase: the **LegalPlayValidator** ("Game Engine — Abstract Model" §5, the second of the two highest-value engine pieces) and the **TrickResolver**. The domain layer already defines the trick vocabulary — `Trick { ledSuit, plays, winnerSeatIndex }`, `TrickPlay { seatIndex, card }`, and `makeTrick` — and `Card` carries `copyIndex`, with `cardsValueEqual` / `cardsIdentical` already separating value from identity. The variant schema already carries the trick rules (`trick: { mustFollowSuit, mustTrumpWhenVoid, mustBeat, identicalCardTie }`) and the counter values (`scoring.counters`, `scoring.lastTrickBonus`). The locked play rules are "Single-Deck Partners" §7.

Constraints carried in from the foundation: `reduce` stays pure/total/deterministic with typed rejection (no throw on the hot path); `State` stays plain and JSON-round-trippable with public/private separation; `@meldrank/engine` stays at **zero runtime dependencies** (`@meldrank/shared` imported type-only); the `Event` union is **closed** — `playCard` already exists in it, so no new event is introduced.

## Goals / Non-Goals

**Goals:**

- Implement a pure `LegalPlayValidator(hand, trick, trump, trickRules) → legal cards` encoding follow-suit, must-trump-when-void, and strict must-beat (must-head in-suit + over-trump on trump), with the leader (empty trick) free to play anything.
- Implement a pure `TrickResolver(trick, trump) → winning seat` (highest trump, else highest of the led suit, first-played-wins on identical cards), plus the per-trick captured counters.
- Share one card-strength comparator over the locked ranking `A > 10 > K > Q > J > 9` between both modules.
- Wire `TrickPlay` as a **resting, looping, player-driven** phase: validate each `playCard`, append to the current trick, resolve on completion, credit captured counters (and the last-trick bonus) to the winner, let the winner lead the next trick, and advance to `HandScoring` when hands empty.
- Exhaustive Vitest coverage (Partners-focused), preserving every foundation invariant.

**Non-Goals:**

- `HandScoring`, `MatchComplete`, the "meld counts only if the side wins a trick" gate (§8 ruling 6), made/set evaluation, and the scorepad update — a later change; TrickPlay records captured counters and tricks-taken; turning them (plus meld) into a hand result is HandScoring's call.
- `Bury` (Cutthroat's `Melding → Bury` frontier) and `Passing` (disabled by both ranked variants) — later/never for ranked.
- The `TimeoutMove` forced-move policy (Ruling 5: lowest-value legal card) — this validator makes it implementable, but its wiring is a later change; `timeout` during `TrickPlay` is not driven here.
- Side/team aggregation of counters — TrickPlay tallies per **seat**; folding seats into sides (and applying the meld-needs-a-trick gate) is HandScoring's job.
- Any `apps/match` / `apps/web` wiring, and any Zod runtime validation entering the engine.

## Decisions

### D1 — Both modules live in `packages/engine/src/play/`, mirroring `meld/`, `auction/`, `declare/`

Add `packages/engine/src/play/` exposing the pure `LegalPlayValidator` and `TrickResolver` (and the shared strength comparator), re-exported from the engine root. `reduce`'s `TrickPlay` case routes through them. This matches the established one-module-per-phase-driver layout.

- **Why:** keeps the two §5 trick modules co-located (they share the strength comparator and the trump/led-suit reasoning) and discoverable beside their peers.
- **Alternative considered:** split into `play/legal.ts` and `trick/resolve.ts` as separate top-level modules. Rejected — they are one phase's logic over one shared comparator; co-locating avoids a circular-ish dependency and a duplicated ranking table.

### D2 — One card-strength comparator over the locked ranking, trump- and led-suit-aware

Encode the ranking `A > 10 > K > Q > J > 9` once as an ordinal map, and a `trickStrength(card, trump, ledSuit)` that ranks a card **within a trick context**: a trump outranks any non-trump; among trumps and among led-suit cards, rank by the ordinal; a card that is neither trump nor led suit cannot win (it was a void discard). The comparator answers both "is this card higher than the current winner?" (must-beat) and "which play wins?" (resolve).

- **Why:** the must-head, over-trump, and winner-selection rules are all the same ordering question; one comparator keeps them provably consistent (a card the validator forces you to beat is exactly a card the resolver would rank above the current winner). The ranking is fixed by §2 of the ruleset, so it is a constant, not a variant axis.
- **Trade-off:** the comparator takes the trick context (trump + led suit) rather than being a bare card-vs-card order, because pinochle strength is only defined relative to a trick. Accepted — that context is exactly what both callers already hold.

### D3 — LegalPlayValidator: obligation cascade gated by the `TrickRules` flags

`LegalPlayValidator(hand, trick, trump, trickRules) → Card[]`. For an **empty** trick (the seat leads), every card is legal. Otherwise compute the legal set as a cascade, each step driven by its `TrickRules` flag so casual relaxations slot in without new code:

1. **Follow suit** (`mustFollowSuit`): if the seat holds cards of the led suit, the candidate set is restricted to them; **must-head** (`mustBeat`) then further restricts to those that beat the current winning card, if any such card exists, else all led-suit cards.
2. **Must trump when void** (`mustTrumpWhenVoid`): if void in the led suit but holding trump, the candidate set is the trumps; **over-trump** (`mustBeat`) restricts to trumps that beat the current winning card (when the current winner is itself trump) if any exist, else all trumps.
3. **Otherwise** (void in led suit, no trump, or the flags relax the above): any card is legal.

The result is always non-empty (a seat always has at least one legal card). The validator never mutates; it returns the subset of the hand's `Card[]`.

- **Why:** the cascade is the literal §7 text ("Follow suit if able. If void, must play trump. If neither, play anything," with strict must-beat layered on each able branch). Gating each step on the matching schema flag means the same function serves casual variants that relax must-beat or must-trump, per §3's "strict / relaxed" range, with no engine fork.
- **Alternative considered:** bake the strict ranked rules in and ignore the flags. Rejected — the flags already exist in the schema precisely to parameterize this; honoring them now is nearly free and avoids a later rewrite.

### D4 — TrickResolver: winner + captured counters from a completed trick

`TrickResolver(trick, trump) → winnerSeatIndex`, and a companion that totals the trick's captured **counters** from `scoring.counters` (A=11, 10=10, K=4, Q=3, J=2, 9=0). The winner is the play with the maximum `trickStrength`; on a tie of identical cards (`identicalCardTie: 'first-played-wins'`) the earlier play in `trick.plays` wins, which falls out naturally from a stable "strictly greater replaces" scan over plays in order. The resolver operates only on a complete trick (`plays.length === playerCount`).

- **Why:** highest-trump-else-highest-led-suit and first-played-wins are §7 verbatim; computing captured counters here keeps the counter total adjacent to the winner determination, the two facts HandScoring needs per trick.
- **Trade-off:** the last-trick **bonus** is not the resolver's concern (it depends on whether this is the final trick, a `reduce`-level fact). The resolver returns the per-trick counters; `reduce` adds the bonus on the final trick. Keeps the resolver a pure function of one trick.

### D5 — `TrickPlay` is a resting, looping, player-driven phase — unlike the transient `Melding`/`WidowReveal` pass-throughs

`Melding` and `WidowReveal` had no player event, so `reduce` applied them deterministically and passed through. `TrickPlay` is the opposite: it **rests** at `TrickPlay` and consumes repeated `playCard` intents. On a `playCard` while `phase === 'TrickPlay'`:

- reject unless the event seat is `seatToAct` and the referenced card is in that seat's hand and in the `LegalPlayValidator`'s legal set (typed rejection, state unchanged);
- remove the card from the seat's hand, append `{ seatIndex, card }` to `public.currentTrick` (setting `ledSuit` on the first play), and set `seatToAct` to the next seat clockwise;
- when the trick is complete (one play per seat), resolve the winner, credit the winner's seat with the trick's captured counters (plus `lastTrickBonus` if hands are now empty), increment the winner's tricks-taken, record the resolved trick, start a fresh empty `currentTrick`, and set `seatToAct` to the winner — who leads the next trick;
- when all hands are empty after a resolved trick, advance the phase to the next active phase (`HandScoring`) and clear `seatToAct`.

The first leader is set when entering `TrickPlay`: the bid winner (`public.contract.seatIndex`) leads the first trick. Because entry into `TrickPlay` happens inside the `Melding` pass-through (Partners) — and will happen after `Bury` for Cutthroat later — the leader and the initial empty trick are seeded at the moment the phase becomes the resting phase.

- **Why:** trick play is the one phase with a genuine per-card player decision and a self-loop in the §2 machine; modelling it as a resting phase that folds `playCard` events keeps `reduce` total and replay-faithful (the whole hand reconstructs from the ordered `playCard` log), exactly as the auction folds `bid`/`pass`.
- **Alternative considered:** resolve tricks lazily at `HandScoring` from the raw play log. Rejected — the winner-leads-next rule means each trick's resolution determines the next legal-play context, so resolution must happen inline; and a visible trick result is a game event the table must see as it happens.

### D6 — State additions: a public current trick, the resolved tricks, and a per-seat counter/trick tally

Extend `PublicState` with: `currentTrick: Trick` (the in-progress trick, empty between tricks), `completedTricks: readonly Trick[]` (each resolved trick with its `winnerSeatIndex`, for replay/render and the HandScoring fold), and a per-seat capture tally `captured: readonly SeatCapture[]` where each entry carries `seatIndex`, `counters` (running captured counter points incl. last-trick bonus), and `tricksTaken`. Initialize all three empty in `createInitialState`; `currentTrick` becomes a fresh `makeTrick()` when `TrickPlay` is entered.

- **Why:** the trick in progress and the resolved tricks are public (every play is face-up, §7); tallying captured counters and tricks-taken **per seat** (not per side) keeps TrickPlay agnostic of team structure — HandScoring folds seats into sides and applies the meld-needs-a-trick gate. All three fields are plain arrays/numbers, so `State` stays JSON-round-trippable.
- **Alternative considered:** tally counters directly by side/team here. Rejected — it pulls team-aggregation logic into TrickPlay that HandScoring must own anyway; per-seat is the lossless primitive both ranked and casual scoring derive from.

### D7 — `playCard` resolves a `CardRef` to a physical card by identity

`PlayCardIntent.card` is a `CardRef { rank, suit, copyIndex }` (the wire shape). `reduce` resolves it to the seat's physical `Card` by identity (`cardsIdentical`) — `copyIndex` disambiguates the two copies — and rejects if no such card is held. Legality is then checked against the `LegalPlayValidator` set by identity.

- **Why:** `copyIndex` exists precisely so the two identical copies are distinguishable on the wire and in hand; resolving by identity keeps the removed card unambiguous and the fold deterministic.

## Risks / Trade-offs

- **Trick correctness is product-critical (§5: "correctness here _is_ the product's integrity")** → A wrong legal set lets an illegal play through or forbids a legal one; a wrong winner mis-credits counters and corrupts the hand. Mitigation: exhaustive Vitest per legal-play branch and per resolution rule, plus full 12-trick playthroughs with hand-computed counter totals; treat §7 as the oracle.
- **Must-beat is the subtle rule** → must-head (in-suit) and over-trump (trump-on-trump) are distinct obligations and only bind "if able"; a naive implementation over- or under-constrains. Mitigation: derive both from the single `trickStrength` comparator and test the "able vs. not able" boundary for each (holding a beater vs. holding only lower cards).
- **Counters captured but not yet scored** → `captured` records raw counters even for a side that may be set or take no trick, which could be misread as final score. Mitigation: per-seat capture is an intermediate; made/set, the meld-needs-a-trick gate, and side aggregation are HandScoring's (later). Documented in Non-Goals.
- **`timeout` during TrickPlay is undriven** → a clock expiry in `TrickPlay` is not handled in this slice (the `default`/non-`playCard` path leaves state unchanged). Mitigation: acceptable — the deterministic `TimeoutMove` wiring (Ruling 5) is an explicit later change; this change delivers the `LegalPlayValidator` it depends on.

## Open Questions

- **`captured` shape (D6):** seat-indexed array vs. a record keyed by seat. Defaulting to a seat-indexed `SeatCapture[]` (every dealt seat present), matching the `SeatMeld[]` precedent; open to a ruling if HandScoring prefers a record.
- **Resolved-trick retention (D6):** keep every `completedTricks` entry for the whole hand vs. keep only counts/winners. Defaulting to retaining full tricks (faithful render + replay audit, 12 small objects); reversible if state size matters at the Colyseus boundary.
