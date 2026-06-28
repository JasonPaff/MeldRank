import type { IncomingMessage, ServerResponse } from 'node:http';
import { INTERNAL_SECRET_HEADER, INTERNAL_SPAWN_PATH, RoomSpawnRequestSchema, type RoomSpawnRequest } from '@meldrank/shared';
import type { MatchCreateOptions } from '../colyseus/matchRoom';

export { INTERNAL_SPAWN_PATH, INTERNAL_SECRET_HEADER };

/**
 * The authenticated internal spawn gateway (capability `match-spawn-gateway`,
 * design D1): the service-to-service control route the API calls to create an
 * authoritative room on demand. The core decision logic ({@link handleSpawnRequest})
 * is a pure function over its dependencies so the secret gate, the request→createRoom
 * mapping, and the failure path are unit-testable without a live HTTP server or a
 * running matchMaker; the Node-http handler ({@link createSpawnRouteHandler}) is a
 * thin shell that parses the request, calls it, and writes the response.
 */

/** A created room handle — the minimal shape the gateway needs from `matchMaker.createRoom`. */
export interface CreatedRoom {
  readonly roomId: string;
}

/** Create a `match` room with the given options; injected so the gateway is testable. */
export type CreateRoomFn = (roomName: string, options: MatchCreateOptions) => Promise<CreatedRoom>;

/** The gateway's dependencies: the configured internal secret and the room-creator. */
export interface SpawnGatewayDeps {
  readonly secret: string;
  readonly createRoom: CreateRoomFn;
}

/** A gateway decision: an HTTP status and a JSON body (the spawn response or an error). */
export interface SpawnResult {
  readonly status: 200 | 400 | 401 | 500;
  readonly body: { readonly roomId: string } | { readonly error: string };
}

/**
 * Decide a spawn request (capability `match-spawn-gateway`). Fails closed: a request
 * is rejected unless a non-empty internal secret is configured *and* the presented
 * secret matches it. A request that passes the gate but fails the spawn-request schema
 * is a `400`; a `matchMaker.createRoom` failure is a `500` carrying no room handle (so
 * the API can roll its table back). On success it maps the frozen variant, the seating
 * assignment, and the bot count onto room creation and returns the room handle.
 */
export async function handleSpawnRequest(
  deps: SpawnGatewayDeps,
  providedSecret: string | undefined,
  rawBody: unknown,
): Promise<SpawnResult> {
  if (deps.secret === '' || providedSecret === undefined || providedSecret !== deps.secret) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const parsed = RoomSpawnRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { status: 400, body: { error: 'invalid spawn request' } };
  }
  try {
    const room = await deps.createRoom('match', toCreateOptions(parsed.data));
    return { status: 200, body: { roomId: room.roomId } };
  } catch {
    return { status: 500, body: { error: 'room creation failed' } };
  }
}

/** Map a validated spawn request onto the `MatchRoom` creation options. */
export function toCreateOptions(request: RoomSpawnRequest): MatchCreateOptions {
  return { variantId: request.variantId, seating: request.seating, bots: request.bots };
}

/**
 * The minimal express-app surface the spawn route needs. Express's own types are not
 * a direct dependency of this package, so the Colyseus `express` callback's `app` is
 * cast to this structural type to mount the route without an unsafe `any` call.
 */
export interface RouteRegistrar {
  post(path: string, handler: (req: IncomingMessage, res: ServerResponse) => void): unknown;
}

/** Mount the authenticated internal spawn route on a Colyseus/express app. */
export function mountSpawnRoute(app: RouteRegistrar, deps: SpawnGatewayDeps): void {
  app.post(INTERNAL_SPAWN_PATH, createSpawnRouteHandler(deps));
}

/**
 * A Node-http request handler for the internal spawn route, suitable for mounting on
 * the Colyseus HTTP server (its express app extends Node's `IncomingMessage`/
 * `ServerResponse`, so this handler is structurally a valid express handler too). It
 * reads the JSON body, runs {@link handleSpawnRequest}, and writes the JSON response.
 */
export function createSpawnRouteHandler(deps: SpawnGatewayDeps) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const header = req.headers[INTERNAL_SECRET_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    void readJsonBody(req)
      .then((body) => handleSpawnRequest(deps, provided, body))
      .then((result) => {
        res.writeHead(result.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result.body));
      })
      .catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      });
  };
}

/**
 * Read and JSON-parse the request body. If an upstream body parser already populated
 * `req.body` (some Colyseus setups register `express.json()`), use it directly;
 * otherwise drain the stream. Returns `undefined` on an empty or unparseable body so
 * the schema validation produces the `400`, never a thrown parse error.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined && preParsed !== null && typeof preParsed === 'object') {
    return preParsed;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
