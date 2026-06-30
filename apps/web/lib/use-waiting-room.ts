'use client';

import type { CasualTable } from '@meldrank/shared';

import { useMutation, useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { $path } from 'next-typesafe-url';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSessionStore } from '@/lib/store';
import { useTRPC, useTRPCClient } from '@/lib/trpc';

/** Waiting-room poll cadence: faster than the browse list (design Open Question). */
const GET_TABLE_REFETCH_MS = 2_000;

export interface WaitingRoom {
  readonly addBot: (seat: number) => void;
  /** A non-fatal "seat just taken" notice from a concurrent claim (design D5). */
  readonly conflictMessage: null | string;
  readonly leave: () => void;
  /** Whether a leave is in flight. */
  readonly leaving: boolean;
  /** The seat-action in flight, if any. */
  readonly pendingSeatAction: null | PendingSeatAction;
  /** Lifecycle: initial load, a non-evicted error, the live waiting view, or the live handoff. */
  readonly phase: 'error' | 'loading' | 'transitioning' | 'waiting';
  readonly retry: () => void;
  /** The current table record, or null while the first poll is pending. */
  readonly table: CasualTable | null;
  readonly takeSeat: (seat: number) => void;
  /** The viewer's resolved player id (for the "you" seat branch). */
  readonly viewerPlayerId: null | string;
  /** Whether the viewer already occupies a seat (hides a second "Take seat"). */
  readonly viewerSeated: boolean;
}

/** A seat action in flight, so the targeted seat can render a pending state. */
interface PendingSeatAction {
  readonly kind: 'bot' | 'join';
  readonly seat: number;
}

/**
 * Waiting-room controller (capability `casual-hall-web`, design D6), the
 * `use-table-connection` analogue for the pre-room phase. Owns the entire
 * server-interaction lifecycle so the route and seat components stay thin:
 *
 * - **Poll (D2).** Polls `casual.getTable` on a fast interval for live seat-fill;
 *   a NOT_FOUND poll means the table was evicted → return to the hall (spec
 *   "An evicted table returns the caller to the hall").
 * - **Seat actions (D5).** `takeSeat`/`addBot`/`leave` are seat-indexed and
 *   pending-guarded; a CONFLICT (a seat claimed concurrently) is surfaced as a
 *   non-fatal "seat just taken" and the table refreshed, not a hard failure.
 * - **Live transition (D1/D2).** When a poll reports `live` with a `roomId`, it
 *   fetches the caller's fresh seat ticket via `match.getActive` once, stashes the
 *   ticket + handle into the session store, and hands off to `/table/[roomId]`. A
 *   transient `spawning` poll keeps waiting.
 */
export function useWaitingRoom(tableId: string | undefined): WaitingRoom {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const router = useRouter();

  const setHandoff = useSessionStore((s) => s.setHandoff);

  const me = useQuery(trpc.account.getMe.queryOptions());
  // Destructure the referentially-stable fields/handlers (notably `refetch`), so the
  // callbacks below depend on those rather than the unstable query-result object.
  const {
    data: tableData,
    error: tableError,
    isError: tableIsError,
    isPending: tableIsPending,
    refetch: refetchTable,
  } = useQuery({
    ...trpc.casual.getTable.queryOptions({ tableId: tableId ?? '' }),
    enabled: Boolean(tableId),
    // Poll for live seat-fill; do not retry, so a NOT_FOUND (eviction) surfaces at
    // once for the redirect and a transient error self-heals on the next interval.
    refetchInterval: GET_TABLE_REFETCH_MS,
    retry: false,
  });

  const [conflictMessage, setConflictMessage] = useState<null | string>(null);
  const [pendingSeatAction, setPendingSeatAction] = useState<null | PendingSeatAction>(null);
  const [transitioning, setTransitioning] = useState(false);

  const toHall = useCallback(() => router.replace($path({ route: '/' })), [router]);

  // Evicted table (NOT_FOUND poll) → return to the hall rather than render a dead table.
  const evicted = tableIsError && trpcErrorCode(tableError) === 'NOT_FOUND';
  useEffect(() => {
    if (evicted) toHall();
  }, [evicted, toHall]);

  // Live transition (fires once): fetch the caller's fresh ticket and hand off.
  const table = tableData ?? null;
  const roomId = table?.status === 'live' ? table.roomId : null;
  const transitionGuard = useRef(false);
  useEffect(() => {
    if (roomId === null || transitionGuard.current) return;
    transitionGuard.current = true;
    setTransitioning(true);
    let cancelled = false;
    void (async () => {
      try {
        const active = await trpcClient.match.getActive.query();
        if (cancelled) return;
        if (!active) {
          // The table is live but our active-match record isn't set yet; let a
          // later poll re-trigger the handoff rather than navigate without a ticket.
          transitionGuard.current = false;
          setTransitioning(false);
          return;
        }
        const { ticket, ...match } = active;
        setHandoff({ match, ticket: ticket ?? null });
        router.replace($path({ route: '/table/[roomId]', routeParams: { roomId: active.roomId } }));
      } catch {
        if (cancelled) return;
        transitionGuard.current = false;
        setTransitioning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, trpcClient, setHandoff, router]);

  // Seat mutations. On success refetch immediately (so occupancy updates ahead of the
  // next poll); a CONFLICT is non-fatal — show "seat just taken" and refresh.
  const onSeatError = useCallback(
    (error: unknown) => {
      if (trpcErrorCode(error) === 'CONFLICT') {
        setConflictMessage('That seat was just taken.');
        void refetchTable();
      }
    },
    [refetchTable],
  );

  const { mutate: joinSeatMutate } = useMutation(trpc.casual.joinSeat.mutationOptions());
  const { mutate: addBotMutate } = useMutation(trpc.casual.addBot.mutationOptions());
  const { isPending: leaving, mutate: leaveMutate } = useMutation(trpc.casual.leaveTable.mutationOptions());

  const takeSeat = useCallback(
    (seat: number) => {
      if (!tableId || pendingSeatAction) return;
      setConflictMessage(null);
      setPendingSeatAction({ kind: 'join', seat });
      joinSeatMutate(
        { seat, tableId },
        {
          onError: onSeatError,
          onSettled: () => setPendingSeatAction(null),
          onSuccess: () => void refetchTable(),
        },
      );
    },
    [tableId, pendingSeatAction, joinSeatMutate, onSeatError, refetchTable],
  );

  const addBot = useCallback(
    (seat: number) => {
      if (!tableId || pendingSeatAction) return;
      setConflictMessage(null);
      setPendingSeatAction({ kind: 'bot', seat });
      addBotMutate(
        { seat, tableId },
        {
          onError: onSeatError,
          onSettled: () => setPendingSeatAction(null),
          onSuccess: () => void refetchTable(),
        },
      );
    },
    [tableId, pendingSeatAction, addBotMutate, onSeatError, refetchTable],
  );

  const leave = useCallback(() => {
    if (!tableId || leaving) return;
    leaveMutate({ tableId }, { onSuccess: toHall });
  }, [tableId, leaving, leaveMutate, toHall]);

  const viewerPlayerId = me.data?.playerId ?? null;
  const viewerSeated =
    table?.seats.some((seat) => seat.kind === 'human' && seat.playerId === viewerPlayerId) ?? false;

  const phase: WaitingRoom['phase'] = transitioning
    ? 'transitioning'
    : tableIsPending
      ? 'loading'
      : tableIsError && !evicted
        ? 'error'
        : 'waiting';

  return {
    addBot,
    conflictMessage,
    leave,
    leaving,
    pendingSeatAction,
    phase,
    retry: () => void refetchTable(),
    table,
    takeSeat,
    viewerPlayerId,
    viewerSeated,
  };
}

/** The tRPC transport error code (`NOT_FOUND`, `CONFLICT`, …), if this is a tRPC client error. */
function trpcErrorCode(error: unknown): string | undefined {
  if (!(error instanceof TRPCClientError)) return undefined;
  const data: unknown = error.data;
  if (typeof data === 'object' && data !== null && 'code' in data) {
    const { code } = data;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
