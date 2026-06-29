'use client';

import type { Room } from '@colyseus/sdk';
import type { FilteredView } from '@meldrank/engine';

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

import type { TableIntent } from '@/components/table/intents';
import type { ClockStateSnapshot, SyncedMetadataSnapshot } from '@/lib/table-store';

import { useColyseus } from '@/lib/colyseus';
import { clearReconnectionToken, readReconnectionToken, writeReconnectionToken } from '@/lib/reconnection-token';
import { useSessionStore } from '@/lib/store';
import { useTableStore, useTableStoreApi } from '@/lib/table-store';

/**
 * Table resilience controller (F2b D2/D3/D4). Owns the entire Client↔Match
 * connection lifecycle so the route component stays a thin renderer:
 *
 * - **Cold-load decision table (D3).** On mount: an in-memory seat ticket → F2a
 *   `joinById`; no ticket but a persisted reconnection token for this room →
 *   `client.reconnect(token)` (bypasses `onAuth`, no ticket); neither → `noSession`
 *   (the F2a "no table to join" affordance), connect nothing.
 * - **In-table reconnect (D2).** A non-consented, pre-completion drop transitions
 *   to `reconnecting` and retries `client.reconnect` with a short capped backoff,
 *   bounded by the server's 90 s grace window; on success it re-attaches handlers
 *   and the server resync (`view` + `clockState`) repopulates the render model.
 * - **Token persistence (D3).** Re-persists `room.reconnectionToken` on every
 *   successful (re)connect, and clears it on every terminal state.
 *
 * A single in-flight-reconnect guard, one backoff timer, and the `disposed` flag
 * (mirroring F2a) guarantee full teardown on unmount and no overlapping attempts.
 */

interface AcceptMessage {
  readonly correlationId: string;
  readonly view: FilteredView;
}

interface CommitMessage {
  readonly commit: string;
  readonly handNonce: number;
}

interface RejectMessage {
  readonly correlationId: string;
  readonly reason: string;
  readonly view: FilteredView;
}

/** The room's auto-synced presence schema (`RoomMetadata`), read off `room.state`. */
interface SyncedMetadata {
  readonly clockDeadline: number;
  readonly lifecycle: string;
  readonly occupancy: ArrayLike<boolean> & Iterable<boolean>;
  readonly seatStatus: ArrayLike<string> & Iterable<string>;
  readonly seatToAct: number;
}

/** Server casual grace window (`DEFAULT_CLOCK_CONFIG.reconnectGraceMs`); the client need not know it exactly. */
const GRACE_MS = 90_000;
/** Stop attempting a little before the server gives up, so a doomed retry never outlives the seat. */
const GRACE_MARGIN_MS = 5_000;
/** Backoff between reconnect attempts: 1 s, doubling, capped. */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 4_000;

export interface TableConnection {
  /** True when there is neither a seat ticket nor a stored token — render return-to-lobby. */
  readonly noSession: boolean;
  /** Attach a correlation id and send a fully-formed intent to the room. */
  readonly submitIntent: (intent: TableIntent) => void;
}

export function useTableConnection(roomId: string | undefined): TableConnection {
  const colyseus = useColyseus();
  const storeApi = useTableStoreApi();
  const seatTicket = useSessionStore((s) => s.seatTicket);

  const applyView = useTableStore((s) => s.applyView);
  const applyMetadata = useTableStore((s) => s.applyMetadata);
  const setStatus = useTableStore((s) => s.setStatus);
  const setPending = useTableStore((s) => s.setPending);
  const clearPending = useTableStore((s) => s.clearPending);
  const setRejectReason = useTableStore((s) => s.setRejectReason);
  const setClockState = useTableStore((s) => s.setClockState);

  const roomRef = useRef<null | Room<SyncedMetadata>>(null);
  const [noSession, setNoSession] = useState(false);

  const ticketToken = seatTicket?.token;

  // Effect Event: keeps the cold-load decision's setState off the synchronous
  // effect-write path (it depends on `sessionStorage`, unavailable during SSR, so
  // it must run post-mount), while staying non-reactive.
  const markNoSession = useEffectEvent((value: boolean) => setNoSession(value));

  useEffect(() => {
    if (!roomId) return;

    // Cold-load decision table (D3): a ticket warm-handoff joins; otherwise a
    // persisted token cold-reconnects; with neither there is no session to resume.
    const storedToken = readReconnectionToken(roomId);
    const resumable = Boolean(ticketToken) || storedToken !== null;

    let disposed = false;

    if (!resumable) {
      // Neither credential: defer the "no session" write off the synchronous
      // effect path (the Effect Event keeps it non-reactive).
      const t = setTimeout(() => {
        if (!disposed) markNoSession(true);
      }, 0);
      return () => {
        disposed = true;
        clearTimeout(t);
      };
    }

    const contributed = new Set<number>();
    const matchComplete = { current: false };
    // Wall-clock of the first drop, bounding all reconnect attempts to the grace window.
    let firstDropAt: null | number = null;
    let attempt = 0;
    let reconnectScheduled = false;
    let backoffTimer: null | ReturnType<typeof setTimeout> = null;

    function noteResult(view: FilteredView) {
      if (view.public.matchResult) matchComplete.current = true;
    }

    function clearIfMatch(correlationId: string) {
      if (storeApi.getState().pendingCorrelationId === correlationId) clearPending();
    }

    /** Persist the room's freshly-minted reconnection token (refresh on every connect). */
    function persistToken(room: Room<SyncedMetadata>) {
      if (room.reconnectionToken) writeReconnectionToken(roomId!, room.reconnectionToken);
    }

    /** Terminal: grace exhausted or unrecoverable — clear the token, show the error affordance. */
    function failToError() {
      if (disposed) return;
      clearReconnectionToken(roomId!);
      setStatus('error');
    }

    /** Attach the full F2a handler set; re-run verbatim after a successful reconnect (4.3). */
    function attachHandlers(room: Room<SyncedMetadata>) {
      room.onStateChange((state) => applyMetadata(snapshotMetadata(state)));

      room.onMessage<FilteredView>('view', (view) => {
        noteResult(view);
        applyView(view);
      });

      room.onMessage<AcceptMessage>('accept', ({ correlationId, view }) => {
        noteResult(view);
        applyView(view);
        clearIfMatch(correlationId);
      });

      room.onMessage<RejectMessage>('reject', ({ correlationId, reason, view }) => {
        noteResult(view);
        applyView(view);
        setRejectReason(reason);
        clearIfMatch(correlationId);
      });

      room.onMessage<CommitMessage>('commit', ({ handNonce }) => {
        // Best-effort, fire-once per hand (F2a D4); never blocks the loop.
        if (contributed.has(handNonce)) return;
        contributed.add(handNonce);
        room.send('contribute', { clientSeed: toHex(crypto.getRandomValues(new Uint8Array(32))) });
      });

      room.onMessage<ClockStateSnapshot>('clockState', (payload) => setClockState(payload));

      // Best-effort contribution rejections are non-fatal — drain and ignore.
      room.onMessage('rejectContribution', () => undefined);

      room.onLeave(() => {
        if (disposed) return;
        // A server close after a `matchResult` view is the success terminal (F2a D6);
        // every other pre-completion drop is reconnectable within grace (D2).
        if (matchComplete.current) {
          clearReconnectionToken(roomId!);
          setStatus('complete');
          return;
        }
        handleDrop();
      });

      room.onError(() => {
        if (disposed || matchComplete.current) return;
        handleDrop();
      });
    }

    /** A non-consented, pre-completion drop: enter `reconnecting` and start the retry loop (D2). */
    function handleDrop() {
      if (disposed) return;
      if (firstDropAt === null) firstDropAt = Date.now();
      // The resynced `view` re-derives the available action; drop the stale in-flight intent (4.5).
      clearPending();
      setStatus('reconnecting');
      scheduleReconnect();
    }

    /** Schedule the next reconnect attempt under the single in-flight guard, bounded by grace. */
    function scheduleReconnect() {
      if (disposed || reconnectScheduled) return;
      const elapsed = Date.now() - (firstDropAt ?? Date.now());
      if (elapsed >= GRACE_MS - GRACE_MARGIN_MS) {
        failToError();
        return;
      }
      reconnectScheduled = true;
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
      backoffTimer = setTimeout(() => {
        backoffTimer = null;
        reconnectScheduled = false;
        void attemptReconnect();
      }, delay);
    }

    async function attemptReconnect() {
      if (disposed) return;
      const token = readReconnectionToken(roomId!) ?? roomRef.current?.reconnectionToken ?? null;
      if (!token) {
        failToError();
        return;
      }
      try {
        // The SDK overload returns `Room<any, State>`; assert the clean room type
        // at this single boundary so the `any` does not leak into the handlers.
        const room = (await colyseus.reconnect<SyncedMetadata>(token)) as Room<SyncedMetadata>;
        if (disposed) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        persistToken(room);
        attachHandlers(room);
        // Recovered: reset the grace window and backoff; the server resync repopulates the model.
        firstDropAt = null;
        attempt = 0;
        setStatus('connected');
      } catch {
        if (disposed) return;
        attempt += 1;
        scheduleReconnect();
      }
    }

    /** Initial connect (D3): warm-handoff `joinById` with the ticket, else cold `reconnect`. */
    async function connect() {
      try {
        // The SDK overload returns `Room<any, State>`; assert the clean room type
        // at this single boundary so the `any` does not leak into the handlers.
        const room = (
          ticketToken
            ? await colyseus.joinById<SyncedMetadata>(roomId!, { ticket: ticketToken })
            : await colyseus.reconnect<SyncedMetadata>(storedToken!)
        ) as Room<SyncedMetadata>;
        if (disposed) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        persistToken(room);
        attachHandlers(room);
        setStatus('connected');
      } catch {
        if (disposed) return;
        if (ticketToken) {
          // Warm-path join rejection (missing/invalid/expired ticket).
          setStatus('error');
        } else {
          // Cold-reconnect rejection (grace expired, match resolved, invalid token):
          // clear the stale token and fall back to return-to-lobby — never retry (5.2).
          clearReconnectionToken(roomId!);
          setNoSession(true);
        }
      }
    }

    void connect();

    return () => {
      disposed = true;
      if (backoffTimer) clearTimeout(backoffTimer);
      // A genuine client-initiated leave after a live session clears the token (2.3).
      // Guarded on an established room so React strict-mode's mount→unmount→mount
      // (which tears down before the async connect resolves) does not wipe the token
      // a cold-load is about to reuse.
      if (roomRef.current) clearReconnectionToken(roomId);
      void roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [roomId, ticketToken, colyseus, storeApi, applyView, applyMetadata, setStatus, clearPending, setRejectReason, setClockState]);

  const submitIntent = useCallback(
    (intent: TableIntent) => {
      const room = roomRef.current;
      if (!room) return;
      const correlationId = crypto.randomUUID();
      setPending(correlationId);
      room.send('intent', { correlationId, intent });
    },
    [setPending],
  );

  return { noSession, submitIntent };
}

/** Copy the synced `ArraySchema` fields into plain arrays for the store snapshot. */
function snapshotMetadata(state: SyncedMetadata): SyncedMetadataSnapshot {
  return {
    clockDeadline: state.clockDeadline,
    lifecycle: state.lifecycle,
    occupancy: Array.from(state.occupancy),
    seatStatus: Array.from(state.seatStatus),
    seatToAct: state.seatToAct,
  };
}

/** Hex-encode random bytes for the `contribute` client seed (F2a D4). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
