'use client';

import { Client } from 'colyseus.js';
import { createContext, type ReactNode, useContext, useState } from 'react';

import { env } from './env';

/**
 * A configured-but-unconnected `colyseus.js` client (design D6). The provider
 * constructs the client from `NEXT_PUBLIC_MATCH_URL` and exposes it; it performs
 * no `join`/`joinById`/`create`/`reconnect` — all room logic belongs to the later
 * table slice (F2).
 *
 * `colyseus.js` touches browser globals, so the client is only constructed under
 * the client boundary (guarded against SSR); on the server the context value is
 * `null` and the hook is simply not called during F0's no-op render.
 */
const ColyseusContext = createContext<Client | null>(null);

export function ColyseusProvider({ children }: { children: ReactNode }) {
  // Lazy `useState` so the client is constructed exactly once, only under the
  // client boundary; on the server the initializer returns `null` (no `window`).
  const [client] = useState<Client | null>(() =>
    typeof window === 'undefined' ? null : new Client(env.NEXT_PUBLIC_MATCH_URL),
  );
  return <ColyseusContext.Provider value={client}>{children}</ColyseusContext.Provider>;
}

/** Access the configured Colyseus client; throws if used outside the provider (or on the server). */
export function useColyseus(): Client {
  const client = useContext(ColyseusContext);
  if (!client) {
    throw new Error('useColyseus must be used within a ColyseusProvider on the client');
  }
  return client;
}
