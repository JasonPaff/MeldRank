## Context

The engine Dealer (`packages/engine/src/dealer/`) shuffles via an **injected** `Rng` — an unsigned-32-bit-integer stream consumed by an unbiased Fisher–Yates (`boundedInt` rejection sampling). The engine deliberately owns only the *consumption* algorithm so a client can reproduce the exact permutation; the *entropy* "is supplied by Match Runtime / Anti-Cheat and stays out of the zero-dependency engine" (`rng.ts`; Match Runtime — Design v1 §8). `createSeededRng(seed: number)` exists only as the engine's deterministic replay-fold helper — a 32-bit mulberry32 — and is **not** the production entropy path.

This change builds that production entropy layer: a commit–reveal protocol that fixes the server's randomness *before* the deal, mixes in every seat's contribution so no single party controls the outcome, derives an `Rng` for `deal(...)`, and emits a replay-sufficient bundle anyone can use to re-derive and verify the deal afterward. It is the integrity keystone of the ranked ladder, so it ships pure, isomorphic, and exhaustively tested before any networking (slice #2 `match-room-core`) can obscure it. The Match Service orchestrates *when* commits/contributions/reveals happen across the wire; this slice is only the pure cryptographic core and its data shapes.

## Goals / Non-Goals

**Goals:**
- A pure, deterministic, **isomorphic** module in `packages/shared` for: server-seed commitment, multi-party seed assembly, an engine-compatible `Rng` derivation, and post-hand reveal/verification.
- The derived `Rng` keys off the **full-width** assembled seed (not a 32-bit reduction), so every deck permutation stays reachable.
- A replay-sufficient reveal bundle (with Zod schemas) such that a third party can recompute the seed, rebuild the `Rng`, re-run the real engine `deal`, and confirm the dealt hands — and confirm the published pre-deal commit binds the revealed `serverSeed`.
- A deterministic, logged **missing-reveal fallback** so a disconnected seat cannot stall or void verification.
- One contribution interface shared by humans and bots (bot entropy is not special-cased).
- Exhaustive tests: determinism, commit binding, no-single-party-control, end-to-end verify against `deal` output, fallback path, and hash test vectors.

**Non-Goals:**
- No networking, Colyseus schema, transport, or *orchestration* of when commit/contribute/reveal occur — that is `apps/match` (slice #2).
- No persistence of the reveal bundle — slice #6 (`match-persistence-and-result-emission`) owns durable storage; this slice only defines the bundle shape.
- No changes to `packages/engine` — it already exposes the `Rng` seam and `deal`.
- No rating, anti-cheat thresholds, or leaver penalties (separate docs); this only emits the auditable record they may consume.

## Decisions

**D1 — Live in `packages/shared` as a new `fairness/` module; depend on the engine `Rng` *type* only.**
Entropy is explicitly excluded from the zero-runtime-dependency engine, and the verifier must run in the browser client as well as the Match Service and bots — so it belongs in `shared`, not `engine`. The module imports `type Rng` from `@meldrank/engine` and produces values conforming to it; for verification it imports `deal`/`buildDeck` to re-run the real shuffle. Alternative considered: put it in `engine` — rejected, it would force a hash dependency into the zero-dep package and contradict the documented seam boundary.

**D2 — SHA-256 via the audited `@noble/hashes` library, used synchronously.**
The hash must be identical and synchronous in Node 22 and browsers. Web Crypto's `crypto.subtle.digest` is async, which would make the `Rng` stream and `verify` awkward and viral. `@noble/hashes` is audited, zero-dependency, isomorphic, tree-shakeable, and synchronous. Alternatives: hand-rolled SHA-256 (rejected — never roll your own crypto for an integrity feature) or Web Crypto (rejected — async ergonomics on a hot synchronous path). The module is otherwise dependency-light.

**D3 — Commitment, assembly, and the `Rng` are all domain-separated SHA-256 constructions.**
- `commit = H("meldrank/commit/v1" ‖ serverSeed)`, published before the deal.
- `seed = H("meldrank/seed/v1" ‖ handNonce ‖ serverSeed ‖ clientSeed₀ ‖ … ‖ clientSeedₙ)`, contributions concatenated in **fixed seat order** with length-prefixing so the encoding is unambiguous.
- The `Rng` is a hash-stream DRBG: block `k` = `H("meldrank/rng/v1" ‖ seed ‖ uint64(k))`; each 32-byte block yields eight big-endian uint32 words consumed in order, advancing `k` as the stream drains. This feeds `deal(deckSpec, handSize, widowSize, rng)` directly. Domain tags prevent any cross-use of one construction's output as another's input.

**D4 — Per-hand commit–reveal (decided 2026-06-26).**
A match is many independent deals. The server commits a **fresh `serverSeed` each hand**, seats contribute each hand, and the reveal happens per hand — so a revealed seed exposes only that one already-played deal, and `handNonce` (the hand's sequence number) is folded into the mix as defense-in-depth. Alternative considered: one match-level commit with `handNonce` expanding per-hand `Rng`s from a single seed — less chatty on the wire, but a single reveal would expose all *remaining* deals, forcing reveals to be withheld until match end and making mid-match verification impossible. Per-hand isolation was chosen over the reduced chattiness: each hand becomes independently auditable the moment it ends.

**D5 — `Rng` keys off the full 256-bit seed, deliberately bypassing `createSeededRng`.**
`createSeededRng` takes one 32-bit word; reducing the assembled seed to 32 bits would make only ~4×10⁹ deals reachable, astronomically fewer than the permutations of a pinochle deck — a real fairness defect. The DRBG in D3 consumes the whole 256-bit seed, so reachability is not bottlenecked. `createSeededRng` stays the engine's replay-fold helper and is not used on this path.

**D6 — Missing-reveal fallback: deterministic, committed-derived substitution, logged.**
If a seat never supplies a contribution (e.g. disconnect before deal), its slot is filled with `H("meldrank/fallback/v1" ‖ serverSeed ‖ uint32(seat))`. Because this derives solely from the **already-committed** `serverSeed`, the server gains *no new degree of freedom* by a seat going missing — it cannot grind outcomes, since its seed was fixed at commit time. The reveal bundle records each substituted seat so verification reproduces it exactly and auditors see it happened. Alternative considered: void/redeal the hand on any missing contribution — rejected as a trivial griefing/denial vector.

**D7 — Reveal bundle is a typed, Zod-validated, replay-sufficient value.**
`{ handNonce, commit, serverSeed, contributions: Array<{ seat, clientSeed | substituted: true }>, dealtHandsDigest }`. `verify` recomputes `commit` from `serverSeed`, reassembles `seed`, rebuilds the `Rng`, re-runs `deal`, and checks the result against `dealtHandsDigest` (a hash of the canonical dealt-hands+widow encoding). The bundle carries everything needed offline; persistence and transport are other slices' concerns.

**D8 — One contribution interface for humans and bots.**
A contribution is just a `clientSeed` (fixed-width random bytes) tagged with its seat; the assembler is agnostic to who produced it. Bots contribute through the identical path (relevant once slice #5 seats them). No branch on participant type.

**D9 — `clientSeed` is 32 bytes from `crypto.getRandomValues` (decided 2026-06-26).**
A 256-bit contribution matches the SHA-256 construction width and is symmetric with the `serverSeed`. `crypto.getRandomValues` is a synchronous CSPRNG available in every modern browser and in Node 22, so the contribution path needs no async ceremony and no environment-specific fallback. Alternative considered: 16 bytes — ample entropy but asymmetric with the 256-bit server seed for no real saving; rejected.

**D10 — The pre-deal `commit` is broadcast to all seats (decided 2026-06-26).**
Each hand's `commit` is published to every seat *before* the deal, so players hold the binding value before any card exists and verify `H(revealed serverSeed) == commit` themselves at reveal — the classic provably-fair trust story and its strongest "can't change it after the fact" guarantee. The pure core defines the commit and the ordering requirement (contributions only after the commit is published); the actual broadcast is the orchestrator's job in slice #2. Alternative considered: escrow the commit server-side and surface it only in the reveal bundle — simpler wire protocol, but trust shifts to the server's recorded ordering rather than a value players held pre-deal; rejected.

## Risks / Trade-offs

- **Server commits then substitutes for missing seats (D6)** → the substitute is a pure function of the *pre-committed* `serverSeed`, so the server cannot use a drop-out to bias the deal; the substitution is recorded and independently re-derivable.
- **Hash/library correctness is integrity-critical** → pin `@noble/hashes` at latest stable, lock construction strings/encodings in the spec, and test against published SHA-256 vectors plus golden end-to-end deals.
- **Client verifier must match server byte-for-byte** → a single shared isomorphic module is the only implementation; the canonical, length-prefixed, domain-separated encodings (D3) are specified so there is no ambiguity to diverge on. Endianness (big-endian uint32 extraction) is fixed in the spec.
- **`createSeededRng` misuse on the production path would reintroduce the 32-bit bottleneck** → the DRBG is the only production `Rng` source here; documented in D5 and asserted by a reachability/distribution test.
- **Contribution timing is a protocol property this slice does not enforce** → seats MUST contribute only after the server's `commit` is published; this slice specifies that ordering requirement and the orchestrator (slice #2) enforces it on the wire.

## Open Questions

All three prior open questions were resolved 2026-06-26:
- **Per-hand vs match-level commit** → per-hand commit–reveal (D4).
- **`clientSeed` width/source** → 32 bytes from `crypto.getRandomValues` (D9).
- **Commit broadcast vs escrow** → broadcast pre-deal to all seats (D10).

No open questions remain for the pure core. The wire-level realization of D10's broadcast and contribution ordering is carried forward to slice #2 (`match-room-core`).
