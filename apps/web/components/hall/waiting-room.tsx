'use client';

import { $path } from 'next-typesafe-url';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useWaitingRoom } from '@/lib/use-waiting-room';

import { SeatGrid } from './seat-grid';

/**
 * The casual waiting room (capability `casual-hall-web`): renders a table's live
 * seat occupancy and wires the seat actions (claim a specific seat, add a bot, or
 * leave) through {@link useWaitingRoom}, which owns the poll, the conflict handling,
 * the evicted-table redirect, and the live handoff. A `conflict` is shown as a
 * non-fatal "seat just taken" notice; a `spawning`/`live` table shows a status banner
 * while the controller hands the caller off to the play route.
 */
export function WaitingRoom({ tableId }: { tableId: string | undefined }) {
  const router = useRouter();
  const room = useWaitingRoom(tableId);

  const toHall = () => router.replace($path({ route: '/' }));

  if (room.phase === 'loading') {
    return <Centered title="Casual table">Loading table…</Centered>;
  }

  if (room.phase === 'error') {
    return (
      <Centered title="Could not load the table">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive">Something went wrong loading this table.</p>
          <div className="flex gap-2">
            <Button onClick={room.retry} variant="outline">
              Retry
            </Button>
            <Button onClick={toHall} variant="ghost">
              Back to hall
            </Button>
          </div>
        </div>
      </Centered>
    );
  }

  if (room.phase === 'transitioning' || !room.table) {
    return <Centered title="Starting game…">Handing you off to the table…</Centered>;
  }

  const { table } = room;
  const banner =
    table.status === 'spawning'
      ? 'Table full — starting the game…'
      : 'Waiting for players. Add bots to fill the table and start.';

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-6">
      <header className="flex flex-col items-center gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{table.variant.name}</h1>
        <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
          {banner}
        </p>
      </header>

      <div className="w-full max-w-2xl">
        <SeatGrid
          onAddBot={room.addBot}
          onTake={room.takeSeat}
          pendingKind={room.pendingSeatAction?.kind ?? null}
          pendingSeat={room.pendingSeatAction?.seat ?? null}
          table={table}
          viewerPlayerId={room.viewerPlayerId}
          viewerSeated={room.viewerSeated}
        />
      </div>

      {room.conflictMessage && <p className="
        text-sm text-amber-600
        dark:text-amber-400
      ">{room.conflictMessage}</p>}

      <Button disabled={room.leaving} onClick={room.leave} variant="outline">
        {room.leaving ? 'Leaving…' : 'Leave table'}
      </Button>
    </main>
  );
}

/** A simple centered single-message shell for the loading / error / transition phases. */
function Centered({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <main className="
      flex min-h-screen flex-col items-center justify-center gap-4 p-8
    ">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="max-w-sm text-center text-sm text-muted-foreground">{children}</div>
    </main>
  );
}
