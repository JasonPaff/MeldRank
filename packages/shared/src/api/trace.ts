/**
 * The cross-service trace-correlation convention (capability `structured-logging`,
 * design D4): the single `traceId` log field name and the `x-meldrank-trace-id` HTTP
 * propagation header, reserved once here and reused wherever the id is carried so no
 * service hardcodes a local literal. Browser-safe (plain strings, no driver) so a
 * future web origin can adopt the same constants without redefining them.
 *
 * Today the id is originated by `api` (per request) and carried across the one
 * service hop that exists — the internal spawn `POST` — onto the match room's logger.
 * Full request-scoped propagation and the web origin are deferred (design D4).
 */

/** The log field name a correlation id is bound under (`{ traceId }`). */
export const TRACE_ID_FIELD = 'traceId';

/** The HTTP header the correlation id propagates in across service hops. */
export const TRACE_ID_HEADER = 'x-meldrank-trace-id';
