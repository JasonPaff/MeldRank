/**
 * `@meldrank/bots` — the pure, in-process bot decision logic (capability
 * `bot-decision-policy`; Match Runtime — Design v1 §7 R5). It exposes a stable
 * `brain(view, ctx) → PlayerIntent` interface behind which v1 ships a random-legal
 * policy: enumerate the engine-legal moves over a seat's `FilteredView` and pick
 * one. The package depends only on `@meldrank/engine` (the single rules authority)
 * and `@meldrank/shared` (the variant ruleset) and performs zero IO, so it runs
 * unchanged in-process inside the Match Service today and inside a future extracted
 * Bot Worker with no change to the room protocol.
 */

export { brain } from './brain';
export type { BotContext, BotDifficulty, RandomSource } from './types';
