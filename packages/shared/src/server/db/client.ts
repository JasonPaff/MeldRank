import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/** Minimal env shape the Drizzle client needs — satisfied by every server env. */
export interface DatabaseEnv {
  DATABASE_URL: string;
}

/**
 * Construct a Drizzle client over the Neon serverless (HTTP) driver from the
 * validated environment. The HTTP driver is connection-pool-free, so the same
 * client works on Vercel serverless (`apps/api`) and the long-lived Fly service
 * (`apps/match`). The schema is empty until the Data Model change adds tables.
 *
 * Server-only: exported from `@meldrank/shared/server` so the Neon driver never
 * reaches the `apps/web` browser bundle.
 */
export function createDb(env: DatabaseEnv) {
  const sql = neon(env.DATABASE_URL);
  return drizzle({ client: sql, schema });
}

export type DatabaseClient = ReturnType<typeof createDb>;
