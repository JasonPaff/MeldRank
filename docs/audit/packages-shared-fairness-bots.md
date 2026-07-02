# Audit: packages/shared, packages/fairness, packages/bots

## Summary

**packages/fairness: A.** The commit-reveal shuffle layer is the best code in this scope — correct hash-DRBG construction keyed off the full 256-bit seed, domain-separated SHA-256 everywhere, length-prefixed canonical encodings, no `Math.random` anywhere in the entropy path, and an excellent test suite (NIST vectors, tamper rejection, purity proofs). Its only real problem is that its verification half (`buildRevealBundle`/`verify`) is **not wired into the product**: the match runtime persists a parallel, weaker reveal shape defined in `packages/shared`, so no stored artifact is directly verifiable today. **packages/bots: A-.** Tiny, pure, well-tested, correctly coupled to the engine's public legality functions only — but the difficulty seam is inert and its `BotDifficulty` type is a duplicate of a Zod enum in shared, and difficulty is silently dropped at the spawn seam. **packages/shared: B+.** It is a genuinely organized shared kernel (clean isomorphic-root vs `/server` split, per-domain folders, disciplined index files), not a junk drawer; its debt is a handful of dead exports, a few stale doc comments, and the reveal-shape duplication noted above.

## Current architecture

**packages/shared** (2 entry points + 1 subpath):
- `@meldrank/shared` (isomorphic root, `src/index.ts`): `variant/` (VariantDefinition Zod schema, two frozen canonical rulesets, variant content hash, meld table), `intent/` (hand-written player-intent wire types, deliberately Zod-free for the zero-dep engine), `match/` (ReplayBlobV1 + MatchResultEvent schemas), `api/` (tRPC procedure I/O schemas, casual-table/ticket/spawn contracts, error taxonomy, pagination, trace constants), `env/` (generic `parseEnv` + `NEXT_PUBLIC_*` web contract), plus `HealthSchema`.
- `@meldrank/shared/server` (`src/server/index.ts`): per-process env schemas/loaders, Drizzle/Neon client + full match-record Drizzle schema (7 tables, 7 pg enums), pure hand projector, Upstash Redis client, pino logger factory with secret redaction, HMAC seat-ticket sign/verify.
- `@meldrank/shared/meld`: direct path to `variant/meld-table.ts` so the engine reads the meld table without importing Zod.

**packages/fairness** (`src/index.ts`): `commit` → `assembleSeed` (+ `fallbackContribution`) → `rngFromSeed` → `buildRevealBundle` → `verify`, over `encoding.ts`/`hash.ts` primitives (domain tags, big-endian length-prefixed encodings). Depends on `@meldrank/engine` for `deal`; package graph `shared ← engine ← fairness ← apps` is acyclic (shared appears only as a devDependency for fixtures).

**packages/bots** (`src/index.ts`): a single pure `brain(view, ctx) → PlayerIntent` random-legal policy over three decision surfaces (auction, trump declaration, trick play), enumerating candidates through the engine's own legality functions (`applyBid`, `applyPass`, `declareTrump`, `LegalPlayValidator`). Depends only on engine + shared.

## Strengths

- Strict TypeScript across all three (`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Zero `any`, zero `as any`, zero `@ts-ignore`, zero TODO/FIXME in the ~4.6k lines audited (the single `@ts-expect-error` is a deliberate readonly-fixture test at `packages/shared/src/variant/canonical.test.ts:129`).
- The browser/server boundary in shared is real and enforced (exports map + documented ESLint guard, `packages/shared/README.md:29-35`), and secrets get defense-in-depth: server-only export surface for `signSeatTicket` plus pino redaction of the same keys (`src/server/log/index.ts:41-50`).
- Zod-schema-first discipline: nearly every wire type is `z.infer` of its schema — almost no hand-written types shadowing schemas (the exceptions are noted below and are all deliberate/minor).
- Fairness hot path is trust-correct: seeding is deterministic and full-width (`rng.ts:21-37`), the shuffle is Fisher–Yates with unbiased rejection sampling in the engine (`packages/engine/src/dealer/rng.ts:26-39`, `deal.ts:26`), seat contributions are order-independent and uniform for humans and bots, the missing-reveal fallback derives solely from the committed seed (`assemble.ts:24-26`), and the seat-ticket comparison is constant-time (`server/api/ticket.ts:40-49`).
- `.env.example` can never drift from the env schemas — pinned by test (`src/env-example.test.ts` + `server/env/keys.ts`).
- Canonical variant fixtures are schema-validated and deep-frozen at construction (`variant/canonical.ts:44-89`), so authoring mistakes fail at import time.

## Findings

### packages/shared

#### [SEVERITY: High] Durable reveal record is a weaker parallel of the fairness RevealBundle — stored replays are not independently verifiable

`ReplaySeedRevealSchema` (`src/match/replay.ts:56-61`) is what the match runtime actually persists (`apps/match/src/room/core.ts:803-807`), and it is a second, divergent encoding of the same concept as fairness's `RevealBundleSchema` (`packages/fairness/src/bundle.ts:45-59`). The persisted shape is missing the `dealtResultDigest` (so a verifier cannot detect a server that replayed a *different* deal than the one played), missing explicit `substituted` markers, and its `HexBytesSchema` (`replay.ts:22`, regex `^[0-9a-f]*$`) accepts empty and odd-length strings that `fromHex` would throw on. Meanwhile `buildRevealBundle`, `verify`, `RevealBundleSchema`, and `dealtResultDigest` have **zero consumers outside fairness's own tests** — the trust-critical verification path exists but nothing produced by the system can be fed to it. This matters because "provably fair" is the product claim: today a third party cannot run `verify()` against anything the system stores or emits.
**Fix:** make the fairness `RevealBundle` the persisted/emitted reveal shape (embed it verbatim in `ReplayBlobV1.reveals`, or have the room call `buildRevealBundle` per hand), and tighten `HexBytesSchema` to even-length/64-char where fixed-width. Size M.

#### [SEVERITY: Medium] Bot difficulty: duplicated type and dropped at the spawn seam

`BotDifficulty` exists twice — a Zod enum at `src/api/table.ts:17-19` and an independent TS union at `packages/bots/src/types.ts:16`. Two sources of truth for the same closed vocabulary will drift the moment a tier is added. Worse, the plumbing is lossy: `CasualAddBotInputSchema` accepts a difficulty (`src/api/procedures.ts:81-86`), the table seat stores it (`table.ts:31`), but `SpawnSeatSchema`'s bot variant carries **no difficulty** (`src/api/spawn.ts:17-20`), so the match service hardcodes `difficulty: 'medium'` (`apps/match/src/colyseus/matchRoom.ts:360`). The `bot_profiles.difficulty` column is also an unconstrained `text` (`src/server/db/schema/players.ts` bottom), not tied to the vocabulary.
**Fix:** have `packages/bots` import `type { BotDifficulty } from '@meldrank/shared'`; add `difficulty: BotDifficultySchema` to the bot arm of `SpawnSeatSchema` and thread it to `BotContext`. Size S.

#### [SEVERITY: Medium] Dead exports on the public surface

Confirmed unused outside `packages/shared` itself (grep across `apps/` and other packages):
- `pingRedis` (`src/server/redis/client.ts:27-30`) — zero call sites anywhere, including tests.
- `widowEnabled` / `buryEnabled` / `passingEnabled` (`src/variant/schema.ts:205-217`) — the engine derives phase gating itself; no consumer.
- `TRACE_ID_FIELD` (`src/api/trace.ts:14`) — only `TRACE_ID_HEADER` is used.
- `canonicalJson` (`src/variant/hash.ts:26`) — used only by `hashVariant` internally and its own test.
- `PACKAGE_NAME`, `HealthSchema` (`src/index.ts:12, 49`) — smoke-test-only symbols (`healthy` is used; the schema/constant are not).
- `MatchResultEventSchema` (`src/match/result-event.ts:25`) — the publisher publishes an unparsed typed object (`apps/match/src/persistence/writer.ts:93-94`) and no subscriber exists yet, so the schema is never executed at runtime.
Dead surface in a "contracts" package is actively misleading — a reader assumes each schema guards a boundary. **Fix:** delete `pingRedis` and the three predicates (or move predicates into the engine when it needs them); when the API-side result subscriber lands, `MatchResultEventSchema.parse` at that boundary. Size S.

#### [SEVERITY: Low] Stale doc comments that misdescribe the code

- `src/server/db/client.ts:14` — "The schema is empty until the Data Model change adds tables"; the schema has had 7 tables for several changes.
- `src/api/errors.ts:10-14` — claims `unauthorized` stays "reserved… for the Clerk-identity slice"; Clerk landed and `apiError('unauthorized')` is live in `apps/api`.
- `apps/web/lib/env.ts:13-14` (consumer of shared's `loadWebEnv`) — says the Clerk publishable key "is optional until the Auth & Identity change", but `src/env/web.ts:19` now requires it.
In an AI-built codebase the prose *is* the design record; letting it rot destroys its main value. **Fix:** one doc-sweep commit. Size S.

#### [SEVERITY: Low] Meld table exported from two paths

`STANDARD_SINGLE_DECK_MELD_TABLE`/`getMeldTable` are reachable both via the root (`src/variant/index.ts:56-65` → `src/index.ts` `export * from './variant'`) and via the `./meld` subpath (`package.json` exports → `src/variant/meld-table.ts`). The subpath exists so the engine avoids importing Zod; the root re-export undermines that intent by inviting other consumers to import it from either place (the engine's own test already uses the root). **Fix:** keep the subpath, drop the root re-export (or document that root is for apps, subpath for engine). Size S.

#### [SEVERITY: Low] Minor type/schema shadowing

- `Paginated<T>` (`src/api/pagination.ts:38-41`) is a hand-written interface shadowing `z.infer<ReturnType<typeof paginated>>`; it can drift from the `paginated()` envelope (readonly modifiers already differ). Acceptable for generic ergonomics but worth a comment linking the two, or derive it: `type Paginated<T> = { items: readonly T[]; nextCursor: string | null }` is only used in one app file.
- `CasualActionResultSchema.ticket` is `.nullable()` (`src/api/procedures.ts:58`) while `ActiveMatchSchema.ticket` is `.optional()` (`procedures.ts:109`) — two conventions for "maybe absent" on the same concept in the same file. Pick one. Size S.

Otherwise the package is coherent: the api/, match/, variant/, intent/, env/, server/ grouping maps 1:1 to real boundaries, and nothing currently in shared is used by only a single consumer in a way that argues for relocation (the api/ contract folder is legitimately two-sided: apps/api implements it, apps/web compiles against it, apps/match consumes the spawn/ticket halves). The one structural observation: `server/` is really a *platform* layer (db/redis/log/env) bolted onto a *contracts* package; if shared keeps growing, splitting `@meldrank/platform` out is the natural cut — but at ~2.9k lines it is not urgent.

### packages/fairness

#### [SEVERITY: Medium] `verify()` can throw instead of returning a typed failure

`verify` promises "a failed audit is an expected outcome, not an exceptional one" (`src/verify.ts:22-26`), but `replayDeal` (`verify.ts:36-47`) runs *before* any try/catch and can throw on schema-valid input: (a) `assembleSeed` calls `u32be(handNonce)` (`assemble.ts:77`) which throws `RangeError` for `handNonce ≥ 2^32`, yet `RevealBundleSchema` allows any nonnegative int (`bundle.ts:47`); (b) the engine `deal` throws when the `DealSpec` is inconsistent with the bundle's seat count (deck size ≠ hands×handSize+widow). A hostile bundle or wrong spec crashes the verifier instead of yielding `{ ok: false }`. **Fix:** constrain `handNonce` to `< 2^32` in the schema and wrap the replay in try/catch returning a new `'replay-failed'` reason. Size S.

#### [SEVERITY: Low] Verification order: commit check should precede the deal replay

`verify` re-runs the full shuffle before checking the cheap commit binding (`verify.ts:69-73`). Checking `commit(serverSeed) === bundle.commit` first fails fast on tampered bundles and avoids wasted work; it also makes the failure `reason` more precise (a bundle with a bad seed currently pays for a full deal before being rejected). Pure ordering change. Size S.

#### [SEVERITY: Low] `verify()` proves self-consistency, not binding to the broadcast commit — API footgun

`buildRevealBundle` *recomputes* the commit from the revealed seed (`src/build.ts:46`), so `verify`'s commit check is tautologically true for any bundle the server fabricates from scratch after the hand. Real binding requires the auditor to compare `bundle.commit` against the commit that was **broadcast before the deal** — which the API neither takes as a parameter nor mentions in `verify`'s docblock. A naive client verifier will call `verify()` and believe the deal proven. **Fix:** add an optional `expectedCommit` parameter (or a required one on a `verifyAgainstCommit` wrapper) and state the caveat in the `verify` doc. Size S.

Everything else checked out: domain separation is total (five versioned tags, all hashing through `domainHash`, `hash.ts:17-38`); encodings are length-prefixed so no field-boundary collisions (`encoding.ts:52-54`); the RNG stream is a counter-mode hash DRBG keyed on the whole seed with a 64-bit block counter (`rng.ts:21-37`); no `Math.random`, no Node/browser crypto in the hot path; inputs are never mutated. The commit-reveal design (server commit → per-seat contributions → deterministic fallback for absent seats) gives the server no post-commit degree of freedom, and the match app generates the server seed from `node:crypto randomBytes(32)` (`apps/match/src/colyseus/matchRoom.ts:96`) — correct.

### packages/bots

#### [SEVERITY: Medium] No Bury-phase support — bots cannot play the Cutthroat variant

`enumerateLegalIntents` returns `[]` for every phase except Auction/DeclareTrump/TrickPlay (`src/brain.ts:47-51`), and `brain` throws on an empty set (`brain.ts:25-27`). The comment says "the adapter never drives a bot in those phases on the Partners path" — a load-bearing assumption living in a comment, not a type or a guard. The moment a bot wins the auction at a Cutthroat table (`SINGLE_DECK_CUTTHROAT` has a 3-card bury), the room's bot driver will crash-loop or stall the match. Nothing in the API prevents adding a bot to a Cutthroat table. **Fix (near-term):** guard at the seam — refuse to spawn bots into bury-enabled variants until a bury policy exists (a random-legal bury is a small addition: any `bury.size`-subset respecting `BuryRestriction`). Size S for the guard, M for the policy.

#### [SEVERITY: Low] Difficulty seam is inert and its type is duplicated

`BotContext.difficulty` is accepted and ignored (`src/types.ts:16, 42`), and the type duplicates shared's Zod enum (see the shared finding). The extensibility story ("a future heuristic brain replaces the selection step behind this identical signature", `brain.ts:18`) is plausible but there is no internal seam for it yet — bidding candidates are hardcoded to `{pass, floor-bid}` (`brain.ts:70-74`), so a Hard bot that bids aggressively will rewrite `legalAuctionIntents`, not just the selection step. Fine for v1; just don't advertise the difficulty tiers in UI until they do something. Size — no action now, or S to import the shared type.

#### [SEVERITY: Low] `pick()` selection is float-based, not exactly uniform

`pick` maps a `[0,1)` float through `Math.floor(random() * n)` with clamping (`src/brain.ts:117-120`). For n ≤ ~dozens the bias is immeasurable and bot choice is not fairness-relevant (the room logs emitted intents, so replays don't depend on the source — documented at `types.ts:22-26`). Noting only for the record: if bots ever contribute to anything trust-adjacent, switch to an integer-based source. No action needed.

Coupling is correct: the brain touches only the engine's exported legality functions and the seat's `FilteredView` — no engine internals, no hidden state (verified: `view.own` and `view.public` only, `brain.ts:102-113`).

## Test coverage assessment

- **packages/fairness — excellent (8 test files ÷ 8 source files).** SHA-256 pinned to published FIPS vectors (`encoding.test.ts:5-20`); tamper-rejection matrix over serverSeed/clientSeed/digest/malformed bundles (`verify.test.ts:69-100`); full-width-seed proof (every one of 32 seed bytes affects the stream, `rng.test.ts:54-64`); purity/no-mutation/no-crypto-global cross-cutting suite (`cross-cutting.test.ts`); fallback-substitution equivalence (`fallback.test.ts:54-57`). Gap: nothing exercises the throw paths in `verify` identified above — add those with the fix.
- **packages/shared — good, boundary-shaped.** Variant fidelity tests pin every canonical axis; contract round-trips + seat-ticket sign/verify invariants (`api/contracts.test.ts`, including the "server-only surface not reachable from root" boundary test); `.env.example` drift test; logger redaction tests; pure projector tests; live-DB constraint tests properly `describe.skipIf`-gated (`server/db/match-record.db.test.ts:27`). Gaps: `createRedis`/`pingRedis` untested (moot if `pingRedis` is deleted); `loadWebEnv`/per-loader happy paths only lightly covered (`server/env/load.test.ts` covers LOG_LEVEL only); `MatchResultEventSchema` tested in isolation but never at a runtime boundary.
- **packages/bots — solid for its size (1 suite, 159 lines).** Covers all three decision surfaces against real engine states projected through `viewFor`, purity, seat mismatch rejection, forced-single-move, and hidden-info non-reference. Gaps: no test for the empty-legal-set throw, no test documenting the Bury-phase behavior (make the limitation executable), no difficulty test (nothing to test yet).

## Recommended action plan

Quick wins:
1. **[S]** Delete dead exports: `pingRedis`, `widowEnabled`/`buryEnabled`/`passingEnabled`, `TRACE_ID_FIELD` (or wire it), root re-export of the meld table; un-export `canonicalJson` if not needed publicly.
2. **[S]** Deduplicate `BotDifficulty`: bots imports the shared type; add `difficulty` to `SpawnSeatSchema`'s bot arm and thread it through the room to `BotContext`.
3. **[S]** Harden `verify()`: reorder commit check first, constrain `handNonce < 2^32` in `RevealBundleSchema`, try/catch the replay into a `'replay-failed'` reason, and document (or parameterize) the expected-commit binding.
4. **[S]** Guard bot seating against bury-enabled variants at the API/spawn seam until a bury policy ships.
5. **[S]** Doc sweep for the stale comments (`db/client.ts:14`, `api/errors.ts:10-14`, `apps/web/lib/env.ts:13`).
6. **[S]** Tighten `HexBytesSchema` in `match/replay.ts` (even-length; 64-char where fixed-width).

Bigger refactors:
7. **[M]** Unify the reveal record: persist the fairness `RevealBundle` (with `dealtResultDigest` and `substituted` markers) inside `ReplayBlobV1` and make it the shape any future verifier consumes — this is the piece that turns "provably fair" from a design doc into a checkable artifact. Pair with an end-to-end test: play a hand in the room, extract the stored reveal, run `fairness.verify` against it.
8. **[M]** Random-legal Bury policy in `packages/bots` (subset enumeration respecting `BuryRestriction`), unlocking Cutthroat bots and removing finding #4's guard.
9. **[M/L, optional]** If `packages/shared` keeps growing, split the `server/` platform layer (db/redis/log/env loaders) into `@meldrank/platform`, leaving shared as pure contracts + domain vocabulary. Not urgent at current size.
10. **[S]** When the API-side match-result subscriber lands, `MatchResultEventSchema.parse` at that boundary so the schema actually guards the wire.
