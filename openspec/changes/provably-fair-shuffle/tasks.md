## 1. Module scaffold & dependency

- [x] 1.1 Create `packages/shared/src/fairness/` with an `index.ts` barrel; plan exports for commit, assembly, `Rng` derivation, reveal/verify, types, and schemas
- [x] 1.2 Add `@noble/hashes` at latest stable to `packages/shared` and confirm `sha256` imports and runs synchronously
- [x] 1.3 Import `type Rng` (and `deal` / deck builders for verification) from `@meldrank/engine`; confirm the workspace path alias resolves from `shared`

## 2. Canonical encodings & primitives

- [x] 2.1 Implement the domain-separated, length-prefixed canonical encoder for the seed-assembly input (server tag, hand nonce, fixed-seat-order contributions)
- [x] 2.2 Implement fixed big-endian uint32 extraction from a 32-byte digest block
- [x] 2.3 Add SHA-256 known-answer (published test vector) tests to pin the hash primitive

## 3. Commitment

- [x] 3.1 Implement `commit(serverSeed)` as domain-separated SHA-256 (`meldrank/commit/v1`)
- [x] 3.2 Tests: determinism, distinct-seeds-distinct-commits, seed not exposed in digest

## 4. Seed assembly

- [x] 4.1 Implement `assembleSeed(serverSeed, handNonce, contributions)` over the canonical encoding in fixed seat order
- [x] 4.2 Tests: determinism, every-input-affects-seed, arrival-order-independence, no-single-party-control

## 5. Rng derivation

- [x] 5.1 Implement the hash-stream DRBG `rngFromSeed(seed)` (`meldrank/rng/v1`, block counter, eight uint32 words per block) conforming to the engine `Rng` interface
- [x] 5.2 Tests: same-seed-same-stream, distinct-seed-distinct-stream, drives a real engine `deal` reproducibly, and a reachability/distribution check asserting the full seed is consumed (no 32-bit bottleneck, `createSeededRng` not on this path)

## 6. Missing-reveal fallback

- [x] 6.1 Implement the deterministic substitute `fallbackContribution(serverSeed, seat)` (`meldrank/fallback/v1`) and wire it into assembly for absent seats
- [x] 6.2 Tests: deterministic substitution, server gains no new control after commit, substituted hand still assembles/derives reproducibly

## 7. Reveal bundle, schemas & verify

- [x] 7.1 Define the reveal-bundle type and Zod schema (`handNonce`, `commit`, `serverSeed`, per-seat contributions with substitution markers, dealt-result digest)
- [x] 7.2 Implement the dealt-result digest over a canonical encoding of dealt hands + widow
- [x] 7.3 Implement `verify(bundle, deckSpec)`: recompute commit, reassemble seed, rebuild `Rng`, re-run `deal`, compare digest; return a typed success/failure result
- [x] 7.4 Tests: honest bundle verifies; tampered serverSeed rejected; tampered result digest rejected; replay-sufficiency from bundle + deck spec alone

## 8. Cross-cutting guarantees

- [x] 8.1 Test purity/isomorphism: inputs never mutated; identical results with no Node-only or browser-only crypto API used
- [x] 8.2 Test the uniform contribution interface (human vs bot contributions interchangeable, no participant-type branch)
- [x] 8.3 Export the public surface from `packages/shared/src/fairness/index.ts` and re-export from the `shared` package entry
- [x] 8.4 Run the validate agent (lint, typecheck, test) and resolve findings
