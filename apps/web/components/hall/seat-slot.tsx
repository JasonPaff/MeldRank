'use client';

import type { TableSeat } from '@meldrank/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * One waiting-room seat (spec "Waiting room renders live seat occupancy") — a single
 * polymorphic `Card` branching on `seat.kind`, viewer identity, and emptiness,
 * mirroring the in-game `OpponentSeat` status pattern (which stays a separate
 * concern). An **empty** seat on an `open` table offers **Take seat** (unless the
 * viewer is already seated) and **Add bot**; an occupied seat shows a status badge,
 * with the viewer's own seat highlighted.
 */
export function SeatSlot({
  index,
  joinable,
  onAddBot,
  onTake,
  pendingKind,
  seat,
  viewerPlayerId,
  viewerSeated,
}: {
  index: number;
  /** True when the table is still `open` (seat actions allowed). */
  joinable: boolean;
  onAddBot: () => void;
  onTake: () => void;
  /** This seat's in-flight action, or null. */
  pendingKind: 'bot' | 'join' | null;
  seat: TableSeat;
  viewerPlayerId: null | string;
  /** True when the viewer already occupies a seat (hides a second "Take seat"). */
  viewerSeated: boolean;
}) {
  const isYou = seat.kind === 'human' && seat.playerId === viewerPlayerId;
  const busy = pendingKind !== null;

  return (
    <Card className={cn('items-center gap-3 py-4', isYou && `
      border-primary ring-1 ring-primary
    `)}>
      <span className="text-xs font-medium text-muted-foreground">Seat {index + 1}</span>

      {seat.kind === 'human' ? (
        <Badge variant={isYou ? 'default' : 'secondary'}>{isYou ? 'You' : 'Player'}</Badge>
      ) : seat.kind === 'bot' ? (
        <Badge variant="outline">Bot</Badge>
      ) : joinable ? (
        <div className="flex flex-col items-center gap-2">
          {!viewerSeated && (
            <Button disabled={busy} onClick={onTake} size="sm">
              {pendingKind === 'join' ? 'Taking…' : 'Take seat'}
            </Button>
          )}
          <Button disabled={busy} onClick={onAddBot} size="sm" variant="outline">
            {pendingKind === 'bot' ? 'Adding…' : 'Add bot'}
          </Button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Empty</span>
      )}
    </Card>
  );
}
