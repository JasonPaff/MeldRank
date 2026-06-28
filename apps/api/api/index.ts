import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { loadApiEnv } from '@meldrank/shared/server';
import { appRouter } from '../src/routers';
import { buildContext, createApiRuntime } from '../src/context';
import { corsHeaders, CORS_PREFLIGHT_STATUS } from '../src/cors';

/**
 * The **deployed** API surface: a Vercel serverless function serving the full tRPC
 * `appRouter` through the fetch adapter, so the API runs as a request/response function
 * rather than a long-lived `.listen()` process (the local-dev server in `src/index.ts`).
 *
 * The environment and runtime are constructed once at **module scope** (cold start) and
 * reused across warm invocations. `endpoint: ''` parses the procedure path straight from
 * the request pathname, matching how the standalone server serves tRPC at the origin root;
 * `apps/api/vercel.json` rewrites all paths to this function. CORS is the shared
 * single-origin policy: the `OPTIONS` preflight is short-circuited before the adapter, and
 * the `WEB_APP_ORIGIN` headers are reflected onto every response.
 */
const env = loadApiEnv();
const { deps } = createApiRuntime(env);
const cors = corsHeaders(env.WEB_APP_ORIGIN);

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: CORS_PREFLIGHT_STATUS, headers: cors });
  }

  return fetchRequestHandler({
    endpoint: '',
    req,
    router: appRouter,
    createContext: () => buildContext(deps, { headers: Object.fromEntries(req.headers) }),
    responseMeta: () => ({ headers: cors }),
  });
}
