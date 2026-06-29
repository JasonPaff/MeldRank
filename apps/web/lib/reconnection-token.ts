/**
 * Reconnection-token persistence (F2b D3). Colyseus mints a fresh
 * `room.reconnectionToken` on every (re)connection that authorizes rejoining the
 * exact dropped seat within the server's grace window (bypassing `onAuth`, no
 * re-minted seat ticket). We stash it in `sessionStorage`, keyed by `roomId`, so a
 * hard refresh of `/table/[roomId]` can rehydrate the session — and clear it on
 * every terminal state so a cold load never tries to rejoin a finished or
 * abandoned game.
 *
 * `sessionStorage` (not `localStorage`) scopes the token to the tab: it survives a
 * reload but not a tab close, which matches the grace-bounded, single-session
 * authority of the token. All access is SSR-guarded — the store is read/written
 * only under the client boundary.
 */

const STORAGE_KEY = 'meldrank:table:reconnect';

type TokenMap = Record<string, string>;

/** Clear the stored reconnection token for `roomId` (terminal-state cleanup). */
export function clearReconnectionToken(roomId: string): void {
  const map = readMap();
  if (!(roomId in map)) return;
  delete map[roomId];
  writeMap(map);
}

/** The stored reconnection token for `roomId`, or null. */
export function readReconnectionToken(roomId: string): null | string {
  return readMap()[roomId] ?? null;
}

/** Persist (replacing any prior) the reconnection token for `roomId`. */
export function writeReconnectionToken(roomId: string, token: string): void {
  const map = readMap();
  map[roomId] = token;
  writeMap(map);
}

function readMap(): TokenMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as TokenMap) : {};
  } catch {
    // Malformed JSON or storage access denied — treat as empty.
    return {};
  }
}

function writeMap(map: TokenMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota or privacy-mode failures are non-fatal — resilience degrades to F2a.
  }
}
