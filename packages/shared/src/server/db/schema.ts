/**
 * Drizzle schema home.
 *
 * Intentionally empty: this change establishes the persistence plumbing only.
 * The Data Model change adds the domain tables here. `drizzle.config.ts` and
 * {@link import('./client').createDb} both target this module, so adding tables
 * later needs no further wiring.
 */
export {};
