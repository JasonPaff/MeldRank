import { z } from 'zod';
import { parseEnv } from './load';

/**
 * Public environment contract for `apps/web`. Only `NEXT_PUBLIC_*` variables
 * live here: they are inlined into the client bundle and therefore must never
 * carry secrets. This schema is exported from the isomorphic root entry
 * (`@meldrank/shared`) — not the server-only entry — because `apps/web` cannot
 * reach `@meldrank/shared/server`.
 *
 * App URLs default to localhost so a build with no environment still succeeds;
 * the Clerk publishable key is optional until the Auth & Identity change wires
 * authentication.
 */
export const webEnv = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:3001'),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

export type WebEnv = z.infer<typeof webEnv>;

/** The variable names declared by {@link webEnv}; used by the example check. */
export const webEnvKeys = Object.keys(webEnv.shape);

/** Validate and return the typed, frozen public web environment. */
export function loadWebEnv(source: Record<string, string | undefined> = process.env): Readonly<WebEnv> {
  return parseEnv(webEnv, source);
}
