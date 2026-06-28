/**
 * The centralized stub-identity seam (design D5). In this slice identity is stubbed —
 * no Clerk — so the caller's `playerId` is derived from a request header or a
 * development default. Every `player`-scoped procedure obtains its identity through
 * this single resolver, so unit E swaps only this function (and the `onAuth`→Clerk
 * linkage) for real identity, leaving every procedure body unchanged.
 */

/** The header a caller may present a stub player id in (development convenience). */
export const STUB_PLAYER_HEADER = 'x-stub-player-id';

/** The default stub player id used when no header is presented. */
export const DEFAULT_STUB_PLAYER_ID = 'stub-player';

/** The minimal request shape the resolver reads — just its headers. */
export interface StubIdentitySource {
  readonly headers?: Record<string, string | string[] | undefined>;
}

/**
 * Resolve the caller's stub `playerId` from the request headers, falling back to the
 * development default. The returned shape is `{ playerId }` so the call site never
 * re-reads the request inline.
 */
export function resolveStubIdentity(source: StubIdentitySource): { playerId: string } {
  const raw = source.headers?.[STUB_PLAYER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const playerId = value?.trim();
  return { playerId: playerId !== undefined && playerId !== '' ? playerId : DEFAULT_STUB_PLAYER_ID };
}
