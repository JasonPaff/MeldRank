'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { $path } from 'next-typesafe-url';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/lib/store';
import { useTRPC } from '@/lib/trpc';

/**
 * F1 lobby. The first surface that exercises the Client↔API tRPC seam from a real
 * browser: on load it reads the caller's stub identity (`account.getMe`) and any
 * live match (`match.getActive`) through the F0 TanStack-Query proxy, then offers
 * either a **Rejoin** affordance (live match) or the **Quick Play** action that
 * spawns a bot-filled room. On a successful action it stashes the seat ticket +
 * room handle into the session store and navigates to the table route — the F2
 * table UI consumes that handoff. This component joins no Colyseus room.
 */
export default function Home() {
  const trpc = useTRPC();
  const router = useRouter();

  const setPlayerId = useSessionStore((s) => s.setPlayerId);
  const setHandoff = useSessionStore((s) => s.setHandoff);

  const me = useQuery(trpc.account.getMe.queryOptions());
  const active = useQuery(trpc.match.getActive.queryOptions());
  const quickPlay = useMutation(trpc.casual.quickPlay.mutationOptions());

  // Mirror the resolved identity into the session store once it loads (a side
  // effect, so it runs in an effect rather than during render).
  const playerId = me.data?.playerId ?? null;
  useEffect(() => {
    if (playerId) setPlayerId(playerId);
  }, [playerId, setPlayerId]);

  function rejoin() {
    if (!active.data) return;
    setHandoff({ match: active.data, ticket: null });
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
    <main
      className="
        flex min-h-screen flex-col items-center justify-center gap-6 p-8
      "
    >
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

      {/* Either rejoin a live match or start a new one. */}
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
            <Button disabled={quickPlay.isPending} onClick={startQuickPlay}>
              {quickPlay.isPending ? 'Finding a table…' : 'Quick Play'}
            </Button>
            {quickPlay.isError && <p className="text-sm text-destructive">Could not start a game. Please try again.</p>}
          </>
        )}
      </section>
    </main>
  );
}
