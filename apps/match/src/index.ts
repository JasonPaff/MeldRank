import { Server } from 'colyseus';
import { healthy } from '@meldrank/shared';
import { createDb, createRedis, loadMatchEnv } from '@meldrank/shared/server';

/**
 * Realtime Match Service stub. Real rooms (match lifecycle, seating, turns) land
 * in later changes; for now the server just boots and proves it can import from
 * `@meldrank/shared`. Colyseus 0.17 creates a default WebSocket transport when
 * none is provided.
 */
export const gameServer = new Server();

if (process.env.NODE_ENV !== 'test') {
  // Validate the environment once at boot (fail-fast), then construct the
  // foundation clients. No domain use yet — this only proves the wiring.
  const env = loadMatchEnv();
  const db = createDb(env);
  const redis = createRedis(env);

  const port = env.PORT ?? 2567;
  const status = healthy('match');
  void gameServer.listen(port);
  console.log(
    `[match] Colyseus stub listening on :${port} (${status.ok ? 'ok' : 'down'}; db + redis clients ready: ${!!db && !!redis})`,
  );
}
