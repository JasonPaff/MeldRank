import { Server, matchMaker } from 'colyseus';
import { healthy } from '@meldrank/shared';
import { createDb, createLogger, createRedis, loadMatchEnv } from '@meldrank/shared/server';
import { MatchRoom } from './colyseus/matchRoom';
import { INTERNAL_SPAWN_PATH, mountSpawnRoute, type RouteRegistrar, type SpawnGatewayDeps } from './gateway/spawn';

/**
 * Realtime Match Service boot. The server hosts the authoritative {@link MatchRoom}
 * — one engine instance per table — over Colyseus' default WebSocket transport. The
 * fail-fast env validation builds the foundation db/redis clients (injected into every
 * room so a completed match persists and publishes its result, capability
 * `match-persistence`) and the seat-ticket secret (the room verifies tickets with at
 * `onAuth`, capability `match-spawn-gateway`). The authenticated internal spawn route
 * (`POST /internal/rooms`, design D1) is mounted on the same HTTP server via Colyseus'
 * express extension point, gated by the shared internal secret.
 *
 * In `test` the clients/secrets are not built (the room and the gateway are exercised
 * directly in unit/integration tests); the room is still registered without a backend.
 */
export const gameServer = createGameServer();

function createGameServer(): Server {
  if (process.env.NODE_ENV === 'test') {
    // The room types this server exposes (registered before listening).
    const server = new Server();
    server.define('match', MatchRoom);
    return server;
  }

  // Validate the environment once at boot (fail-fast), then construct the foundation
  // clients and the spawn gateway, and inject them into the room definition.
  const env = loadMatchEnv();
  const log = createLogger('match', { level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production' });
  const db = createDb(env);
  const redis = createRedis(env);

  const spawnDeps: SpawnGatewayDeps = {
    secret: env.INTERNAL_SPAWN_SECRET,
    createRoom: (name, options) => matchMaker.createRoom(name, options),
  };

  const server = new Server({
    // Mount the internal spawn route on Colyseus' own HTTP server via its express app,
    // narrowed structurally to the {@link RouteRegistrar} surface the route needs.
    express: (app: RouteRegistrar) => mountSpawnRoute(app, spawnDeps),
  });
  // Inject the base logger into the room definition (design D3); each room derives its
  // own `{ roomId, traceId }` child in `onCreate`.
  server.define('match', MatchRoom, { db, redis, seatTicketSecret: env.SEAT_TICKET_SECRET, logger: log });

  const port = env.PORT ?? 2567;
  const status = healthy('match');
  void server.listen(port);
  log.info(
    { port, ok: status.ok, db: !!db, redis: !!redis, spawnRoute: INTERNAL_SPAWN_PATH },
    'Colyseus listening',
  );
  return server;
}
