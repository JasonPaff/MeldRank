import { describe, expect, it } from 'vitest';
import { Webhook } from 'svix';
import { createLogger } from '@meldrank/shared/server';
import { deriveDisplayNameFromUser, verifyAndSyncClerkWebhook, type SvixHeaders } from './webhook';
import type { ClerkIdentity } from './identity';
import type { PlayerResolver } from './players';

/**
 * The Clerk webhook sync (capability `auth-identity`; design D2): a valid `svix`-signed
 * `user.created`/`user.updated` event upserts the player row through the resolver, while a
 * missing or tampered signature is rejected with no mutation. Signed with the real `svix`
 * library so the verification path is exercised end-to-end.
 */

/** A valid `whsec_`-prefixed svix signing secret (base64 body). */
const SECRET = `whsec_${Buffer.from('meldrank-test-signing-secret').toString('base64')}`;

const log = createLogger('api');
log.level = 'silent';

/** A resolver that records its `upsert` calls; `resolve` is unused here. */
function recordingPlayers() {
  const upserts: ClerkIdentity[] = [];
  const players: PlayerResolver = {
    resolve: () => Promise.resolve('unused'),
    upsert: (identity) => {
      upserts.push(identity);
      return Promise.resolve('player-1');
    },
  };
  return { players, upserts };
}

/** Sign a payload with the test secret, producing the three svix headers a verified call carries. */
function signedHeaders(payload: string): SvixHeaders {
  const msgId = 'msg_test_1';
  const timestamp = new Date();
  const signature = new Webhook(SECRET).sign(msgId, timestamp, payload);
  return {
    'svix-id': msgId,
    'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'svix-signature': signature,
  };
}

const userEvent = (type: string) =>
  JSON.stringify({
    type,
    data: { id: 'user_abc123', username: 'pinochle_pat', image_url: 'https://img.example/pat.png' },
  });

describe('clerk webhook sync', () => {
  it('upserts the player row on a verified user.created event', async () => {
    const { players, upserts } = recordingPlayers();
    const payload = userEvent('user.created');

    const result = await verifyAndSyncClerkWebhook(payload, signedHeaders(payload), { secret: SECRET, players, log });

    expect(result.status).toBe(204);
    expect(upserts).toEqual([
      { clerkUserId: 'user_abc123', displayName: 'pinochle_pat', avatar: 'https://img.example/pat.png' },
    ]);
  });

  it('rejects a tampered payload and mutates nothing', async () => {
    const { players, upserts } = recordingPlayers();
    const payload = userEvent('user.created');
    const headers = signedHeaders(payload);
    const tampered = userEvent('user.updated'); // re-serialized body the signature no longer covers

    const result = await verifyAndSyncClerkWebhook(tampered, headers, { secret: SECRET, players, log });

    expect(result.status).toBe(400);
    expect(upserts).toEqual([]);
  });

  it('rejects a request with missing signature headers', async () => {
    const { players, upserts } = recordingPlayers();
    const payload = userEvent('user.created');
    const headers: SvixHeaders = { 'svix-id': '', 'svix-timestamp': '', 'svix-signature': '' };

    const result = await verifyAndSyncClerkWebhook(payload, headers, { secret: SECRET, players, log });

    expect(result.status).toBe(400);
    expect(upserts).toEqual([]);
  });

  it('ignores non-user events without mutating', async () => {
    const { players, upserts } = recordingPlayers();
    const payload = JSON.stringify({ type: 'session.created', data: { id: 'sess_1' } });

    const result = await verifyAndSyncClerkWebhook(payload, signedHeaders(payload), { secret: SECRET, players, log });

    expect(result.status).toBe(204);
    expect(upserts).toEqual([]);
  });
});

describe('deriveDisplayNameFromUser', () => {
  it('prefers username, then full name, then an id-derived fallback', () => {
    expect(deriveDisplayNameFromUser({ id: 'user_1', username: 'pat' })).toBe('pat');
    expect(deriveDisplayNameFromUser({ id: 'user_1', first_name: 'Pat', last_name: 'Q' })).toBe('Pat Q');
    expect(deriveDisplayNameFromUser({ id: 'user_abcdef123456' })).toBe('Player 123456');
  });
});
