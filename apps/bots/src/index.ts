import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, LIFECYCLE_PHASES } from '@meldrank/engine';
import { healthy } from '@meldrank/shared';
import { createDb, createLogger, createRedis, loadBotsEnv } from '@meldrank/shared/server';

/**
 * Bot worker stub. Real bots will drive the Game Engine to play matches; for now
 * this entry starts cleanly, validates its environment, constructs the
 * foundation clients (no domain use yet), exercises both internal packages
 * (`@meldrank/engine` and `@meldrank/shared`), and exits.
 */
function main(): void {
  // Validate the environment once at boot (fail-fast), then construct clients.
  const env = loadBotsEnv();
  // Bind the worker identity onto the base logger (design D3). The id is per-process
  // for now; a stable assigned id waits for real scheduling (design open question).
  const log = createLogger('bots', { level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production' }).child({
    workerId: randomUUID(),
  });
  const db = createDb(env);
  const redis = createRedis(env);

  const status = healthy('bots');
  log.info({ ok: status.ok }, 'worker started');
  log.info({ engineVersion: ENGINE_VERSION, lifecyclePhases: LIFECYCLE_PHASES.length }, 'engine reachable');
  log.info({ db: !!db, redis: !!redis }, 'db + redis clients ready');
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
