import { Redis } from '@upstash/redis';

/** Minimal env shape the Redis client needs — satisfied by every server env. */
export interface RedisEnv {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
}

/**
 * Construct an Upstash Redis REST client from the validated environment. The
 * REST client is serverless- and edge-safe and behaves identically on Vercel
 * and Fly. This change wires connectivity only — no presence, queue, or pub/sub
 * domain logic, which the changes that own those domains add later.
 *
 * Server-only: exported from `@meldrank/shared/server`.
 */
export function createRedis(env: RedisEnv): Redis {
  return new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
}

export type RedisClient = Redis;

/**
 * Connectivity check: returns `true` when the server answers `PING` with
 * `PONG`. The full extent of Redis usage in this change.
 */
export async function pingRedis(redis: Redis): Promise<boolean> {
  const reply = await redis.ping();
  return reply === 'PONG';
}
