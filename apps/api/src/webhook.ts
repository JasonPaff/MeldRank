import type { IncomingMessage, ServerResponse } from 'node:http';
import { Webhook } from 'svix';
import type { Logger } from '@meldrank/shared/server';
import type { PlayerResolver } from './players';

/**
 * The Clerk webhook sync (capability `auth-identity`; design D2). Clerk posts
 * `user.created`/`user.updated` events here; the handler verifies the `svix` signature
 * against `CLERK_WEBHOOK_SECRET` and upserts the `human` `players` row through the shared
 * resolver — the authoritative sync that keeps `display_name`/`avatar` fresh, complementing
 * the request-time lazy resolve-or-create. A missing or invalid signature is rejected with
 * no mutation. This route bypasses the Bearer identity edge — it is not a player-scoped call.
 */

/** The public path Clerk posts user lifecycle events to. */
export const CLERK_WEBHOOK_PATH = '/api/webhooks/clerk';

/** The svix signature headers a verified webhook must carry. */
export interface SvixHeaders {
  'svix-id': string;
  'svix-timestamp': string;
  'svix-signature': string;
}

/** The subset of the Clerk user payload the sync consumes. */
interface ClerkWebhookUser {
  readonly id: string;
  readonly username?: string | null;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly image_url?: string | null;
}

/** The Clerk webhook envelope. */
interface ClerkWebhookEvent {
  readonly type: string;
  readonly data: ClerkWebhookUser;
}

/**
 * Derive a display name from a Clerk webhook user: `username` → `first_name`
 * (+`last_name`) → a stable id-derived fallback (design D7).
 */
export function deriveDisplayNameFromUser(user: ClerkWebhookUser): string {
  const username = user.username?.trim();
  if (username !== undefined && username !== '') return username;
  const full = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
  if (full !== '') return full;
  return `Player ${user.id.slice(-6)}`;
}

/** The deps the webhook core needs: the signing secret and the player resolver. */
export interface ClerkWebhookDeps {
  readonly secret: string;
  readonly players: PlayerResolver;
  readonly log: Logger;
}

/** The HTTP status the core resolves to; the adapter writes it to the response. */
export interface WebhookResult {
  readonly status: number;
}

/**
 * Verify a Clerk webhook payload and, on a user lifecycle event, upsert the player row.
 * Pure of HTTP plumbing so the signature gate and the upsert are unit-testable: returns
 * `400` for a missing/invalid signature (no mutation), `204` otherwise.
 */
export async function verifyAndSyncClerkWebhook(
  payload: string,
  headers: SvixHeaders,
  deps: ClerkWebhookDeps,
): Promise<WebhookResult> {
  let event: ClerkWebhookEvent;
  try {
    event = new Webhook(deps.secret).verify(payload, headers) as ClerkWebhookEvent;
  } catch {
    return { status: 400 };
  }

  if (event.type === 'user.created' || event.type === 'user.updated') {
    await deps.players.upsert({
      clerkUserId: event.data.id,
      displayName: deriveDisplayNameFromUser(event.data),
      avatar: event.data.image_url ?? null,
    });
    deps.log.info({ event: event.type, clerkUserId: event.data.id }, 'clerk webhook synced player');
  }
  return { status: 204 };
}

/** Read the raw request body (svix verifies over the exact bytes, so this can't be pre-parsed). */
function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Read a single header value (svix headers are single-valued), defaulting to empty. */
function headerValue(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * The Node HTTP adapter over {@link verifyAndSyncClerkWebhook}: reads the raw body and the
 * svix headers off the request and writes the resolved status. Mounted in the standalone
 * serving entry's middleware before the tRPC handler.
 */
export async function handleClerkWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ClerkWebhookDeps,
): Promise<void> {
  const payload = await readRawBody(req);
  const { status } = await verifyAndSyncClerkWebhook(
    payload,
    {
      'svix-id': headerValue(req, 'svix-id'),
      'svix-timestamp': headerValue(req, 'svix-timestamp'),
      'svix-signature': headerValue(req, 'svix-signature'),
    },
    deps,
  );
  res.writeHead(status);
  res.end();
}
