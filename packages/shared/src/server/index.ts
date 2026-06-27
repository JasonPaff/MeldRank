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
