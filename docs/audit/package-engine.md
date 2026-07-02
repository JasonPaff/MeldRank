# Audit: packages/engine

## Summary

**Overall health: A-.** This is a genuinely well-built package: a pure, deterministic, event-sourced reducer with a clean public/private state split, no `any`, no TODO markers, no dead code, no IO, no Colyseus types, and thorough documentation. The headline issues are correctness gaps, not code rot: (1) the Cutthroat all-pass `redeal` outcome is a dead end — no consumer anywhere in the repo handles it, the reducer cannot process a re-deal from that state, and the stale auction sub-state allows the auction to be *resurrected by a bid after the redeal was signaled*; (2) the "zero runtime dependencies" invariant is quietly violated — `reduce.ts` value-imports `getMeldTable` from `@meldrank/shared/meld` while shared sits in `devDependencies`, and the guard test's regex misses subpath imports; (3) the MeldDetector's royal-marriage logic attributes the *wrong physical cards* to the meld, which corrupts the identity-based `no-melded` bury restriction. There are also two silently-stalling states (`Passing`-enabled variants and a `null` meld table) and no forced timeout move for `DeclareTrump`/`Bury`, so a disconnected bidder can hang a Cutthroat hand at the engine level.

## Current architecture

The engine is a dependency-free pure library consumed as source by `apps/match`, `apps/web`, `packages/bots`, and `packages/fairness`.

- `domain/` — plain data types + thin constructors: `Card` (with `copyIndex` identity vs. value equality), `Deck`, `Seat`, `Hand`, `Bid`/`Contract`, `Meld`, `Trick`, `ScorePad` (`card.ts`, `deck.ts`, `seat.ts`, `entities.ts`).
- `lifecycle/phases.ts` — the phase vocabulary, static legal-transition table, and variant-aware active-path resolver (optional `WidowReveal`/`Passing`/`Bury` phases).
- `state/` — the heart: serializable `State` (`variant` + `public` + `private` regions, `state.ts`), the closed `Event` union (5 player intents from `@meldrank/shared` + `deal`/`timeout` system events, `events.ts`), and the single driver `reduce(state, event)` (`reduce.ts`, 532 lines) which phase-guards every event and returns the same state on illegal input (typed rejection, no throws on the hot path).
- Phase drivers, each pure and independently testable: `dealer/` (mulberry32 seeded RNG + unbiased Fisher–Yates), `auction/`, `widow/`, `declare/`, `meld/` (MeldDetector against a declarative meld table), `bury/`, `play/` (LegalPlayValidator, TrickResolver, shared strength comparator), `score/` (HandScorer), `match/` (MatchScorer), `timeout/` (Ruling 5 forced move).
- `view/view.ts` — `viewFor(state, viewer)`: the per-seat hidden-information projection; hidden info is structurally unrepresentable in `FilteredView`.

Data flow: Match Runtime feeds intents/system events into `reduce`; a replay is a fold over the event log; `viewFor` projects per-seat views. Determinism and purity hold throughout — the only engine-side entropy is the injected seed.

## Strengths

- **Purity and determinism are real, not aspirational.** No IO, no `Date`, no `Math.random`, no network/Colyseus types anywhere in `src`. Replay determinism is directly tested (`src/integration.test.ts:170`, `:327`).
- **The hidden-information boundary is type-enforced**: `FilteredView` has no field capable of holding another seat's cards (`src/view/view.ts:41-55`), and `viewFor` never touches `private.widow`.
- **Module boundaries are crisp**: each phase driver is a small pure function returning a typed step (`AuctionStep`, `DeclareStep`), folded by the reducer. The bots package reuses `applyBid`/`applyPass`/`LegalPlayValidator` as legality oracles (`packages/bots/src/brain.ts:1`) — exactly the reuse the design intended.
- **Type discipline is excellent**: zero `any`, one justified `as unknown` in a JSON round-trip test; a compile-time exhaustiveness guard pins `EVENT_KINDS` to the `Event` union (`src/state/events.ts:47-52`).
- **The barrel files are curated** (named exports only, no `export *` below the root), and the RNG does unbiased rejection sampling (`src/dealer/rng.ts:31-40`) rather than naive `% n`.
- ~239 unit/integration tests, including full-match folds for both canonical variants and a JSON-serializability check.

## Findings

### [SEVERITY: High] Cutthroat all-pass `redeal` is a dead-end state, and the auction can be resurrected after it

- `src/state/reduce.ts:167-170` — on an all-pass redeal, the state keeps `phase: 'Auction'`, sets `outcome: 'redeal'`, `seatToAct: null`, but leaves `public.auction` **unchanged**: `auction.toAct` is still the seat that just passed and `auction.live` still shows it live (the live-flag update in `src/auction/auction.ts:117` is local to the returned `'continue'` branch).
- Consequence 1: that seat can now send a `bid`, which `applyAuctionEvent` (`src/state/reduce.ts:121-141`) validates against the stale `auction.toAct` (`src/auction/auction.ts:83`) and **accepts** — resurrecting a concluded auction, with `outcome: 'redeal'` never cleared for the rest of the match (it is only ever reset by `createInitialState`, `src/state/state.ts:172`).
- Consequence 2: the room cannot actually re-deal through the reducer — `reduce` in phase `Auction` rejects `deal` events (`src/state/reduce.ts:75-76`), so the documented flow ("the room re-deals with the same dealer and a fresh seed") has no legal event path.
- Consequence 3: **nothing consumes the signal.** `grep redeal apps/` returns zero hits — the Colyseus room (`apps/match/src/room/core.ts`) has no redeal handling, and the canonical Cutthroat variant uses `allPassRule: 'redeal'` (`packages/shared/src/variant/canonical.ts:114`). A four-pass Cutthroat auction in production stalls the room.
- Fix: on the `redeal` step, either (a) transition back to `Dealing` (add `Auction → Dealing` to the transition table or reset via a fresh per-hand base preserving match scope, mirroring `startNextHand`), so a `deal` event with a fresh seed is the legal continuation; or (b) at minimum null out `public.auction` so no further auction event can land, and add room-side handling. Add a test asserting post-redeal `bid`/`pass` are rejected and a `deal` restarts the hand.

### [SEVERITY: High] "Zero runtime dependencies" is violated: value import from `@meldrank/shared/meld`, declared only as a devDependency — and the guard test can't see it

- `src/state/reduce.ts:2` — `import { getMeldTable } from '@meldrank/shared/meld';` is a **value** import executed at runtime. The module itself is deliberately Zod-free plain data (`packages/shared/src/variant/meld-table.ts:9-15`), so this doesn't drag Zod in, but:
- `packages/engine/package.json` lists `@meldrank/shared` only under `devDependencies` while `exports` points consumers at raw `./src/index.ts`. This works today because every consumer is in-workspace, but it is a misdeclared runtime dependency that breaks the moment the engine is built/published standalone, and it contradicts the package's own headline claim (`src/index.ts:2-7`: "never Zod or any runtime import").
- `src/invariants.test.ts:43` — the guard regex `/\bfrom\s+['"]@meldrank\/shared['"]/` only matches the bare specifier, so the subpath import `@meldrank/shared/meld` sails through the "type-only imports" test. The invariant test passes while the invariant is false.
- Fix (pick one, deliberately): (a) move the meld table into the engine (it is game-rules data the MeldDetector interprets — arguably it belongs beside `meld/meld.ts`), and have shared re-export it if the web client needs it; or (b) keep the import, promote `@meldrank/shared` to `dependencies`, and rewrite the invariant test to allow only the `/meld` subpath as a value import. Either way, fix the regex to cover subpaths (`@meldrank\/shared(\/[\w-]+)?`).

### [SEVERITY: Medium] MeldDetector attributes the wrong physical cards to royal marriages, corrupting the `no-melded` bury restriction

- `src/meld/meld.ts:96-104` — after the run consumes each rank's copy 0 (`perRank.map(copies => copies[0])`, line 80), the royal-marriage loop selects `kTrump[Math.min(i, kTrump.length - 1)]`. For `i = 0` that is `kTrump[0]` — the exact physical card the run already used — even when a free second copy (`kTrump[1]`) exists and is what actually justifies the extra royal marriage.
- Point *totals* are correct (tests assert types/totals only, `src/meld/meld.test.ts:90-105`), but the recorded `Meld.cards` violate the within-class no-reuse rule and, more concretely, feed the identity-based `no-melded` bury check: `buryableCards` excludes by `cardsIdentical` against `meld.cards` (`src/bury/bury.ts:30-34`), so the *actually-melded* second copy remains buryable while the run's copy is doubly excluded. Masked in canonical Cutthroat only because `no-trump` independently bans all trump cards — any future variant with `no-melded` but not `no-trump` inherits the bug.
- Fix: index past the run's consumption — `kTrump[runCount + i]` / `qTrump[runCount + i]`, clamped only for the documented "borrow" case — and add a test asserting the royal marriage's `cards` carry `copyIndex` 1 when the run used `copyIndex` 0.

### [SEVERITY: Medium] Two silently-stalling states: `Passing`-enabled variants and a `null` meld table

- `src/state/reduce.ts:72-90` — the phase switch has no `Passing` arm, yet the lifecycle fully supports it (`src/lifecycle/phases.ts:16`, `:55-56`, `:77`). A variant with `passing.count > 0` advances from `DeclareTrump` to `Passing` (`src/state/reduce.ts:204-215`) and then rejects every event forever — a permanent stall with no error and no signal.
- `src/state/reduce.ts:231-234` — `getMeldTable` returning `null` (the reserved `standard-double-deck` id) leaves the state resting at `Melding`, which has no driving event: another silent permanent stall.
- Neither canonical variant hits these paths, but the engine accepts such variants without complaint. Fix: reject the configuration up front — `createInitialState` (or a small `assertVariantSupported`) should throw on `passing.count > 0` or an unresolvable `meldTableId` (configuration faults are the one place the engine already throws, per `src/dealer/deal.ts:55-59`), so an unplayable variant fails at match creation, not mid-hand.

### [SEVERITY: Medium] No forced timeout move for `DeclareTrump` or `Bury` — a disconnected bidder hangs the hand

- `src/timeout/timeout.ts:35-38` — `TimeoutMove` returns `null` for every phase except `Auction` and `TrickPlay`, explicitly including `DeclareTrump`, and implicitly `Bury`. `reduce` then leaves the state unchanged (`src/state/reduce.ts:68-71`).
- In Cutthroat, the bidder is on the clock at both `DeclareTrump` and `Bury` (`src/state/reduce.ts:248-249`). If that player never acts, no number of `timeout` events progresses the hand — the engine offers the room no recovery path, and there is no compensating forfeit/abandon event in the `Event` union. Rulings aside, operationally this is a hang.
- Fix: define deterministic forced moves (e.g. trump = the most-held suit or the first deck suit; bury = the `lowestValueCard` prefix of `buryableCards` — the total order in `src/timeout/timeout.ts:77-98` already exists) or add an explicit match-abandon event so the runtime has *some* engine-legal escape. Document whichever choice in the ruleset.

### [SEVERITY: Low] `reduce` discards rejection information

- Every phase driver produces a typed rejection (`'rejected'` in `AuctionStep`/`DeclareStep`), but `reduce` collapses everything to "same state back" (e.g. `src/state/reduce.ts:74`, `:145-147`, `:265-299`). Callers cannot distinguish an illegal move from a no-op without a reference-equality check, and get no reason code. For a competitive game, rejected intents are exactly the anti-cheat/telemetry signal you want, and the client can't render "why was my move refused".
- The pure-fold design is fine — but consider a parallel `explain(state, event)` helper or a `reduceWithVerdict` wrapper returning `{ state, rejected?: reason }`, keeping `reduce` itself unchanged for replay.

### [SEVERITY: Low] Hardcoded four-suit constant in MeldDetector bypasses the variant's deck spec

- `src/meld/meld.ts:25` — `const SUITS = ['spades', 'hearts', 'clubs', 'diamonds']` is used for non-trump marriages and arounds, while everything else in the engine reads `variant.deck.suits` (e.g. `src/state/reduce.ts:200`, `src/timeout/timeout.ts:59`). Harmless while `Suit` is a closed four-member union, but it's the only place the deck vocabulary is duplicated as a value; a deck-spec change would silently diverge. Fix: thread `deck.suits` into `MeldDetector` (it's already called from `reduce`, which has the variant).

### [SEVERITY: Low] Widow `visibility` axis is ignored

- The variant schema carries `dealing.widow.visibility: 'hidden' | 'exposed'` (`packages/shared/src/variant/canonical.ts:106`), but no engine file references `visibility` — `passThroughWidowReveal` always records the widow publicly in `revealedWidow` (`src/state/reduce.ts:180-191`). Correct for canonical Cutthroat (`exposed`) and moot for Partners (no widow), but a `hidden`-widow variant would leak the widow to the whole table. Either honor the axis or have the variant validator reject `visibility: 'hidden'` as unsupported.

### [SEVERITY: Low] Minor smells: PascalCase function names, invariant-bypassing score lines, masked-bug fallback, stale header doc

- Naming: `MeldDetector` (`src/meld/meld.ts:32`), `HandScorer` (`src/score/score.ts:55`), `MatchScorer` (`src/match/match.ts:63`), `TrickResolver` (`src/play/resolve.ts:14`), `TimeoutMove` (`src/timeout/timeout.ts:24`), `LegalPlayValidator` (`src/play/legal.ts:18`) are PascalCase functions (read as classes/components), while siblings are camelCase (`reduce`, `viewFor`, `declareTrump`, `buryableCards`, `revealWidow`). Cosmetic but pervasive in the public API; if renaming, do it once, now, before more consumers accrete (bots and match already import them).
- `src/score/score.ts:111-113` — set-penalty lines are built as object literals (`{ side, meld: 0, counters: 0, total: -contract.value }` and `{ ...earned, total: ... }`) that deliberately break `makeHandScoreLine`'s `total = meld + counters` invariant. Intentional, but undocumented at the type level; a one-line comment on `HandScoreLine` (or a `makePenaltyLine` helper) would prevent a future "fix" that re-derives `total`.
- `src/state/reduce.ts:323` — `enterTrickPlay` falls back to `contract?.seatIndex ?? 0`: a missing contract at trick entry is a bug, and silently seating seat 0 as leader would mask it. Prefer returning `state` unchanged (like every other guard) or asserting.
- `src/index.ts:15-16` — header says "The remaining phase logic (the HandScorer, the match-level scorepad) arrives in later changes", but both shipped (`src/score/score.ts`, `src/match/match.ts`). Also `ENGINE_VERSION = '0.0.0'` (`src/index.ts:19`) is exported and checked by `apps/bots` but never versioned — decide whether it means anything (replay compatibility stamps?) or drop it.
- Duplication is minimal and acceptable: the "count copies → double vs. single" pattern appears three times in the detector (`src/meld/meld.ts:71-84`, `:140-150`, `:157-172`) and could share a helper; `CardRef` (`packages/shared/src/intent/types.ts:26-30`) and `MeldTableClass` (`packages/shared/src/variant/meld-table.ts:22`) intentionally mirror engine types with documented rationale — fine as is.

## Test coverage assessment

Coverage is strong for a package this age: ~239 tests, every module has a dedicated test file, and the shape is right — unit tests per driver plus real integration folds (full Partners and Cutthroat hands, a 9-deal Cutthroat match to `MatchComplete`, replay-twice determinism at `src/integration.test.ts:170` and `:327`, JSON round-trip at `src/state/state.test.ts:27`, timeout forcing at both the module and reducer level, and a meaningful `viewFor` suite).

Gaps, in priority order:

1. **Post-redeal behavior** — `src/integration.test.ts:84` asserts the redeal signal appears, but nothing tests what happens *next* (the resurrection bug above lives exactly there).
2. **Meld card attribution** — meld tests assert `types()` and totals, never the physical `cards`/`copyIndex` composition (`src/meld/meld.test.ts:90-105`), so the royal-marriage misattribution is invisible.
3. **Unsupported-variant behavior** — no test for a `Passing`-enabled variant, a `hidden` widow, or a `null` meld table; all three currently stall or leak silently.
4. **The invariants test itself** — `src/invariants.test.ts:43` passes despite the value import it exists to catch; it needs a subpath-aware regex and a fixture-style negative test.
5. **Property-style testing** — the deal conservation and "legal set non-empty for non-empty hand" invariants are asserted only on fixed seeds; a small seed-sweep (even 100 seeds) over "hands+widow conserve the deck multiset" and "every reachable TrickPlay state has ≥1 legal play" would be cheap and high-value for a determinism-critical engine.

## Recommended action plan

1. **(S)** Fix the invariants-test regex to cover `@meldrank/shared/*` subpaths, and decide the meld-table dependency story (move table into engine, or declare the dependency) — Finding 2.
2. **(S)** Fix royal-marriage card attribution (`kTrump[runCount + i]`) + add a `cards`-level assertion — Finding 3.
3. **(S)** Null out `public.auction` on the redeal step and add tests that post-redeal `bid`/`pass` are rejected — the containment half of Finding 1.
4. **(S)** Make `createInitialState` reject unsupported variants (`passing.count > 0`, unresolvable `meldTableId`, `widow.visibility: 'hidden'`) — Findings 4 and 7 (rejection half).
5. **(S)** Remove the `?? 0` leader fallback in `enterTrickPlay`; refresh the stale `src/index.ts` header; decide `ENGINE_VERSION` semantics — Finding 9.
6. **(M)** Design and implement the full redeal flow: a legal engine path from the redeal signal back to `Dealing` with a fresh seed, plus room-side handling in `apps/match` (currently absent) — the completion half of Finding 1. This is the only item blocking correct Cutthroat production play.
7. **(M)** Define forced moves (or an abandon event) for `DeclareTrump` and `Bury` timeouts, with ruleset sign-off — Finding 5.
8. **(M)** Add a rejection-reason channel (`explain` helper or `reduceWithVerdict` wrapper) for anti-cheat telemetry and client UX — Finding 6.
9. **(M)** Seed-sweep property tests for deck conservation and legal-play non-emptiness — coverage gap 5.
10. **(L, optional)** Naming pass to camelCase the driver functions across engine + consumers (bots, match) in one atomic change — Finding 9. Defer if API churn is unwelcome; it is purely cosmetic.
