'use client';

import type { RenderModel } from '@/lib/table-store';

import { useCountdown } from '@/lib/use-countdown';
import { cn } from '@/lib/utils';

/**
 * Move-clock rendering (F2b D1): the on-clock seat's live countdown and each
 * seat's remaining base/reserve banks, both derived from the payloads the room
 * already sends (`clockState` / synced `clockDeadline`). Informational only — the
 * match server enforces the actual timeout — so the countdown clamps at zero and
 * applies no skew correction.
 */

/**
 * The live countdown for the seat on the clock. Renders nothing when no move is
 * pending (`deadline` null) so the table shows no active countdown between hands
 * or at completion.
 */
export function MoveClock({ deadline }: { deadline: null | number }) {
  const remaining = useCountdown(deadline);
  if (remaining === null) return null;
  const urgent = remaining <= 10_000;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">On the clock:</span>
      <span className={cn('font-mono font-semibold tabular-nums', urgent ? `
        text-destructive
      ` : `text-foreground`)}>
        {formatRemaining(remaining)}
      </span>
    </div>
  );
}

/** A single seat's base/reserve banks from the latest `clockState`. */
export function SeatClockBanks({ banks }: { banks: RenderModel['seatClocks'][number] }) {
  return (
    <span className="font-mono text-xs text-muted-foreground tabular-nums">
      {formatBank(banks.remainingBaseMs)} <span className="opacity-60">+{formatBank(banks.remainingReserveMs)}</span>
    </span>
  );
}

/** `m:ss` for the static per-seat banks (tenths are noise at bank scale). */
function formatBank(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** `mm:ss.t` for a positive ms remaining; the tenths give the ticking a pulse. */
function formatRemaining(ms: number): string {
  const totalTenths = Math.ceil(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}
