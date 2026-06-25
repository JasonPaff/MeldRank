import { z } from 'zod';

/** Name of this package — handy as a smoke-test symbol for cross-package imports. */
export const PACKAGE_NAME = '@meldrank/shared';

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
