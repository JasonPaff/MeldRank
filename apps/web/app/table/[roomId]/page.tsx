'use client';

import { $path } from 'next-typesafe-url';
import { useRouteParams } from 'next-typesafe-url/app';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { TableView } from '@/components/table/table-view';
import { Button } from '@/components/ui/button';
import { TableStoreProvider, useRenderModel } from '@/lib/table-store';
import { useTableConnection } from '@/lib/use-table-connection';

import { Route } from './route-type';

/** Stable no-op subscribe for the client-gate store (it never notifies). */
const subscribeNoop = () => () => {};

/**
 * F2b live table. Thin renderer over {@link useTableConnection}, the resilience
 * controller that owns the whole Client↔Match lifecycle (warm-handoff join,
 * cold-load reconnect, in-table reconnect/resync, and token persistence). The
 * route component owns only the store provider and the rendering: the live clock
 * (F2b D1), a non-blocking "reconnecting…" banner over the last authoritative view
 * (D4), the match-complete terminal, and the return-to-lobby affordances.
 *
 * The table is strictly client-rendered: {@link TableSurface} is gated behind
 * {@link useIsClient} so its Colyseus-dependent hooks never run during SSR.
 */
export default function TablePage() {
  const isClient = useIsClient();
  return <TableStoreProvider>{isClient ? <TableSurface /> : <TableBootPlaceholder />}</TableStoreProvider>;
}

function MatchCompleteBanner({ model, onReturn }: { model: ReturnType<typeof useRenderModel>; onReturn: () => void }) {
  const standings = model.matchResult?.standings ?? [];
  return (
    <section
      className="
        flex w-full max-w-3xl flex-col items-center gap-3 rounded-lg border
        border-primary bg-card p-4
      "
    >
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

/** Non-blocking reconnect indicator shown over the held view during `reconnecting` (D4, task 6.1). */
function ReconnectingBanner() {
  return (
    <div
      aria-live="polite"
      className="
        flex w-full max-w-3xl items-center justify-center gap-2 rounded-lg
        border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm
        text-amber-700
        dark:text-amber-400
      "
      role="status"
    >
      <span className="size-2 animate-pulse rounded-full bg-amber-500" />
      Connection lost — reconnecting…
    </div>
  );
}

function ReturnToLobby({ message, onReturn, title }: { message: string; onReturn: () => void; title: string }) {
  return (
    <main
      className="
        flex min-h-screen flex-col items-center justify-center gap-4 p-8
      "
    >
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-center text-sm text-muted-foreground">{message}</p>
      <Button onClick={onReturn}>Return to lobby</Button>
    </main>
  );
}

/** Pre-hydration placeholder; the client immediately replaces it with {@link TableSurface}. */
function TableBootPlaceholder() {
  return (
    <main
      className="
        flex min-h-screen flex-col items-center justify-center gap-4 p-8
      "
    >
      <h1 className="text-lg font-semibold tracking-tight">MeldRank table</h1>
      <p className="text-sm text-muted-foreground">Connecting to the table…</p>
    </main>
  );
}

function TableSurface() {
  const { data: routeParams } = useRouteParams(Route.routeParams);
  const router = useRouter();

  const roomId = routeParams?.roomId;
  const { noSession, submitIntent } = useTableConnection(roomId);
  const model = useRenderModel();

  const returnToLobby = () => router.push($path({ route: '/' }));

  // Cold load with neither a seat ticket nor a persisted token — nothing to resume.
  if (noSession) {
    return (
      <ReturnToLobby
        message="No active seat. Head back to the lobby to start or rejoin a game."
        onReturn={returnToLobby}
        title="No table to join"
      />
    );
  }

  // Grace window exhausted (or an unrecoverable connection error).
  if (model.status === 'error') {
    return (
      <ReturnToLobby message="The table connection was lost before the match finished." onReturn={returnToLobby} title="Connection error" />
    );
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

      {model.status === 'reconnecting' && <ReconnectingBanner />}

      {model.status === 'complete' && <MatchCompleteBanner model={model} onReturn={returnToLobby} />}

      {model.status !== 'connecting' && <TableView model={model} submitIntent={submitIntent} />}
    </main>
  );
}

/**
 * True only after hydration, on the client. {@link useTableConnection} calls
 * `useColyseus()`, which throws during SSR because the Colyseus client is
 * constructed under the client boundary only (the server context value is null).
 * `useSyncExternalStore` returns the server snapshot (`false`) during SSR and the
 * first hydration render — so there is no hydration mismatch — then re-renders with
 * `true` on the client, at which point it is safe to mount {@link TableSurface}.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
