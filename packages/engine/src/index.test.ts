import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, isTrump } from './index';

describe('@meldrank/engine', () => {
  it('is importable and dependency-free', () => {
    expect(ENGINE_VERSION).toBe('0.0.0');
  });

  it('identifies the trump suit', () => {
    expect(isTrump('hearts', 'hearts')).toBe(true);
    expect(isTrump('spades', 'hearts')).toBe(false);
  });
});
