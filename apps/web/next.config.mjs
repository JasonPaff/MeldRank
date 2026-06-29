import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Build-time guard for the web app's server-only secrets.
 *
 * The Clerk middleware (`middleware.ts`) calls `auth.protect()`, which needs
 * `CLERK_SECRET_KEY` at runtime. That secret is NOT a `NEXT_PUBLIC_*` variable,
 * so it is absent from the `webEnv` schema and nothing validates it during a
 * normal build — a deploy missing it builds green, then returns
 * `MIDDLEWARE_INVOCATION_FAILED` (HTTP 500) on every request with only Clerk's
 * generic "Missing secretKey" in the logs.
 *
 * Fail the build loudly instead. The check is scoped to real Vercel builds via
 * `process.env.VERCEL` (set on Vercel, never in GitHub Actions or local `next
 * build`), so CI's quality-gate build — which intentionally holds only the
 * public key, since it never deploys — and local builds are unaffected.
 */
const REQUIRED_SERVER_ENV = ['CLERK_SECRET_KEY'];
if (process.env.VERCEL) {
  const missing = REQUIRED_SERVER_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `apps/web is missing required server environment variable(s): ${missing.join(', ')}. ` +
        'The Clerk middleware needs these at runtime; without them every request returns ' +
        'HTTP 500 (MIDDLEWARE_INVOCATION_FAILED). Add them to the Vercel project environment ' +
        '(Production and Preview) and redeploy.',
    );
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Consume `@meldrank/shared` directly as TypeScript source (design D1).
  transpilePackages: ['@meldrank/shared'],
  // Pin the workspace root so Turbopack traces from the monorepo root rather
  // than guessing from a stray lockfile elsewhere on the machine.
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
