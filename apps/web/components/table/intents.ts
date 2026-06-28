import type { PlayerIntent } from '@meldrank/shared';

/**
 * The intents the Partners table can emit. Structurally a subset of
 * `@meldrank/shared`'s {@link PlayerIntent}, with the `bury` variant excluded:
 * Single-Deck Partners never produces a bury, so the type makes that path
 * unreachable (task 4.4) rather than relying on a runtime guard.
 */
export type TableIntent = Extract<PlayerIntent, { type: 'bid' | 'declareTrump' | 'pass' | 'playCard' }>;
