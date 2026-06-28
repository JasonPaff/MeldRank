import type { VariantDefinition } from '@meldrank/shared';

/**
 * The bot brain's call contract (spec `bot-decision-policy`; Match Runtime —
 * Design v1 §7 R5). The types here are deliberately tiny and IO-free: a
 * {@link BotContext} plus a `FilteredView` is everything a decision needs, so the
 * brain is a pure function a future extracted Bot Worker can wrap unchanged.
 */

/**
 * The difficulty seam (Bots & AI — Design v1 §5). v1's random-legal policy treats
 * every tier identically; the selector exists so a later heuristic brain (Easy /
 * Medium / Hard) drops in behind the same {@link BotContext} with no change to the
 * room protocol or the brain's call site.
 */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/**
 * The injected randomness seam (design D5): a function returning a float in
 * `[0, 1)` like `Math.random`. Supplied through {@link BotContext} rather than
 * read from a global so the brain stays pure and exhaustively testable — the same
 * inputs and the same source always yield the same intent. Replay determinism does
 * **not** depend on reproducing this source: the room logs the bot's *emitted*
 * intents (capability `match-persistence`), so a match reconstructs from the log
 * regardless of how the bot chose.
 */
export type RandomSource = () => number;

/**
 * Everything the brain needs beyond the seat's `FilteredView` (design D5): the
 * acting `seat` (must equal the view's `viewer`), the `variant` the rules read from
 * (bidding grid, trick obligations, deck suits — all public, table-visible
 * configuration, never hidden information), the `difficulty` seam, and the injected
 * `random` source. A plain value object; the brain mutates nothing on it.
 */
export interface BotContext {
  /** The seat the brain decides for; must equal the filtered view's `viewer`. */
  readonly seat: number;
  /** The active variant — the public ruleset the engine legality functions read. */
  readonly variant: VariantDefinition;
  /** The difficulty tier; inert in v1 (uniform random across all tiers). */
  readonly difficulty: BotDifficulty;
  /** The injected randomness source, for purity and testability. */
  readonly random: RandomSource;
}
