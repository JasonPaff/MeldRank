import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
