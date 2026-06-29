/**
 * Server-only surface of `@meldrank/shared` (`@meldrank/shared/server`).
 *
 * Everything that carries a runtime driver (Drizzle/Neon, Upstash) or reads
 * server secrets lives behind this entry. It MUST NOT be imported by
 * `apps/web`, which is reachable from the browser — an ESLint guard enforces
 * that boundary. See `packages/shared/README.md`.
 */
export { EnvValidationError, parseEnv } from '../env/load';
export * from './env/schema';
export * from './env/load';
export { allEnvKeys } from './env/keys';
export * from './db/client';
export * as dbSchema from './db/schema';
export * from './db/projector';
export * from './redis/client';
/** Server-only seat-ticket sign/verify helper (the payload schema is isomorphic, on the root). */
export { signSeatTicket, verifySeatTicket } from './api/ticket';
/** The shared structured logger factory (capability `structured-logging`, design D1/D2). */
export { createLogger, type Logger, type LogLevel, type LogService, type CreateLoggerOptions } from './log';
/**
 * The cross-service trace-correlation convention (design D4). Re-exported here so server
 * code reaches it from the same surface as the logger; also on the isomorphic root.
 */
export { TRACE_ID_FIELD, TRACE_ID_HEADER } from '../api/trace';
