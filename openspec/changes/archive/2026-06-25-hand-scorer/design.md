## Context

`trick-play-and-validator` (archived) drove the lifecycle through `TrickPlay`: each `playCard` is validated and folded into `public.currentTrick`, resolved tricks land in `public.completedTricks`, and a per-**seat** tally `public.captured` (each `SeatCapture { seatIndex, counters, tricksTaken }`, with the last-trick bonus already folded into `counters` on the final trick) accumulates as the hand plays out. When the last trick empties every hand, `resolveCompletedTrick` advances the phase to `HandScoring` and rests there with `seatToAct: null`. There the lifecycle currently rests: `HandScoring` has no driver and every event falls through `reduce`'s `default` rejection.

This change implements the **HandScorer** ("Game Engine — Abstract Model" §5) — the pure function that turns the raw per-seat tallies (`public.melds` + `public.captured`) plus the recorded contract into a per-side hand result and the made/set verdict, per "Single-Deck Partners" §8. The domain layer already defines the scoring vocabulary — `HandScoreLine { side, meld, counters, total }`, `makeHandScoreLine`, `ScorePad { hands, cumulative }`, `createScorePad`, and the pure `appendHand` — built ahead by `game-domain-model`. The variant schema already carries every scoring axis: `scoring.meldNeedsATrick`, `scoring.mode` (`all-sides-score` | `bidder-vs-bid`), `scoring.setPenalty` (`minus-bid-and-meld-lost` | `minus-bid`), and `seating.teams` (`free-for-all` | `partnerships` with seat-index groups). The locked rules are "Single-Deck Partners" §8 (and Ruling 6, meld-needs-a-trick).

Constraints carried in from the foundation: `reduce` stays pure/total/deterministic with typed rejection (no throw on the hot path); `State` stays plain and JSON-round-trippable with public/private separation; `@meldrank/engine` stays at **zero runtime dependencies** (`@meldrank/shared` imported type-only); the `Event` union is **closed** — `HandScoring` has no player event, so no new event is introduced.

## Goals / Non-Goals

**Goals:**

- Implement a pure `HandScorer(melds, captured, contract, buriedCounters, variant) → HandResult` that folds seats into sides, applies the meld-needs-a-trick gate, and evaluates the bidding side's made/set verdict and set penalty.
- Make the side-folding variant-driven via `seating.teams`, and the made/set + penalty + zero-defenders behaviour variant-driven via `scoring.mode` and `scoring.setPenalty`, so one function serves both ranked variants.
- Wire `HandScoring` as a deterministic pass-through computed at the moment `TrickPlay` empties the hands — record the `HandResult` and append its lines to a running `public.scorePad` — then rest at `HandScoring`.
- Exhaustive Vitest coverage (Partners-focused), with targeted `bidder-vs-bid` / free-for-all unit cases for the pure module, preserving every foundation invariant.

**Non-Goals:**

- The `MatchScorer`, the `HandScoring → (Dealing | MatchComplete)` branch, and the match-end condition / placement tiebreak (Ruling 2) — a later change; this change scores the hand and rests at `HandScoring`.
- `Bury` (Cutthroat's `Melding → Bury` frontier, whose buried counters feed `buriedCounters`) and `Passing` (disabled by both ranked variants) — later/never for ranked.
- Any `apps/match` / `apps/web` wiring (turning a `HandResult` into a UI or a persisted match record), and any Zod runtime validation entering the engine.

## Decisions

### D1 — The module lives in `packages/engine/src/score/`, mirroring `meld/`, `play/`, `auction/`

Add `packages/engine/src/score/` exposing the pure `HandScorer` and its `HandResult` shape, re-exported from the engine root. `reduce`'s `HandScoring` pass-through routes through it. This matches the established one-module-per-phase-driver layout (`MatchScorer` will later join it under `score/`).

- **Why:** keeps the §5 scoring modules co-located and discoverable beside their peers; `HandScorer` and the future `MatchScorer` share the `ScorePad` vocabulary.
- **Alternative considered:** fold the scoring math directly into `reduce`. Rejected — §5 names `HandScorer` as a distinct pure module with its own test surface, and keeping it pure (no `State` coupling) lets bots and the client reuse it.

### D2 — `HandScorer` signature mirrors §5: `(melds, captured, contract, buriedCounters, variant) → HandResult`

The pure function takes the recorded per-seat `SeatMeld[]` and `SeatCapture[]`, the `Contract` (bidding seat + value + trump), the `buriedCounters` credited to the bidder (Bury variants; `0` for Partners), and the `variant`. It returns a `HandResult` carrying the per-side `HandScoreLine[]`, the bidding `side` id, and a `made: boolean` verdict. It mutates nothing and is deterministic.

- **Why:** matches the documented §5 contract and keeps every input an already-recorded plain value, so `reduce` passes state slices straight in.
- **Trade-off:** `buriedCounters` is carried now though no wired variant uses it (Partners has no bury). Accepted — it is in the §5 signature and threading it now avoids reshaping the function when `Bury` is wired; callers on the Partners path pass `0`.

### D3 — Fold seats into sides via `seating.teams`

A **side** is a team id for `partnerships` (each partnership's seat-index group folds to one side; Partners: `[[0,2],[1,3]]` → sides keyed by the group) and the seat index itself for `free-for-all` (Cutthroat: each seat is its own side). The scorer sums each side's meld (over its seats' `SeatMeld.total`) and counters (over its seats' `SeatCapture.counters`), and a side "took a trick" if any of its seats has `tricksTaken > 0`. The bidding side is the side containing `contract.seatIndex`; buried counters are added to the bidding side's counters.

- **Why:** the side is the scoring unit in §8 ("a side counts its meld…", "the bidding side must reach its bid"); `seating.teams` is exactly the seat→side map and already distinguishes both ranked shapes.
- **Alternative considered:** assume two fixed partnerships. Rejected — it would not serve Cutthroat (3 free-for-all sides) and contradicts the one-engine principle.

### D4 — Meld-needs-a-trick gate is applied per side before the made/set check

When `scoring.meldNeedsATrick` is set, a side's counted meld is its summed meld value **only if** the side took at least one trick, else `0` (the counters, which a trickless side by definition has none of beyond a possible last-trick edge, are summed as-is). The gate is applied while building each `HandScoreLine`, so the bidding side's made/set check sees the gated meld — a bidding side that took no trick cannot "make" on meld alone.

- **Why:** §8 Ruling 6 ("meld voided if a side takes no trick") is a property of the side's line, and it must precede the made/set comparison because the gate changes whether the bid is reached.
- **Trade-off:** in practice the bidding side almost always takes a trick (it led the hand), but the gate is enforced unconditionally so the rule holds in the degenerate case and for non-bidding sides.

### D5 — Made/set, set penalty, and scoring mode are variant-driven

The bidding side is **made** when its (gated) `meld + counters ≥ contract.value`, else **set**. On a set, the bidding side's `HandScoreLine.total` is the penalty per `scoring.setPenalty`: `minus-bid-and-meld-lost` records `meld: 0, counters: 0, total: -value` (meld lost, −bid); `minus-bid` records `total: -value` keeping the line's meld/counters informational. The non-bidding side(s) score normally on a Partners (`all-sides-score`) made **or** set hand. Under `scoring.mode === 'bidder-vs-bid'` (Cutthroat), defenders' lines are forced to `total: 0` regardless of what they captured.

- **Why:** §8 is explicit — made: both sides score; set: bidding side scores nothing and −bid, opponents still score; and §3 distinguishes `all-sides-score` from `bidder-vs-bid`. Gating on the two enum axes keeps one function correct for both variants.
- **Alternative considered:** implement only the Partners path and branch later. Rejected — both axes are fully specified in the locked docs and the pure function is cheap to make complete; only the _wiring_ is reachable on the Partners path today.

### D6 — `HandScoring` is a deterministic pass-through, computed when `TrickPlay` empties the hands

Like `passThroughWidowReveal` and `passThroughMelding`, `HandScoring` has no driving player event. Rather than add a separate entry step, the score is computed inside the existing `TrickPlay` final-trick transition: when `resolveCompletedTrick` finds every hand empty and advances to `HandScoring`, it routes through a new `passThroughHandScoring` that calls `HandScorer`, writes `public.handResult`, and appends the result's lines to `public.scorePad` via `appendHand`. The lifecycle then **rests** at `HandScoring` — it does _not_ advance toward `Dealing`/`MatchComplete` (that branch is the `MatchScorer`'s).

- **Why:** mirrors the established transient-phase precedent and keeps the whole hand reconstructable from its event log; computing at the transition means the resting `HandScoring` state already carries the scored result for the table to render.
- **Alternative considered:** introduce a `scoreHand` system event. Rejected — it would widen the closed `Event` union for a step that is fully determined by state, unlike `deal`'s external seed.

### D7 — State additions: `handResult` and a running `scorePad`

Extend `PublicState` with `handResult: HandResult | null` (the scored per-side lines + made/set verdict for the just-finished hand; `null` until `HandScoring` computes it) and `scorePad: ScorePad` (the running per-hand lines + cumulative-by-side totals). Initialize `handResult: null` and `scorePad: createScorePad()` in `createInitialState`. Both are public — the table sees the hand result and the running score.

- **Why:** the hand result and the score pad are table-visible facts the per-seat filter passes through unchanged; keeping them in `PublicState` matches the public/private separation and gives the `MatchScorer` the pad it reads next.
- **Trade-off:** `scorePad` carries cumulative totals across hands inside a single-hand state object. Accepted — the pad is the natural home for cross-hand accumulation and `appendHand` already maintains it purely; a multi-hand match simply threads the same `scorePad` forward.

## Risks / Trade-offs

- **[Side-keying ambiguity between partnerships and free-for-all]** → `HandScoreLine.side` is documented as "a team id (partnership variants) or a seat index (free-for-all variants)" — already in the domain doc. The scorer derives the side key from `seating.teams` exactly, and tests assert both shapes, so the two interpretations never collide within one variant.
- **[Gating meld before vs. after the bid check]** → applying the meld-needs-a-trick gate _before_ the made/set comparison is load-bearing (it can turn a made hand into a set). D4 fixes the order and a dedicated scenario pins it.
- **[Carrying `buriedCounters` and `bidder-vs-bid` unreached by wiring]** → the pure module implements them and is unit-tested, but only the Partners path is wired, so dead-but-tested code could drift. Mitigated by unit tests that exercise both axes directly on the module, independent of `reduce`.
- **[`scorePad` accumulation semantics]** → this change appends exactly one hand's lines at `HandScoring`; multi-hand threading (resetting the per-hand `public` regions while carrying `scorePad`/`dealerSeat` forward) is the `MatchScorer`/next-hand change's responsibility and is explicitly out of scope here.

## Open Questions

- Should `HandResult` additionally carry the raw (pre-penalty) earned totals for replay/UI, or is the penalized `HandScoreLine` plus the `made` flag sufficient? Leaning sufficient — the UI can recompute earned totals from `melds` + `captured` if needed; revisit if the client design asks for it.
