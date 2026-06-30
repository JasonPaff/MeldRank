'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { $path } from 'next-typesafe-url';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/lib/store';
import { useTRPC } from '@/lib/trpc';

import { CreateTableButton } from './create-table-button';
import { OpenTableList } from './open-table-list';

/**
 * The casual hall (capability `casual-hall-web`, design D8b): the landing surface
 * composing the player's identity, the primary actions row (**Quick Play** |
 * **Create Table**), the live **Rejoin** affordance for an active match, and the
 * open-table browse list. Quick Play and Rejoin retain their F1 behavior — read the
 * caller's identity and any live match, stash the seat-ticket/handle into the
 * session store, and navigate to the play route; the hall only grows the page
 * composition around them. This component joins no Colyseus room.
 */
export function CasualHall() {
  const trpc = useTRPC();
  const router = useRouter();

  const setPlayerId = useSessionStore((s) => s.setPlayerId);
  const setHandoff = useSessionStore((s) => s.setHandoff);

  const me = useQuery(trpc.account.getMe.queryOptions());
  const active = useQuery(trpc.match.getActive.queryOptions());
  const quickPlay = useMutation(trpc.casual.quickPlay.mutationOptions());

  // Mirror the resolved identity into the session store once it loads.
  const playerId = me.data?.playerId ?? null;
  useEffect(() => {
    if (playerId) setPlayerId(playerId);
  }, [playerId, setPlayerId]);

  function rejoin() {
    if (!active.data) return;
    const { ticket, ...match } = active.data;
    setHandoff({ match, ticket: ticket ?? null });
    router.push($path({ route: '/table/[roomId]', routeParams: { roomId: active.data.roomId } }));
  }

  function startQuickPlay() {
    quickPlay.mutate(undefined, {
      onSuccess: ({ ticket }) => {
        const { roomId, seat, variantId } = ticket.payload;
        setHandoff({ match: { roomId, seat, variantId }, ticket });
        router.push($path({ route: '/table/[roomId]', routeParams: { roomId } }));
      },
    });
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">MeldRank</h1>

      {/* Identity — the first real browser→API round-trip. */}
      <section className="flex flex-col items-center gap-1 text-sm">
        {me.isPending ? (
          <p className="text-muted-foreground">Loading your identity…</p>
        ) : me.isError ? (
          <p className="text-destructive">Could not load your identity. Please retry.</p>
        ) : (
          <p className="text-muted-foreground">
            Signed in as <span className="font-mono text-foreground">{me.data.playerId}</span>
          </p>
        )}
      </section>

      {/* Primary actions: rejoin a live match if one exists, else Quick Play | Create Table. */}
      <section className="flex flex-col items-center gap-3">
        {active.isPending ? (
          <p className="text-sm text-muted-foreground">Checking for a live match…</p>
        ) : active.isError ? (
          <p className="text-sm text-destructive">Could not check for a live match. Please retry.</p>
        ) : active.data ? (
          <>
            <p className="text-sm text-muted-foreground">You have a match in progress.</p>
            <Button onClick={rejoin}>Rejoin match</Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Button disabled={quickPlay.isPending} onClick={startQuickPlay}>
                {quickPlay.isPending ? 'Finding a table…' : 'Quick Play'}
              </Button>
              <CreateTableButton />
            </div>
            {quickPlay.isError && <p className="text-sm text-destructive">Could not start a game. Please try again.</p>}
          </>
        )}
      </section>

      {/* Browse open tables (polled). */}
      <section className="flex w-full flex-col items-center gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Open tables</h2>
        <OpenTableList />
      </section>
    </div>
  );
}
