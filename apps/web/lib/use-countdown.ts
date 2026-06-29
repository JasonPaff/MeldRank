'use client';

import { useEffect, useEffectEvent, useState } from 'react';

/** How often the countdown recomputes; informational, so coarse is fine (F2b D1). */
const TICK_MS = 250;

/**
 * View-local move-clock countdown (F2b D1). Recomputes `max(0, deadline - now)` on
 * a ≈250 ms interval and clamps at zero — no clock-skew correction, since the
 * match server is the timeout authority and this number is purely informational.
 *
 * The tick lives here, in the view, not in the store: the store holds only the
 * latest `clockState`/`clockDeadline`, so no write happens per frame. When
 * `deadline` is null (no pending move) the countdown is null and runs no timer.
 *
 * The recompute reads `deadline` and `Date.now()` through an Effect Event so the
 * setState is not a synchronous effect write and the interval need not re-subscribe
 * on every value change.
 */
export function useCountdown(deadline: null | number): null | number {
  const [remaining, setRemaining] = useState<null | number>(null);

  const recompute = useEffectEvent(() => {
    setRemaining(deadline === null ? null : Math.max(0, deadline - Date.now()));
  });

  useEffect(() => {
    // Defer the first compute off the synchronous effect path; the timer and the
    // interval are the only setState sites (both via the Effect Event), so the
    // store-write-per-frame and synchronous-effect-write concerns both stay clear.
    const kick = setTimeout(() => recompute(), 0);
    if (deadline === null) return () => clearTimeout(kick);
    const id = setInterval(() => recompute(), TICK_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, [deadline]);

  return remaining;
}
