'use client';

import type { CasualTable } from '@meldrank/shared';

import { SeatSlot } from './seat-slot';

/**
 * Lays out a table's N seats as a responsive grid of {@link SeatSlot}s, wiring each
 * seat's pending state and actions from the waiting-room controller. Seat actions are
 * offered only while the table is `open`.
 */
export function SeatGrid({
  onAddBot,
  onTake,
  pendingKind,
  pendingSeat,
  table,
  viewerPlayerId,
  viewerSeated,
}: {
  onAddBot: (seat: number) => void;
  onTake: (seat: number) => void;
  pendingKind: 'bot' | 'join' | null;
  /** The seat index with an action in flight, or null. */
  pendingSeat: null | number;
  table: CasualTable;
  viewerPlayerId: null | string;
  viewerSeated: boolean;
}) {
  const joinable = table.status === 'open';

  return (
    <div className="
      grid w-full grid-cols-2 gap-3
      sm:grid-cols-4
    ">
      {table.seats.map((seat, index) => (
        <SeatSlot
          index={index}
          joinable={joinable}
          key={index}
          onAddBot={() => onAddBot(index)}
          onTake={() => onTake(index)}
          pendingKind={pendingSeat === index ? pendingKind : null}
          seat={seat}
          viewerPlayerId={viewerPlayerId}
          viewerSeated={viewerSeated}
        />
      ))}
    </div>
  );
}
