import { loadWebEnv } from '@meldrank/shared';

/**
 * Validated public environment for the web app — `NEXT_PUBLIC_*` variables only.
 *
 * Loaded from the isomorphic root entry (`@meldrank/shared`), never the
 * server-only surface, so no database or Redis driver enters the browser bundle.
 *
 * Each variable is passed as an explicit `process.env.NEXT_PUBLIC_*` member
 * expression: Next statically replaces those exact references at build time, so
 * the values are inlined into the client bundle. A bare `process.env` handed to
 * the loader would NOT be substituted in browser code and would silently fall
 * back to the schema defaults. App URLs default to localhost; the Clerk
 * publishable key is optional until the Auth & Identity change.
 */
export const env = loadWebEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_MATCH_URL: process.env.NEXT_PUBLIC_MATCH_URL,
});
