import { describe, expect, it } from 'vitest';
import { EnvValidationError } from '../../env/load';
import { loadBotsEnv } from './load';

/**
 * `LOG_LEVEL` environment-key tests (task 2.3, spec: environment-config). The key is
 * optional on `commonEnv`, so it surfaces through every loader; `loadBotsEnv` (the
 * smallest required surface) exercises the three cases: unset is accepted and leaves
 * the logger to its default, a recognized value passes through, and an unrecognized
 * value fails validation fast at boot.
 */

/** A complete, valid bots environment minus `LOG_LEVEL`. */
const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@h/db',
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
} as const;

describe('LOG_LEVEL environment key', () => {
  it('accepts an unset LOG_LEVEL (logger applies its default)', () => {
    const env = loadBotsEnv({ ...baseEnv });
    expect(env.LOG_LEVEL).toBeUndefined();
  });

  it('accepts a recognized level', () => {
    const env = loadBotsEnv({ ...baseEnv, LOG_LEVEL: 'warn' });
    expect(env.LOG_LEVEL).toBe('warn');
  });

  it('fails fast on an unrecognized level', () => {
    expect(() => loadBotsEnv({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(EnvValidationError);
  });
});
