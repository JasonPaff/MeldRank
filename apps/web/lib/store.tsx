'use client';

import type { ActiveMatch, SignedSeatTicket } from '@meldrank/shared';

import { createContext, type ReactNode, useContext, useState } from 'react';
import { createStore, useStore } from 'zustand';

/**
 * Client-side session/table state (design D4). F0 established the store, its
 * provider, and the typed hook; F1 adds the lobby→table handoff fields — the
 * active seat `ticket` and the active-match handle (`roomId`/`seat`/`variantId`)
 * — that the table route (F2) reads to join the Colyseus room. The types reuse
 * `@meldrank/shared` so the store and the wire agree. A successful Quick Play
 * carries a fresh ticket; a Rejoin carries only the handle (`ticket` stays null).
 */
export interface SessionState {
  /** The room handle to hand off to the table route; null when the caller is in no live match. */
  activeMatch: ActiveMatch | null;
  /** Clear the handoff fields back to their unset state. */
  clearHandoff: () => void;
  playerId: null | string;
  /** The caller's signed seat ticket from the most recent Quick Play (bearer credential for F2's `onAuth`). */
  seatTicket: null | SignedSeatTicket;
  /** Stash the lobby→table handoff on a successful Quick Play (with ticket) or Rejoin (ticket null). */
  setHandoff: (handoff: { match: ActiveMatch; ticket: null | SignedSeatTicket }) => void;
  setPlayerId: (playerId: null | string) => void;
}

type SessionStore = ReturnType<typeof createSessionStore>;

function createSessionStore() {
  return createStore<SessionState>()((set) => ({
    activeMatch: null,
    clearHandoff: () => set({ activeMatch: null, seatTicket: null }),
    playerId: null,
    seatTicket: null,
    setHandoff: ({ match, ticket }) => set({ activeMatch: match, seatTicket: ticket }),
    setPlayerId: (playerId) => set({ playerId }),
  }));
}

const SessionStoreContext = createContext<null | SessionStore>(null);

/**
 * Provides a per-tree store instance (created once via lazy `useState`, never a
 * module global) so the store is SSR-safe and isolated per render tree.
 */
export function SessionStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore);
  return <SessionStoreContext.Provider value={store}>{children}</SessionStoreContext.Provider>;
}

/** Read selected session state; throws if used outside {@link SessionStoreProvider}. */
export function useSessionStore<T>(selector: (state: SessionState) => T): T {
  const store = useContext(SessionStoreContext);
  if (!store) {
    throw new Error('useSessionStore must be used within a SessionStoreProvider');
  }
  return useStore(store, selector);
}
