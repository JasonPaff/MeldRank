# MeldRank Hardening Audit — Overview

**Date:** 2026-07-01 · **Scope:** entire monorepo (4 packages, 4 apps, tooling, deps, CI/CD)
**Method:** 8 independent audit agents, one per area plus three cross-cutting sweeps (duplication, dependencies, monorepo architecture). Every finding in the linked reports carries `file:line` evidence.

Read this doc first; drill into the per-area reports for detail.

## Report index

| Report | Scope | Grade | Headline |
|---|---|---|---|
| [package-engine.md](package-engine.md) | packages/engine | A- | Clean pure engine; redeal dead-end + broken zero-deps invariant |
| [packages-shared-fairness-bots.md](packages-shared-fairness-bots.md) | shared / fairness / bots | B+ / A / A- | Fairness math is right but `verify()` has no production consumer |
| [app-match.md](app-match.md) | apps/match (Colyseus) | **C+** | Provably-fair shuffle bypass; zero client-message validation |
| [app-web.md](app-web.md) | apps/web (Next.js) | B+ | Zero tests; wire contract hand-duplicated from match |
| [app-api-and-bots.md](app-api-and-bots.md) | apps/api + apps/bots | B+ | Lobby store race; apps/bots is a deployed no-op |
| [cross-cutting-duplication.md](cross-cutting-duplication.md) | whole repo | — | Wire protocol duplicated with zero shared contract |
| [dependencies-and-libraries.md](dependencies-and-libraries.md) | whole repo | — | Deprecated base-ui RC; otherwise excellent dep hygiene |
| [monorepo-architecture.md](monorepo-architecture.md) | boundaries, CI/CD, tooling | B+ | Clean acyclic graph; prod images ship devDeps + run tsx |

## The verdict in one paragraph

The AI-built codebase is in genuinely good shape architecturally: the workspace graph is clean and acyclic, the engine is pure and deterministic with ~239 tests, the fairness package's crypto is correct (hash-DRBG, Fisher–Yates with rejection sampling, NIST vectors), auth/validation/env handling in the API is done right, and there is almost no dependency bloat or wheel-reinvention. The debt is concentrated, not smeared: **the match service's client-facing edge was never hardened** (no message validation, which cascades into a full fairness bypass), **the wire contract between web and match exists twice by hand instead of once in shared**, and **several "signal" paths (redeal, Cutthroat bury, reveal verification) are half-finished** — the engine or fairness layer emits something no downstream code consumes.

## Cross-cutting themes (found independently by multiple agents)

1. **The web↔match wire contract is the #1 structural gap** *(flagged by 3 agents).* All 8 Colyseus message names and every payload type are hand-written in both `apps/match/src/colyseus/matchRoom.ts` and `apps/web/lib/use-table-connection.ts`, inbound messages are cast without validation, and the engine `reduce` accepts its full `Event` union from clients. One new module — `packages/shared/src/match/wire.ts` with zod schemas for every message, parsed at the room boundary, imported by both sides — simultaneously fixes the fairness bypass vector, the missing validation, and the silent-drift risk.
2. **"Provably fair" is not yet an end-to-end property** *(2 agents).* A client can inject a chosen deal seed during the contribution window (match), and even absent that, `buildRevealBundle`/`verify` have zero production consumers — nothing persisted today is independently verifiable.
3. **Cutthroat/variant edge paths are half-built** *(3 agents).* Four-pass auction → redeal signal that nothing handles (engine); bots crash on Bury (packages/bots); no human move clock at DeclareTrump/Bury (match); unknown variant ids silently fall back to Partners (match). The common shape: a path the happy-path bot match never exercises.
4. **Production runtime shortcuts** *(3 agents).* All three Fly Dockerfiles ship the full workspace with devDependencies and run `tsx` over TS source — image bloat, slower cold starts on scale-to-zero, wider supply-chain surface, and it silently masks the engine's broken dependency declaration.
5. **`apps/bots` is vestigial** *(2 agents).* A 31-line stub that exits immediately, doesn't depend on `packages/bots` (the real brain runs in-process in apps/match), yet has a Fly app, secrets, and a CD matrix slot rebuilding on every shared/engine change.
6. **Engine's zero-runtime-deps invariant is broken and untested-for** *(2 agents).* `reduce.ts` value-imports from `@meldrank/shared/meld` while shared is a devDependency; the guard test's regex misses subpath imports.
7. **The test pyramid is missing its top** *(2 agents).* apps/web has zero tests (no test script — turbo silently skips it) and there is no e2e layer, while merges auto-deploy to production.

## Prioritized roadmap

### P0 — Correctness & trust (do before any new features)

| # | Item | Area | Size |
|---|---|---|---|
| 1 | Shared wire contract (`packages/shared/src/match/wire.ts`): zod schemas for all 8 messages, parse at room boundary, restrict client `intent` to `PlayerIntent` (never the system `Event` union), import types in web | shared, match, web | M |
| 2 | Close the shuffle-bypass window explicitly (reject `deal`/system events from clients even post-validation) + add `onUncaughtException` to the room | match | S |
| 3 | Fix lobby-store races: make `releaseSeat`/`markSpawning`/`markLive`/`rollbackToOpen` atomic (Lua) and status-aware | api | M |
| 4 | Idempotent match persistence (stable match id, not per-retry `randomUUID`; split DB write from Redis publish) + TTL/dispose for never-joined rooms | match | M |
| 5 | Engine redeal dead-end: conclude the auction sub-state on all-pass, define the redeal transition, handle it in match | engine, match | M |
| 6 | Cutthroat stalls: bot Bury support, human move clock at DeclareTrump/Bury, reject unsupported variant configs at creation | bots, match, engine | M |
| 7 | Wire the fairness loop shut: persist a real `RevealBundle`, make `verify()` total (no throws on hostile input), give it a consumer (audit endpoint or post-match check) | fairness, shared, match | M |

### P1 — Robustness & deployment

| # | Item | Area | Size |
|---|---|---|---|
| 8 | Real build step for Fly services: compile TS, prod-deps-only images (fixes cold starts + exposes the engine dep bug) | infra, all 3 services | M |
| 9 | `apps/bots` stays (decision 2026-07-01: in-process bots were an MVP shortcut; long-term bots run out-of-process in the bot service). Spec the bot-service integration; until it's real, optionally pause its CD matrix slot to stop no-op deploys | infra, bots | M |
| 10 | Fix engine→shared dependency: promote to runtime dep or inline the meld table; fix the invariant test regex to catch subpath imports | engine | S |
| 11 | Dep fixes: migrate `@base-ui-components/react` RC → `@base-ui/react` (2 files), bump Next 16.2.10, pnpm overrides for colyseus transitive vulns, drop `lucide-react`, web's `@meldrank/api` → devDependency | web, root | S |
| 12 | API robustness: spawn-fetch timeout, handle `user.deleted` webhook, FK indexes migration | api, drizzle | S |
| 13 | Web fixes: first-load Clerk token race, BidControls (stale initial state, NaN submit), handoff-state cleanup, variant lookup from spawn snapshot instead of hardcoded ternary | web, match | M |
| 14 | Single-source the drifting constants: reconnect grace, seat count, seat/lifecycle enums, `BotDifficulty` (and carry difficulty through the spawn seam) | shared + consumers | S |

### P2 — Hygiene & DX

| # | Item | Area | Size |
|---|---|---|---|
| 15 | Web test foundation (vitest + testing-library; start with `use-table-connection` reconnect machine and table-store derivation — both pure) and a minimal e2e smoke (create table → play a bot hand) | web | L |
| 16 | Split `build` vs `typecheck` in turbo (stop double type-checking CI) | tooling | S |
| 17 | pnpm catalog for the 6 hand-duplicated tool versions | root | S |
| 18 | Root `.env` loading for local dev (`--env-file` or dotenv in dev scripts) | tooling | S |
| 19 | Prune dead shared exports; fix stale doc comments; dedupe `SUIT_GLYPH`, `toHex`, page-shell JSX, engine deal orchestration (export rng-injectable `applyDealWithRng`) | shared, engine, web | M |
| 20 | Engine polish: meld royal-marriage attribution, timeout escape completeness, rejection-reason surfacing | engine | M |

## Decisions (2026-07-01, Jason)

1. **Packaging:** P0 lands as one OpenSpec change per cluster — (a) wire contract + seed-injection close (items 1–2), (b) lobby-store races (3), (c) idempotent persistence + room-leak TTL (4), (d) redeal + Cutthroat stall cluster (5–6), (e) fairness verification loop (7). Order: a → then by risk.
2. **apps/bots:** KEEP. In-process bots (packages/bots inside apps/match) were an MVP shortcut; the long-term design is bots playing through the out-of-process bot service. Roadmap item 9 becomes "integrate the bot service for real" rather than "retire".
3. **Prod runtime:** compile + prune — real tsc emit builds, multi-stage Dockerfiles, prod-deps-only images for all Fly services.
4. **Cutthroat:** fix the half-built paths now (redeal handling, bot Bury, DeclareTrump/Bury move clocks) rather than fencing off the variant.

## Verified healthy (checked — don't re-audit)

- Workspace graph: acyclic, shared is the leaf, no package→app imports, ESLint boundary guards enforced
- Fairness crypto: hash-DRBG correctness, domain separation, no `Math.random` in the entropy path, NIST-vector + tamper tests
- Auth: Clerk middleware (web), auth on every mutating API route, svix webhook verification, constant-time HMAC `onAuth` in match
- Types/contracts already single-sourced: Rank/Suit/Card, PlayerIntent, seat tickets, spawn seam, env schemas, tRPC contracts
- Dependency hygiene: one resolved version per shared lib in the lockfile, one unused dep total, zero phantom deps, full tsconfig strictness incl. `noUncheckedIndexedAccess`
- CI/CD: affected-only Fly deploys correct against the workspace graph, env-schema drift check in CI
- Code cleanliness: no `any`-casts or TODO/FIXME markers found anywhere in first-party source
