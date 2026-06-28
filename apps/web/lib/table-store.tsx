'use client';

import type { Card, FilteredView, MatchResult, PublicState } from '@meldrank/engine';

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { createStore, useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

/**
 * Table render-model store (design D1). Colyseus delivers table state over two
 * independent channels: the auto-synced `RoomMetadata` schema (presence —
 * `lifecycle`/`seatToAct`/`seatStatus`/`occupancy`) and discrete room messages
 * (`view`/`accept`/`reject` carry the card-bearing `FilteredView`;
 * `commit`/`clockState` carry handshake/clock data). This Zustand store — scoped
 * to the table route like F0's session store — holds the latest `FilteredView`
 * plus the latest synced metadata snapshot, the in-flight intent correlation id,
 * and the connection status, and exposes one derived render model the view
 * components read. The authoritative `view` always replaces the held view
 * wholesale (the server never sends a patch), so there is no client-side reducer
 * over engine events and no field both channels write.
 */

/** The action the viewer may take this turn (design D3). */
export type AvailableAction =
  | { readonly currentHigh: null | number; readonly kind: 'bid' }
  | { readonly kind: 'declareTrump' }
  | { readonly kind: 'playCard' };

/** The `clockState` payload — captured in F2a, rendered in F2b. */
export interface ClockStateSnapshot {
  readonly actingSeat: null | number;
  readonly deadline: null | number;
  readonly seats: readonly { remainingBaseMs: number; remainingReserveMs: number; seat: number }[];
}

/** The single render model the table components read; derived, never stored. */
export interface RenderModel {
  /** The action available to the viewer this turn, or null (not your turn / pending). */
  readonly availableAction: AvailableAction | null;
  /** Per-seat held-card counts; `handSizes[i]` cards for seat `i`. */
  readonly handSizes: readonly number[];
  /** Room lifecycle marker, or null before the first sync. */
  readonly lifecycle: null | string;
  /** Final match standings once the game completes, else null. */
  readonly matchResult: MatchResult | null;
  /** Per-seat filled flags from synced metadata. */
  readonly occupancy: readonly boolean[];
  /** Seat currently on the clock, or null. */
  readonly onClockSeat: null | number;
  /** The viewer's own hand (empty before the first view). */
  readonly ownHand: readonly Card[];
  /** True while an intent is awaiting `accept`/`reject`. */
  readonly pending: boolean;
  /** The table-visible public state, or null before the first view. */
  readonly public: null | PublicState;
  /** The reason the last intent was rejected, surfaced until the next attempt. */
  readonly rejectReason: null | string;
  /** Per-seat connection status from synced metadata. */
  readonly seatStatus: readonly string[];
  /** Connection lifecycle. */
  readonly status: TableStatus;
  /** The viewer's seat index, or null (spectator / pre-join). */
  readonly viewer: null | number;
}

/** A plain (non-`ArraySchema`) snapshot of the auto-synced `RoomMetadata`. */
export interface SyncedMetadataSnapshot {
  /** Per-seat: pending move deadline as injected ms, or `-1` when none. */
  readonly clockDeadline: number;
  /** `RoomLifecycle` marker (e.g. `Live`, `Complete`, `Persisted`). */
  readonly lifecycle: string;
  /** Per-seat: which seats are filled. */
  readonly occupancy: readonly boolean[];
  /** Per-seat connection status (`Empty`/`Connected`/`Disconnected`/`BotControlled`). */
  readonly seatStatus: readonly string[];
  /** Seat on the clock, or `-1` when none. */
  readonly seatToAct: number;
}

export interface TableState {
  /** Replace the held synced-metadata snapshot. */
  applyMetadata: (metadata: SyncedMetadataSnapshot) => void;
  /** Replace the held view wholesale with the authoritative server view. */
  applyView: (view: FilteredView) => void;
  /** Clear the in-flight intent so input re-enables. */
  clearPending: () => void;
  /** The latest `clockState` payload (F2b), or null. */
  clockState: ClockStateSnapshot | null;
  /** The latest synced presence metadata, or null before the first sync. */
  metadata: null | SyncedMetadataSnapshot;
  /** The correlation id of the in-flight intent, or null. */
  pendingCorrelationId: null | string;
  /** The reason the last intent was rejected, or null. */
  rejectReason: null | string;
  /** Stash the `clockState` payload (captured, not yet rendered). */
  setClockState: (clockState: ClockStateSnapshot) => void;
  /** Mark an intent in flight (clears any prior reject reason). */
  setPending: (correlationId: string) => void;
  /** Surface a rejection reason. */
  setRejectReason: (reason: null | string) => void;
  /** Transition the connection lifecycle. */
  setStatus: (status: TableStatus) => void;
  /** Connection lifecycle. */
  status: TableStatus;
  /** The latest authoritative per-seat filtered view, or null before the first. */
  view: FilteredView | null;
}

/** Connection lifecycle for the table surface (design D6). */
export type TableStatus = 'complete' | 'connected' | 'connecting' | 'error';

type TableStore = ReturnType<typeof createTableStore>;

/** Build the derived render model from the raw two-channel state (design D1). */
function buildRenderModel(state: Pick<TableState, 'metadata' | 'pendingCorrelationId' | 'rejectReason' | 'status' | 'view'>): RenderModel {
  const { metadata, pendingCorrelationId, rejectReason, status, view } = state;
  const pending = pendingCorrelationId !== null;
  const onClockSeat = view?.public.seatToAct ?? (metadata && metadata.seatToAct >= 0 ? metadata.seatToAct : null);
  return {
    availableAction: deriveAvailableAction(view, pending),
    handSizes: view?.handSizes ?? [],
    lifecycle: metadata?.lifecycle ?? null,
    matchResult: view?.public.matchResult ?? null,
    occupancy: metadata?.occupancy ?? [],
    onClockSeat,
    ownHand: view?.own?.hand ?? [],
    pending,
    public: view?.public ?? null,
    rejectReason,
    seatStatus: metadata?.seatStatus ?? [],
    status,
    viewer: view?.viewer ?? null,
  };
}

function createTableStore() {
  return createStore<TableState>()((set) => ({
    applyMetadata: (metadata) => set({ metadata }),
    applyView: (view) => set({ view }),
    clearPending: () => set({ pendingCorrelationId: null }),
    clockState: null,
    metadata: null,
    pendingCorrelationId: null,
    rejectReason: null,
    setClockState: (clockState) => set({ clockState }),
    // A fresh attempt clears any stale rejection reason.
    setPending: (correlationId) => set({ pendingCorrelationId: correlationId, rejectReason: null }),
    setRejectReason: (rejectReason) => set({ rejectReason }),
    setStatus: (status) => set({ status }),
    status: 'connecting',
    view: null,
  }));
}

/** Pure phase→action map (design D3); permissive — server `reject` is the authority. */
function deriveAvailableAction(view: FilteredView | null, pending: boolean): AvailableAction | null {
  if (pending || view === null || view.viewer === null) return null;
  const { auction, phase, seatToAct } = view.public;
  if (seatToAct !== view.viewer) return null;
  switch (phase) {
    case 'Auction':
      return { currentHigh: auction?.highBid?.value ?? null, kind: 'bid' };
    case 'DeclareTrump':
      return { kind: 'declareTrump' };
    case 'TrickPlay':
      return { kind: 'playCard' };
    default:
      return null;
  }
}

const TableStoreContext = createContext<null | TableStore>(null);

/** Provides a per-tree table store (created once via lazy `useState`), SSR-safe. */
export function TableStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createTableStore);
  return <TableStoreContext.Provider value={store}>{children}</TableStoreContext.Provider>;
}

/**
 * The single derived render model the table components consume. Selects the raw
 * channel state with a shallow-compared selector (stable references — `view` and
 * `metadata` are only ever replaced wholesale) and memoizes the derivation, so
 * the fresh render-model object never triggers a re-render loop.
 */
export function useRenderModel(): RenderModel {
  const raw = useTableStore(
    useShallow((s) => ({
      metadata: s.metadata,
      pendingCorrelationId: s.pendingCorrelationId,
      rejectReason: s.rejectReason,
      status: s.status,
      view: s.view,
    })),
  );
  return useMemo(() => buildRenderModel(raw), [raw]);
}

/** Read selected table state; throws if used outside {@link TableStoreProvider}. */
export function useTableStore<T>(selector: (state: TableState) => T): T {
  const store = useContext(TableStoreContext);
  if (!store) {
    throw new Error('useTableStore must be used within a TableStoreProvider');
  }
  return useStore(store, selector);
}

/** Access the raw store api (for `getState` inside message handlers). */
export function useTableStoreApi(): TableStore {
  const store = useContext(TableStoreContext);
  if (!store) {
    throw new Error('useTableStoreApi must be used within a TableStoreProvider');
  }
  return store;
}
