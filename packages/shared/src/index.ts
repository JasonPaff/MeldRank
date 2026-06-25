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
 * Placeholder schema that proves Zod is wired up and that `@meldrank/shared`
 * is the home for shared schemas. The real Variant Definition schema and the
 * rest of the shared types land in later changes.
 */
export const HealthSchema = z.object({
  service: z.string(),
  ok: z.boolean(),
});

export type Health = z.infer<typeof HealthSchema>;

/** Build a validated {@link Health} record for the given service. */
export function healthy(service: string): Health {
  return HealthSchema.parse({ service, ok: true });
}
