import type { ClockConfig, SeatClock } from './types';

/**
 * The pure move-clock arithmetic (spec: match-move-clocks, design D2). Every
 * function here is a deterministic, non-mutating function of plain numbers — given
 * the injected time, a seat's expiry and the effect of elapsed time on its banks are
 * fully reproducible, with no wall clock and no transport. The Colyseus adapter owns
 * the real timer (design D3); this module only computes deadlines and charges banks.
 */

/**
 * The locked default move-clock profile (design D6): a 20s per-move base allotment
 * backed by a 90s non-refilling reserve, a 10s contribution window, and a 3-timeout
 * abandonment threshold. Ranked and casual share this today; the config seam exists
 * so a future change can diverge them without touching specs or core logic.
 */
export const DEFAULT_CLOCK_CONFIG: ClockConfig = {
  baseMs: 20_000,
  reserveMs: 90_000,
  contributionWindowMs: 10_000,
  timeoutAbandonThreshold: 3,
};

/**
 * Charge `elapsedMs` against a seat's banks: the current turn's base is consumed
 * first, then the overflow draws down the non-refilling reserve, with neither bank
 * ever falling below zero (spec: "Reserve drains only after base is gone"). Pure: it
 * returns a fresh {@link SeatClock} and mutates nothing.
 */
export function chargeElapsed(clock: SeatClock, elapsedMs: number): SeatClock {
  const elapsed = Math.max(0, elapsedMs);
  const remainingBaseMs = Math.max(0, clock.remainingBaseMs - elapsed);
  const overflow = Math.max(0, elapsed - clock.remainingBaseMs);
  const remainingReserveMs = Math.max(0, clock.remainingReserveMs - overflow);
  return { remainingBaseMs, remainingReserveMs };
}

/**
 * The seat's authoritative expiry (spec: "Deadline computed from injected time"):
 * the time the turn began plus everything the seat has left to spend — its remaining
 * base allotment and its remaining reserve. Pure and deterministic given the inputs.
 */
export function deadlineFor(turnStartedAt: number, clock: SeatClock): number {
  return turnStartedAt + clock.remainingBaseMs + clock.remainingReserveMs;
}

/**
 * Grant a seat a fresh base allotment for a new turn (spec: "Base resets each turn"):
 * `remainingBaseMs` is reset to the configured `baseMs`, and the reserve is left
 * untouched so it is **never** refilled between turns. Pure.
 */
export function grantBase(clock: SeatClock, config: ClockConfig): SeatClock {
  return { remainingBaseMs: config.baseMs, remainingReserveMs: clock.remainingReserveMs };
}
