import { webEnvKeys } from '../../env/web';
import { apiEnv, botsEnv, commonEnv, matchEnv } from './schema';

/**
 * The union of every environment variable name the system declares, across all
 * processes (server + the public `apps/web` surface). This is the canonical set
 * that `.env.example` must agree with, so the documentation can never silently
 * drift from the schema.
 */
export function allEnvKeys(): string[] {
  const names = new Set<string>([
    ...Object.keys(commonEnv.shape),
    ...Object.keys(apiEnv.shape),
    ...Object.keys(matchEnv.shape),
    ...Object.keys(botsEnv.shape),
    ...webEnvKeys,
  ]);
  return [...names].sort();
}
