'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';
import { createStore, useStore } from 'zustand';

/**
 * Client-side session/table state (design D4). F0 establishes the store, its
 * provider, and the typed hook only — the concrete table-reconciliation fields
 * are defined by the later table slice (F2). The placeholder `playerId` keeps the
 * shape non-empty and exercises a setter so the wiring is real, not a stub.
 */
export interface SessionState {
  playerId: null | string;
  setPlayerId: (playerId: null | string) => void;
}

type SessionStore = ReturnType<typeof createSessionStore>;

function createSessionStore() {
  return createStore<SessionState>()((set) => ({
    playerId: null,
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
