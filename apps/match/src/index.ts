import { Server } from 'colyseus';
import { healthy } from '@meldrank/shared';

const port = Number(process.env.PORT ?? 2567);

/**
 * Realtime Match Service stub. Real rooms (match lifecycle, seating, turns) land
 * in later changes; for now the server just boots and proves it can import from
 * `@meldrank/shared`. Colyseus 0.17 creates a default WebSocket transport when
 * none is provided.
 */
export const gameServer = new Server();

if (process.env.NODE_ENV !== 'test') {
  const status = healthy('match');
  void gameServer.listen(port);
  console.log(`[match] Colyseus stub listening on :${port} (${status.ok ? 'ok' : 'down'})`);
}
