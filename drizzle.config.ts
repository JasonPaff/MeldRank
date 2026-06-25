import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for the workspace. The schema home lives in
 * `@meldrank/shared/server` and is empty until the Data Model change adds
 * tables; migrations are written to `./drizzle`.
 *
 * `db:generate` / `db:migrate` / `db:studio` (root scripts) read `DATABASE_URL`
 * from the environment — set it inline or via your shell, e.g.
 * `DATABASE_URL=... pnpm db:generate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/shared/src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
