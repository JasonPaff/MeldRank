import { parseEnv } from '../../env/load';
import { apiEnv, botsEnv, matchEnv, type ApiEnv, type BotsEnv, type MatchEnv } from './schema';

/**
 * Per-process environment loaders. Each parses `process.env` once against its
 * schema and returns a typed, frozen config — or throws an aggregated
 * {@link import('../../env/load').EnvValidationError} naming every missing or
 * invalid variable. Call once at process boot, before serving work.
 */

/** Validate and return the typed, frozen environment for `apps/api`. */
export function loadApiEnv(
  source: Record<string, string | undefined> = process.env,
): Readonly<ApiEnv> {
  return parseEnv(apiEnv, source);
}

/** Validate and return the typed, frozen environment for `apps/match`. */
export function loadMatchEnv(
  source: Record<string, string | undefined> = process.env,
): Readonly<MatchEnv> {
  return parseEnv(matchEnv, source);
}

/** Validate and return the typed, frozen environment for `apps/bots`. */
export function loadBotsEnv(
  source: Record<string, string | undefined> = process.env,
): Readonly<BotsEnv> {
  return parseEnv(botsEnv, source);
}
