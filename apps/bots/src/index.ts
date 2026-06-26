import { ENGINE_VERSION, LIFECYCLE_PHASES } from '@meldrank/engine';
import { healthy } from '@meldrank/shared';
import { createDb, createRedis, loadBotsEnv } from '@meldrank/shared/server';

/**
 * Bot worker stub. Real bots will drive the Game Engine to play matches; for now
 * this entry starts cleanly, validates its environment, constructs the
 * foundation clients (no domain use yet), exercises both internal packages
 * (`@meldrank/engine` and `@meldrank/shared`), and exits.
 */
function main(): void {
  // Validate the environment once at boot (fail-fast), then construct clients.
  const env = loadBotsEnv();
  const db = createDb(env);
  const redis = createRedis(env);

  const status = healthy('bots');
  console.log(`[bots] worker started: ${status.service} is ${status.ok ? 'ok' : 'down'}`);
  console.log(`[bots] engine reachable: v${ENGINE_VERSION}, ${LIFECYCLE_PHASES.length} lifecycle phases`);
  console.log(`[bots] db + redis clients ready: ${!!db && !!redis}`);
}

if (process.env.NODE_ENV !== 'test') {
  main();
}
