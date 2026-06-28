import { z } from 'zod';

/**
 * Isomorphic root surface of `@meldrank/shared` (`@meldrank/shared`).
 *
 * Safe for the browser: types, Zod schemas, and the public `NEXT_PUBLIC_*`
 * environment contract only — no runtime drivers or secrets. Server-only
 * plumbing (env loaders, db/redis clients) lives behind `@meldrank/shared/server`.
 */

/** Name of this package — handy as a smoke-test symbol for cross-package imports. */
export const PACKAGE_NAME = '@meldrank/shared';

/** Isomorphic env helpers: the generic loader and the public web contract. */
export { EnvValidationError, parseEnv } from './env/load';
export { webEnv, webEnvKeys, loadWebEnv, type WebEnv } from './env/web';

/**
 * Variant Definition: the schema that parameterizes a pinochle game, its
 * inferred type, the phase-gating predicates, and the two frozen canonical
 * ranked rulesets. This is the keystone that drives one engine across many
 * variants.
 */
export * from './variant';

/**
 * Player intent payload types — the locked "API Surface" §4 wire intents
 * (`bid`, `pass`, `declareTrump`, `playCard`) consumed type-only by the engine.
 */
export * from './intent';

/**
 * Match-record contracts: the durable {@link ReplayBlobV1} the match runtime writes
 * to `match_replays`, and the status-only {@link MatchResultEvent} it publishes over
 * Redis — the API↔Match wire contract.
 */
export * from './match';

/**
 * The isomorphic API contract surface (capability `shared-api-contracts`): the tRPC
 * procedure I/O schemas, the API↔Match room-spawn pair, the seat-ticket payload, the
 * ephemeral casual-table/seat/bot state shapes, and the cursor-pagination envelope +
 * typed error taxonomy. Browser-safe — the seat-ticket sign/verify helper is
 * server-only (`@meldrank/shared/server`).
 */
export * from './api';

/** Health-check record schema, used by the app services' liveness endpoints. */
export const HealthSchema = z.object({
  service: z.string(),
  ok: z.boolean(),
});

export type Health = z.infer<typeof HealthSchema>;

/** Build a validated {@link Health} record for the given service. */
export function healthy(service: string): Health {
  return HealthSchema.parse({ service, ok: true });
}
