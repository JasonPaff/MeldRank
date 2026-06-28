/**
 * The single cross-origin policy shared by both serving entries. The API allows exactly
 * one configured browser origin (`WEB_APP_ORIGIN`, never `*`) so credentialed requests
 * stay valid, advertises the tRPC methods/headers, and short-circuits the `OPTIONS`
 * preflight. The standalone server applies these as `res` headers in its middleware; the
 * serverless function reflects the same map onto its `Response`.
 */

/** The HTTP status used to short-circuit a CORS preflight. */
export const CORS_PREFLIGHT_STATUS = 204;

/**
 * The CORS headers for the configured single origin. Keyed/valued identically to what
 * the standalone server set inline before this was extracted, so both paths are byte-for-byte
 * the same policy.
 */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
  };
}
