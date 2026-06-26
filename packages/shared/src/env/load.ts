import type { z } from 'zod';

/**
 * Raised when `process.env` fails validation against an environment schema.
 * Aggregates every offending variable into a single, readable message so a
 * misconfigured process reports all its problems at once rather than one
 * failed boot at a time.
 */
export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse a source of raw environment values against `schema`, returning a typed,
 * frozen result. On any missing or invalid variable, throws an
 * {@link EnvValidationError} that names every offending variable — never a
 * partial object. Consumers read configuration from the returned object rather
 * than from `process.env` directly.
 *
 * Pure Zod with no runtime drivers, so it is safe on the isomorphic surface and
 * is reused by the server-only loaders.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined> = process.env,
): Readonly<z.infer<TSchema>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `${name}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return Object.freeze(result.data);
}
