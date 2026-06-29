import pino from 'pino';

/**
 * The single server-side structured logger for the Node services (`match`, `api`,
 * `bots`) — capability `structured-logging`, design D1/D2. `createLogger` returns a
 * `pino` logger bound with `{ service }`, so that field rides every line, and is
 * imported from `@meldrank/shared/server` the same way the db and redis clients are.
 * Pure packages (`engine`, `fairness`) never import this (design D5).
 *
 * Format and level are environment-driven: production emits newline-delimited JSON to
 * stdout (Fly-native, queryable), non-production pretty-prints via `pino-pretty`. The
 * level defaults to `info` in production and `debug` otherwise, overridden by the
 * passed `level` (sourced from the validated `LOG_LEVEL`). Pretty output is never used
 * in production. Known secrets are redacted once in the factory (D2a) so they can
 * never reach stdout even when a caller logs a whole env/options object.
 */

/** The recognized log levels, in descending severity (matches `pino`'s level names). */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** The structured logger type the services bind context onto via `.child(...)`. */
export type Logger = pino.Logger;

/** The service a logger is constructed for; bound as the `service` field. */
export type LogService = 'match' | 'api' | 'bots';

/** Factory options: the env-driven level and the (dev-only) pretty toggle. */
export interface CreateLoggerOptions {
  /** Minimum level to emit; from `LOG_LEVEL`. Defaults per environment when unset. */
  readonly level?: LogLevel;
  /** Pretty-print for local dev; ignored (forced off) in production. */
  readonly pretty?: boolean;
}

/**
 * The secret env/field names redacted in every logger (design D2a). Each is covered at
 * the top level and one level of nesting (`*.NAME`) so passing a whole env or options
 * object never leaks a value: the API↔Match seam secrets, the db/redis connection
 * strings and token, and a signed seat ticket (`ticket`).
 */
const REDACT_KEYS = [
  'SEAT_TICKET_SECRET',
  'INTERNAL_SPAWN_SECRET',
  'DATABASE_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'ticket',
] as const;

const REDACT_PATHS = REDACT_KEYS.flatMap((key) => [key, `*.${key}`]);

/**
 * Construct the base logger for a service. Binds `{ service }`, applies the env-driven
 * level (defaulting `info` in production, `debug` otherwise), configures redaction
 * once, and attaches the `pino-pretty` transport only outside production when `pretty`
 * is set. `destination` is a test-only seam: pass a stream to capture emitted lines —
 * production code omits it and the logger writes structured JSON to stdout.
 */
export function createLogger(
  service: LogService,
  opts: CreateLoggerOptions = {},
  destination?: pino.DestinationStream,
): Logger {
  const isProduction = process.env.NODE_ENV === 'production';
  const level = opts.level ?? (isProduction ? 'info' : 'debug');
  const pretty = opts.pretty === true && !isProduction;

  const options: pino.LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service },
    // A caller-supplied destination and a pretty transport are mutually exclusive in
    // pino; the destination seam is test-only and never combined with `pretty`.
    ...(pretty && destination === undefined ? { transport: { target: 'pino-pretty' } } : {}),
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}
