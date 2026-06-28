'use client';

import type { Room } from '@colyseus/sdk';
import type { FilteredView } from '@meldrank/engine';

import { $path } from 'next-typesafe-url';
import { useRouteParams } from 'next-typesafe-url/app';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import type { TableIntent } from '@/components/table/intents';
import type { ClockStateSnapshot, SyncedMetadataSnapshot } from '@/lib/table-store';

import { TableView } from '@/components/table/table-view';
import { Button } from '@/components/ui/button';
import { useColyseus } from '@/lib/colyseus';
import { useSessionStore } from '@/lib/store';
import { TableStoreProvider, useRenderModel, useTableStore, useTableStoreApi } from '@/lib/table-store';

import { Route } from './route-type';

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
/**
 * F2a live table (design D6). Replaces the F1 stub: it joins the spawned Colyseus
 * room with the lobby's seat ticket, merges the two state channels into the table
 * store, drives the pessimistic human intent loop, and fires the best-effort
 * per-hand seed contribution — enough for a 1-human + 3-bot Single-Deck Partners
 * game to play to completion and persist (SLE-184 unit F task 5.2).
 *
 * The route component owns the table store provider; {@link TableSurface} owns the
 * connection lifecycle and renders from the derived render model. Clocks,
 * reconnect/resync, and cold-load ticket re-mint are F2b.
 */
export default function TablePage() {
  return (
    <TableStoreProvider>
      <TableSurface />
    </TableStoreProvider>
  );
}

function MatchCompleteBanner({ model, onReturn }: { model: ReturnType<typeof useRenderModel>; onReturn: () => void }) {
  const standings = model.matchResult?.standings ?? [];
  return (
    <section className="
      flex w-full max-w-3xl flex-col items-center gap-3 rounded-lg border
      border-primary bg-card p-4
    ">
      <h2 className="text-base font-semibold">Match complete</h2>
      {standings.length > 0 && (
        <ul className="flex flex-col items-center gap-1 text-sm">
          {standings.map((s) => (
            <li className="tabular-nums" key={s.side}>
              Side {s.side}: {s.cumulative} — {s.outcome} (placement {s.placement})
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onReturn}>Return to lobby</Button>
    </section>
  );
}

function ReturnToLobby({ message, onReturn, title }: { message: string; onReturn: () => void; title: string }) {
  return (
    <main className="
      flex min-h-screen flex-col items-center justify-center gap-4 p-8
    ">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-center text-sm text-muted-foreground">{message}</p>
      <Button onClick={onReturn}>Return to lobby</Button>
    </main>
  );
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

function TableSurface() {
  const { data: routeParams } = useRouteParams(Route.routeParams);
  const router = useRouter();
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

  const model = useRenderModel();
  const roomRef = useRef<null | Room<SyncedMetadata>>(null);

  const roomId = routeParams?.roomId;
  const ticketToken = seatTicket?.token;

  useEffect(() => {
    // Cold load (design D5): no in-memory ticket survived, so we cannot rejoin —
    // the return-to-lobby affordance is rendered below; never connect.
    if (!roomId || !ticketToken) return;

    let disposed = false;
    const contributed = new Set<number>();
    const matchComplete = { current: false };

    function noteResult(view: FilteredView) {
      if (view.public.matchResult) matchComplete.current = true;
    }

    function clearIfMatch(correlationId: string) {
      if (storeApi.getState().pendingCorrelationId === correlationId) clearPending();
    }

    colyseus
      .joinById<SyncedMetadata>(roomId, { ticket: ticketToken })
      .then((room) => {
        if (disposed) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        setStatus('connected');

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
          // Best-effort, fire-once per hand (design D4); never blocks the loop.
          if (contributed.has(handNonce)) return;
          contributed.add(handNonce);
          room.send('contribute', { clientSeed: toHex(crypto.getRandomValues(new Uint8Array(32))) });
        });

        room.onMessage<ClockStateSnapshot>('clockState', (payload) => setClockState(payload));

        // Best-effort contribution rejections are non-fatal — drain and ignore.
        room.onMessage('rejectContribution', () => undefined);

        room.onLeave(() => {
          if (disposed) return;
          // A server-initiated close after a `matchResult` view is the success
          // terminal (design D6); any earlier drop is an error.
          setStatus(matchComplete.current ? 'complete' : 'error');
        });

        room.onError(() => {
          if (disposed) return;
          setStatus('error');
        });
      })
      .catch(() => {
        // `onAuth`/join rejection (missing, invalid, or expired ticket).
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
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

  // Cold load — no ticket to present.
  if (!ticketToken) {
    return <ReturnToLobby message="No active seat. Head back to the lobby to start or rejoin a game." onReturn={() => router.push($path({ route: '/' }))} title="No table to join" />;
  }

  if (model.status === 'error') {
    return <ReturnToLobby message="The table connection was lost before the match finished." onReturn={() => router.push($path({ route: '/' }))} title="Connection error" />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-6">
      <header className="flex flex-col items-center gap-1">
        <h1 className="text-lg font-semibold tracking-tight">MeldRank table</h1>
        <p className="font-mono text-xs text-muted-foreground">{roomId}</p>
        {model.status === 'connecting' && <p className="
          text-sm text-muted-foreground
        ">Connecting to the table…</p>}
      </header>

      {model.status === 'complete' && <MatchCompleteBanner model={model} onReturn={() => router.push($path({ route: '/' }))} />}

      {model.status !== 'connecting' && <TableView model={model} submitIntent={submitIntent} />}
    </main>
  );
}

/** Hex-encode random bytes for the `contribute` client seed (design D4). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
