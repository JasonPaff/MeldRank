import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, makeCard, LIFECYCLE_PHASES } from './index';

describe('@meldrank/engine', () => {
  it('is importable and dependency-free', () => {
    expect(ENGINE_VERSION).toBe('0.0.0');
  });

  it('re-exports the domain model and lifecycle from its root', () => {
    expect(makeCard('A', 'spades', 0)).toEqual({ rank: 'A', suit: 'spades', copyIndex: 0 });
    expect(LIFECYCLE_PHASES).toContain('TrickPlay');
  });
});
