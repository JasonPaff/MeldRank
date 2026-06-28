'use client';

import { useRouteParams } from 'next-typesafe-url/app';

import { useSessionStore } from '@/lib/store';

import { Route } from './route-type';

/**
 * F1 table stub — the F1/F2 boundary. It closes the lobby's navigation handoff by
 * rendering the active-match handle the lobby stashed in the session store, but
 * does **not** join, create, or reconnect any Colyseus room and renders no game
 * state. F2 fills this placeholder with the real table UI (reading the seat ticket
 * + handle from the same store, and rehydrating from `match.getActive` on a cold
 * load since the in-memory stash does not survive a refresh).
 *
 * The `roomId` segment is read through next-typesafe-url's `useRouteParams` against
 * the colocated {@link Route} schema, so the param is validated and typed rather
 * than pulled untyped from the raw `params` promise.
 */
export default function TableStub() {
  const { data: routeParams } = useRouteParams(Route.routeParams);
  const activeMatch = useSessionStore((s) => s.activeMatch);

  return (
    <main
      className="
        flex min-h-screen flex-col items-center justify-center gap-4 p-8
      "
    >
      <p className="text-sm text-muted-foreground">connecting… — table UI lands in F2</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Room</dt>
        <dd className="font-mono">{activeMatch?.roomId ?? routeParams?.roomId ?? '—'}</dd>
        <dt className="text-muted-foreground">Seat</dt>
        <dd className="font-mono">{activeMatch ? activeMatch.seat : '—'}</dd>
        <dt className="text-muted-foreground">Variant</dt>
        <dd className="font-mono">{activeMatch?.variantId ?? '—'}</dd>
      </dl>
    </main>
  );
}
