## Why

For a ranked pinochle ladder to be trustworthy, players must be able to verify that the deal was not rigged — that the server did not see the shuffle in advance, pick a favorable arrangement, or deal itself (or a colluder) a better hand. The engine was built for exactly this: the Dealer consumes an **injected** `Rng` stream and owns only the shuffle-and-slice algorithm, while "the _entropy_ (CSPRNG keying, commit–reveal) is supplied by Match Runtime … and stays out of the zero-dependency engine" (`packages/engine/src/dealer/rng.ts`; Match Runtime — Design v1 §8). That entropy layer does not yet exist. Building it now — as a pure, isomorphic, exhaustively-tested module before any Colyseus/networking lands — keeps the integrity primitive in the pure/tested lane and makes the eventual Match Service a thin orchestrator rather than the place a fairness flaw gets introduced.

## What Changes

- Add a pure **commit–reveal seed-assembly** module to `packages/shared` that produces the randomness feeding the Dealer's existing injected `Rng` seam — no networking, no Colyseus, no persistence.
- **Commit phase (pre-deal):** the server generates a secret `serverSeed` and publishes a binding `commit = H(serverSeed)` before any card is dealt, so it cannot change the seed after seeing contributions.
- **Contribution:** each seat (humans and bots, behind one interface) contributes a `clientSeed`; the final seed is `seed = mix(serverSeed, clientSeed₀, clientSeed₁, …)` so no single party — including the server — controls the outcome.
- **Rng factory:** derive a deterministic, full-width-keyed `Rng` (`nextUint32()` stream) from `seed`, suitable to pass straight into the engine's `deal(deckSpec, …, rng)`. This **avoids the 32-bit `createSeededRng` bottleneck** so all deck permutations remain reachable (a hash-stream DRBG, not a reduction to one 32-bit word).
- **Reveal + verify (post-hand):** publish `serverSeed` and all `clientSeed`s as a replay-sufficient bundle; provide a pure `verify(...)` that re-derives `seed`, rebuilds the `Rng`, re-runs `deal`, and confirms it reproduces the dealt hands and that `commit` matches `serverSeed`.
- **Missing-reveal fallback:** if a seat never reveals its contribution (e.g. disconnect), substitute server-only entropy for that seat's slot, **logged**, so the deal still verifies deterministically (Match Runtime — Design v1 §8/§11).
- **Isomorphic & dependency-light:** the same module runs in the Match Service (authority), the web client (the fair-deal verifier), and bots — so seed derivation/verification cannot depend on Node-only crypto.
- Exhaustive tests: determinism, server-can't-bias / no-single-party-control properties, commit binding, end-to-end verify against real `deal` output, and the missing-reveal fallback path.

## Capabilities

### New Capabilities

- `provably-fair-shuffle`: The commit–reveal entropy layer — seed commitment, multi-party seed assembly, the full-width `Rng` derivation that feeds the engine Dealer, and post-hand reveal/verification — making each ranked deal independently auditable.

### Modified Capabilities

<!-- None. This is purely additive and consumes the engine's already-specified Rng injection seam (dealer spec); it changes no existing requirement. -->

## Impact

- **Code**: New module in `packages/shared/src` (e.g. `fairness/`) exporting the commit/contribute/assemble/reveal/verify functions, the `Rng` factory, and the commit/reveal payload types/Zod schemas. Must stay isomorphic (Web Crypto / pure-JS hash, not Node-only `crypto`).
- **Consumes**: the engine Dealer's injected `Rng` interface and `deal` (`packages/engine`, `dealer` spec) — verification re-runs the real `deal`. No engine changes.
- **Consumers (later slices)**: `apps/match` (#2 `match-room-core`) orchestrates commit→contribute→deal→reveal and feeds the `Rng` to its authoritative engine instance; `apps/web` runs `verify`; `apps/bots` (#5) supplies bot contributions. Those wires are out of scope here.
- **Design docs**: Realizes Match Runtime — Design v1 §8 (provably-fair shuffle) and resolves its open items (hash/RNG primitives, missing-reveal fallback, bot entropy). The match-record reveal bundle is later persisted by slice #6.
- **No breaking changes**: purely additive.
