## 1. Card-strength comparator (`@meldrank/engine`)

- [ ] 1.1 Add a `play/` module with a card-strength helper: encode the locked ranking `A > 10 > K > Q > J > 9` as an ordinal map, and a `trickStrength(card, trump, ledSuit)` that ranks a card within a trick context — trump outranks any non-trump; among trumps and among led-suit cards rank by the ordinal; a card neither trump nor led-suit cannot win (design D2)
- [ ] 1.2 Unit tests: trump beats non-trump regardless of rank; within a suit the ordinal order holds (A highest, 9 lowest); an off-led-suit non-trump ranks below every trump and every led-suit card

## 2. LegalPlayValidator module (`@meldrank/engine`)

- [ ] 2.1 Implement a pure `LegalPlayValidator(hand, trick, trump, trickRules) → Card[]` returning the legal subset of the hand; no input mutation, deterministic, zero runtime deps (design D3)
- [ ] 2.2 Empty trick (the seat leads): every card legal. Otherwise run the cascade gated by `trickRules` flags — follow led suit when able (`mustFollowSuit`); else must-trump-when-void (`mustTrumpWhenVoid`); else free discard
- [ ] 2.3 Strict must-beat (`mustBeat`): when following the led suit, restrict to led-suit cards that beat the current winner if any exist (must-head), else all led-suit cards; when the trick is won by a trump and the seat is void, restrict to trumps that beat the winning trump if any exist (over-trump), else all trumps
- [ ] 2.4 Guarantee the legal set is non-empty for a non-empty hand
- [ ] 2.5 Exhaustive Vitest: leader plays anything; must-follow when holding led suit; must-trump when void; free discard when void with no trump; must-head able vs. not-able boundary; over-trump able vs. not-able boundary; relaxed flags widen the set

## 3. TrickResolver module (`@meldrank/engine`)

- [ ] 3.1 Implement a pure `TrickResolver(trick, trump) → winnerSeatIndex` over a completed trick: highest trump wins; else highest of the led suit; off-suit non-trump cannot win; identical winning cards resolve to the first played via a strictly-greater-replaces scan over `trick.plays` in order (design D4)
- [ ] 3.2 Add the captured-counters helper: sum the per-rank `scoring.counters` values over the trick's cards (the last-trick bonus is not included here — `reduce` applies it on the final trick)
- [ ] 3.3 Exhaustive Vitest: highest-trump win; no-trump led-suit win; off-led-suit cards never win; identical-card tie → first played; counter totals for mixed tricks and a counter-less (all-9s) trick

## 4. State shape — trick & capture regions (`@meldrank/engine`)

- [ ] 4.1 Extend `PublicState` (`state/state.ts`) with `currentTrick: Trick`, `completedTricks: readonly Trick[]`, and a per-seat `captured: readonly SeatCapture[]` (each: `seatIndex`, `counters`, `tricksTaken`) — design D6
- [ ] 4.2 Initialize the three fields empty in `createInitialState` and confirm `State` stays plain and JSON-round-trippable (no `Map`/`Set`, no behavior)

## 5. TrickPlay loop wiring (`@meldrank/engine`)

- [ ] 5.1 On entering `TrickPlay` (the `Melding` pass-through's resting phase for Partners), seed the loop: set `seatToAct` to the contract (bid-winning) seat and `currentTrick` to a fresh empty trick (design D5)
- [ ] 5.2 Add the `TrickPlay` case to `reduce`: accept a `playCard` only from `seatToAct` naming a card resolved by identity (`cardsIdentical`, `copyIndex`-disambiguated) that is in the `LegalPlayValidator` legal set; otherwise reject unchanged (design D5, D7)
- [ ] 5.3 On an accepted play: remove the card from the seat's hand, append `{ seatIndex, card }` to `currentTrick` (set `ledSuit` on the first play), and advance `seatToAct` to the next seat in order
- [ ] 5.4 On trick completion (one play per seat): resolve the winner (`TrickResolver`), credit its captured counters (plus `lastTrickBonus` when all hands are now empty), increment its `tricksTaken`, push the resolved trick to `completedTricks`, start a fresh `currentTrick`, and set `seatToAct` to the winner
- [ ] 5.5 When all hands are empty after a resolved trick, advance the phase to the next active phase (`HandScoring`) and clear `seatToAct`; keep `Bury` / `HandScoring`-and-later events rejected
- [ ] 5.6 Unit tests: bid winner leads first; legal play accepted, illegal/out-of-turn rejected; winner leads next trick and is credited counters; last trick adds `lastTrickBonus`; phase rests at `TrickPlay` mid-hand and advances to `HandScoring` when hands empty

## 6. Wire-up & validation

- [ ] 6.1 Export the `play` public surface (`LegalPlayValidator`, `TrickResolver`, and the strength helper as appropriate) from `@meldrank/engine`'s root
- [ ] 6.2 Extend the integration test: a full Partners hand folds `deal → (auction) → declareTrump → (melding) → 12× playCard` to all hands empty, the per-seat capture tally, and the `HandScoring` phase marker; folding the same play log twice is deep-equal (replay determinism)
- [ ] 6.3 Confirm the zero-runtime-deps invariant still holds (engine `package.json` has no `dependencies`; `@meldrank/shared` imports remain type-only) — the existing invariant test must stay green
- [ ] 6.4 Run lint, typecheck, and the full Vitest suite via the validate agent and resolve any findings
