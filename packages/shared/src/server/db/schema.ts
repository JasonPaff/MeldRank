/**
 * Drizzle schema home — the single entry point targeted by `drizzle.config.ts`
 * and {@link import('./client').createDb}. Tables are defined in focused per-area
 * modules under `./schema/` (design D1) and re-exported here, so adding table
 * families across later Data Model slices needs no rewiring of the config/client.
 */
export * from './schema/enums';
export * from './schema/players';
export * from './schema/matches';
export * from './schema/hands';
export * from './schema/replays';
export * from './schema/abandon';
