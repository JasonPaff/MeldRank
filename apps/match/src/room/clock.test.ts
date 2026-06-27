import { describe, expect, it } from 'vitest';
import { chargeElapsed, deadlineFor, grantBase, DEFAULT_CLOCK_CONFIG } from './clock';
import type { SeatClock } from './types';

const config = DEFAULT_CLOCK_CONFIG;

/** A seat with a fresh base and full reserve under the default profile. */
function freshSeat(): SeatClock {
  return { remainingBaseMs: config.baseMs, remainingReserveMs: config.reserveMs };
}

describe('chargeElapsed', () => {
  it('deducts from base alone when the seat acts within its base', () => {
    const charged = chargeElapsed(freshSeat(), 5_000);
    expect(charged.remainingBaseMs).toBe(config.baseMs - 5_000);
    expect(charged.remainingReserveMs).toBe(config.reserveMs); // reserve untouched
  });

  it('overflows the excess past base into the reserve', () => {
    // 25s elapsed against a 20s base → 5s draws from reserve.
    const charged = chargeElapsed(freshSeat(), 25_000);
    expect(charged.remainingBaseMs).toBe(0);
    expect(charged.remainingReserveMs).toBe(config.reserveMs - 5_000);
  });

  it('floors both banks at zero when the reserve is exhausted', () => {
    // Far more than base + reserve elapsed → both banks bottom out at zero.
    const charged = chargeElapsed(freshSeat(), config.baseMs + config.reserveMs + 50_000);
    expect(charged.remainingBaseMs).toBe(0);
    expect(charged.remainingReserveMs).toBe(0);
  });

  it('treats a negative elapsed as zero (no bank goes up)', () => {
    const charged = chargeElapsed(freshSeat(), -1_000);
    expect(charged).toEqual(freshSeat());
  });
});

describe('deadlineFor', () => {
  it('is the turn start plus remaining base plus remaining reserve', () => {
    const seat: SeatClock = { remainingBaseMs: 8_000, remainingReserveMs: 12_000 };
    expect(deadlineFor(1_000, seat)).toBe(1_000 + 8_000 + 12_000);
  });

  it('reproduces the identical deadline from identical inputs', () => {
    const seat = freshSeat();
    expect(deadlineFor(42, seat)).toBe(deadlineFor(42, seat));
  });
});

describe('grantBase', () => {
  it('resets base to the configured value and leaves the reserve alone', () => {
    const drained: SeatClock = { remainingBaseMs: 0, remainingReserveMs: 30_000 };
    const granted = grantBase(drained, config);
    expect(granted.remainingBaseMs).toBe(config.baseMs);
    expect(granted.remainingReserveMs).toBe(30_000); // non-refilling
  });

  it('persists a partially-spent reserve across the turn boundary', () => {
    // Spend into reserve this turn, then start the next turn: base refreshes, the
    // reduced reserve carries over.
    const afterTurn = chargeElapsed(freshSeat(), config.baseMs + 7_000);
    expect(afterTurn.remainingReserveMs).toBe(config.reserveMs - 7_000);
    const nextTurn = grantBase(afterTurn, config);
    expect(nextTurn.remainingBaseMs).toBe(config.baseMs);
    expect(nextTurn.remainingReserveMs).toBe(config.reserveMs - 7_000);
  });
});
