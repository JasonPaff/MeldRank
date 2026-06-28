import { describe, expect, it, vi } from 'vitest';
import { SINGLE_DECK_PARTNERS, type RoomSpawnRequest } from '@meldrank/shared';
import { handleSpawnRequest, type CreateRoomFn, type SpawnGatewayDeps } from './spawn';

/**
 * Spawn gateway decision tests (task 3.5, capability `match-spawn-gateway`): the
 * secret gate (fail-closed), the request→createRoom mapping, and the failure path.
 * The HTTP shell is a thin parser over {@link handleSpawnRequest}; the decision logic
 * is what carries the integrity, so it is exercised directly with a faked room-creator.
 */

const SECRET = 'internal-secret';

/** A valid spawn request: one human seat + three bots on Partners. */
const validRequest: RoomSpawnRequest = {
  variantId: SINGLE_DECK_PARTNERS.id,
  variant: SINGLE_DECK_PARTNERS,
  seating: [{ kind: 'human', playerId: 'p1' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }],
  bots: 3,
};

/** A deps bundle with a stub room-creator returning a fixed handle. */
function deps(createRoom: CreateRoomFn, secret = SECRET): SpawnGatewayDeps {
  return { secret, createRoom };
}

describe('spawn gateway — secret gate (fail closed)', () => {
  const createRoom = vi.fn<CreateRoomFn>().mockResolvedValue({ roomId: 'room-1' });

  it('rejects a missing presented secret', async () => {
    const result = await handleSpawnRequest(deps(createRoom), undefined, validRequest);
    expect(result.status).toBe(401);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('rejects a mismatched presented secret', async () => {
    const result = await handleSpawnRequest(deps(createRoom), 'wrong', validRequest);
    expect(result.status).toBe(401);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('rejects every request when no secret is configured', async () => {
    const result = await handleSpawnRequest(deps(createRoom, ''), '', validRequest);
    expect(result.status).toBe(401);
    expect(createRoom).not.toHaveBeenCalled();
  });
});

describe('spawn gateway — request mapping', () => {
  it('maps a valid request onto createRoom and returns the room handle', async () => {
    const createRoom = vi.fn<CreateRoomFn>().mockResolvedValue({ roomId: 'room-42' });
    const result = await handleSpawnRequest(deps(createRoom), SECRET, validRequest);

    expect(result).toEqual({ status: 200, body: { roomId: 'room-42' } });
    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom).toHaveBeenCalledWith('match', {
      variantId: SINGLE_DECK_PARTNERS.id,
      seating: validRequest.seating,
      bots: 3,
    });
  });

  it('rejects a body that fails the spawn-request schema with a 400 (no createRoom)', async () => {
    const createRoom = vi.fn<CreateRoomFn>().mockResolvedValue({ roomId: 'room-1' });
    const result = await handleSpawnRequest(deps(createRoom), SECRET, { variantId: 'x' });

    expect(result.status).toBe(400);
    expect(createRoom).not.toHaveBeenCalled();
  });
});

describe('spawn gateway — failure path', () => {
  it('returns a 500 with no room handle when createRoom fails', async () => {
    const createRoom = vi.fn<CreateRoomFn>().mockRejectedValue(new Error('boom'));
    const result = await handleSpawnRequest(deps(createRoom), SECRET, validRequest);

    expect(result.status).toBe(500);
    expect(result.body).not.toHaveProperty('roomId');
  });
});
