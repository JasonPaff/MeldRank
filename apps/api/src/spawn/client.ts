import {
  INTERNAL_SECRET_HEADER,
  INTERNAL_SPAWN_PATH,
  RoomSpawnResponseSchema,
  TRACE_ID_HEADER,
  type RoomSpawnRequest,
  type RoomSpawnResponse,
} from '@meldrank/shared';

/**
 * The client for the API↔Match internal spawn seam (design D1). The API calls the
 * match service's authenticated `POST /internal/rooms` route with a frozen variant,
 * seating assignment, and bot count, and gets back the room handle synchronously. The
 * interface is injectable so the routers can be unit-tested with a fake; the HTTP
 * implementation presents the shared internal secret and validates the response shape.
 */
export interface SpawnClient {
  /**
   * Spawn a room for `request`. When `traceId` is supplied it is forwarded on the
   * `x-meldrank-trace-id` header (design D4) so the created room's logs share the
   * request's correlation id; omitting it still spawns normally.
   */
  spawn(request: RoomSpawnRequest, traceId?: string): Promise<RoomSpawnResponse>;
}

/** Options for the HTTP spawn client: the match base URL, the internal secret, and an optional `fetch`. */
export interface HttpSpawnClientOptions {
  readonly baseUrl: string;
  readonly secret: string;
  /** Injected for testing; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/** Construct the HTTP-backed spawn client targeting the match service's internal route. */
export function createHttpSpawnClient(options: HttpSpawnClientOptions): SpawnClient {
  const doFetch = options.fetch ?? fetch;
  const url = new URL(INTERNAL_SPAWN_PATH, options.baseUrl).toString();
  return {
    async spawn(request, traceId) {
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [INTERNAL_SECRET_HEADER]: options.secret,
          ...(traceId !== undefined ? { [TRACE_ID_HEADER]: traceId } : {}),
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(`spawn gateway returned ${response.status}`);
      }
      return RoomSpawnResponseSchema.parse(await response.json());
    },
  };
}
