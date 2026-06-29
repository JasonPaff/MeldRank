import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './index';

/**
 * Shared logger factory tests (task 1.7, capability `structured-logging`): the
 * `service` binding rides every line, the level threshold is honored, a secret-bearing
 * object is redacted, and the `pino-pretty` transport is never enabled in production
 * (the line stays parseable JSON even when `pretty` is requested).
 *
 * Lines are captured through the factory's test-only `destination` stream seam; redact
 * and level still apply, so this exercises the real configured behavior.
 */

/** A capture stream plus the lines written to it. */
function captureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLogger — service binding', () => {
  it('binds the service name onto every emitted line', () => {
    const { stream, lines } = captureStream();
    createLogger('match', {}, stream).info('hello');
    expect(JSON.parse(lines[0]!)).toMatchObject({ service: 'match', msg: 'hello' });
  });
});

describe('createLogger — level threshold', () => {
  it('suppresses entries below the configured level', () => {
    const { stream, lines } = captureStream();
    const log = createLogger('api', { level: 'warn' }, stream);
    log.info('below threshold');
    log.warn('at threshold');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ msg: 'at threshold' });
  });
});

describe('createLogger — redaction', () => {
  it('redacts known secrets, including inside a nested object', () => {
    const { stream, lines } = captureStream();
    createLogger('api', {}, stream).info(
      { INTERNAL_SPAWN_SECRET: 'super-secret', env: { DATABASE_URL: 'postgres://u:p@h/db' }, ticket: 'signed.jwt' },
      'boot',
    );
    const entry = JSON.parse(lines[0]!);
    expect(entry.INTERNAL_SPAWN_SECRET).toBe('[REDACTED]');
    expect(entry.env.DATABASE_URL).toBe('[REDACTED]');
    expect(entry.ticket).toBe('[REDACTED]');
  });
});

describe('createLogger — production format', () => {
  it('defaults to info and never enables pretty (line stays parseable JSON)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { stream, lines } = captureStream();
    const log = createLogger('bots', { pretty: true }, stream);
    expect(log.level).toBe('info');
    log.info('boot');
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
    expect(JSON.parse(lines[0]!)).toMatchObject({ service: 'bots', msg: 'boot' });
  });
});
