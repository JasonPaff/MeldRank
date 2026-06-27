import { Server } from 'colyseus';
import { healthy } from '@meldrank/shared';
import { createDb, createRedis, loadMatchEnv } from '@meldrank/shared/server';
import { MatchRoom } from './colyseus/matchRoom';

/**
 * Realtime Match Service boot. The server hosts the authoritative {@link MatchRoom}
 * — one engine instance per table — over Colyseus' default WebSocket transport. The
 * fail-fast env validation builds the foundation db/redis clients, which are now
 * injected into every room via the definition options so a completed match persists
 * durably and publishes its result (capability `match-persistence`). In `test` the
 * clients are not built (the room is exercised directly in unit/integration tests);
 * the room is still registered without a backend.
 */
export const gameServer = new Server();

if (process.env.NODE_ENV !== 'test') {
  // Validate the environment once at boot (fail-fast), then construct the
  // foundation clients and inject them into the room definition.
  const env = loadMatchEnv();
  const db = createDb(env);
  const redis = createRedis(env);
  gameServer.define('match', MatchRoom, { db, redis });

  const port = env.PORT ?? 2567;
  const status = healthy('match');
  void gameServer.listen(port);
  console.log(
    `[match] Colyseus listening on :${port} (${status.ok ? 'ok' : 'down'}; ` +
      `room 'match' registered with db + redis: ${!!db && !!redis})`,
  );
} else {
  // The room types this server exposes (registered before listening).
  gameServer.define('match', MatchRoom);
}
