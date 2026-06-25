import { loadWebEnv } from '@meldrank/shared';

/**
 * Validated public environment for the web app — `NEXT_PUBLIC_*` variables only.
 *
 * Loaded from the isomorphic root entry (`@meldrank/shared`), never the
 * server-only surface, so no database or Redis driver enters the browser
 * bundle. App URLs fall back to localhost; the Clerk publishable key is optional
 * until the Auth & Identity change.
 */
export const env = loadWebEnv();
