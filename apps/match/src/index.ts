import { Server } from 'colyseus';
import { healthy } from '@meldrank/shared';
import { createDb, createRedis, loadMatchEnv } from '@meldrank/shared/server';
import { MatchRoom } from './colyseus/matchRoom';

/**
 * Realtime Match Service boot. The server hosts the authoritative {@link MatchRoom}
 * — one engine instance per table — over Colyseus' default WebSocket transport.
 * The fail-fast env validation and the foundation db/redis client construction are
 * preserved from the boot stub; this slice does not yet use the db/redis clients
 * (the `Persisted` transition is inert — durable persistence is slice #6), but the
 * wiring stays so later slices attach to it.
 */
export const gameServer = new Server();

// The room types this server exposes (registered before listening).
gameServer.define('match', MatchRoom);

if (process.env.NODE_ENV !== 'test') {
  // Validate the environment once at boot (fail-fast), then construct the
  // foundation clients.
  const env = loadMatchEnv();
  const db = createDb(env);
  const redis = createRedis(env);

  const port = env.PORT ?? 2567;
  const status = healthy('match');
  void gameServer.listen(port);
  console.log(
    `[match] Colyseus listening on :${port} (${status.ok ? 'ok' : 'down'}; ` +
      `room 'match' registered; db + redis clients ready: ${!!db && !!redis})`,
  );
}
