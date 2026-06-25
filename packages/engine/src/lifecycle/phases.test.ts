import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT } from '@meldrank/shared';
import {
  LIFECYCLE_PHASES,
  isLegalTransition,
  resolveActivePath,
  type LifecyclePhase,
} from './phases';

describe('Lifecycle phases', () => {
  it('is exactly the ten documented states', () => {
    expect([...LIFECYCLE_PHASES].sort()).toEqual(
      [
        'Auction',
        'Bury',
        'Dealing',
        'DeclareTrump',
        'HandScoring',
        'Melding',
        'MatchComplete',
        'Passing',
        'TrickPlay',
        'WidowReveal',
      ].sort(),
    );
    expect(LIFECYCLE_PHASES).toHaveLength(10);
  });
});

describe('Legal transition table', () => {
  it('accepts documented transitions', () => {
    expect(isLegalTransition('Dealing', 'Auction')).toBe(true);
    expect(isLegalTransition('Auction', 'WidowReveal')).toBe(true);
    expect(isLegalTransition('DeclareTrump', 'Melding')).toBe(true);
    expect(isLegalTransition('Melding', 'TrickPlay')).toBe(true);
  });

  it('rejects undocumented transitions', () => {
    expect(isLegalTransition('Auction', 'TrickPlay')).toBe(false);
    expect(isLegalTransition('Dealing', 'Melding')).toBe(false);
    expect(isLegalTransition('MatchComplete', 'Dealing')).toBe(false);
  });

  it('loops TrickPlay on itself until hands are empty', () => {
    expect(isLegalTransition('TrickPlay', 'TrickPlay')).toBe(true);
    expect(isLegalTransition('TrickPlay', 'HandScoring')).toBe(true);
  });

  it('branches HandScoring to both the next hand and match end', () => {
    expect(isLegalTransition('HandScoring', 'Dealing')).toBe(true);
    expect(isLegalTransition('HandScoring', 'MatchComplete')).toBe(true);
  });
});

describe('resolveActivePath', () => {
  it('skips widow, passing, and bury for Partners', () => {
    const path: LifecyclePhase[] = resolveActivePath(SINGLE_DECK_PARTNERS);
    expect(path).toEqual([
      'Dealing',
      'Auction',
      'DeclareTrump',
      'Melding',
      'TrickPlay',
      'HandScoring',
    ]);
    expect(path).not.toContain('WidowReveal');
    expect(path).not.toContain('Passing');
    expect(path).not.toContain('Bury');
  });

  it('includes widow reveal and bury but not passing for Cutthroat', () => {
    const path = resolveActivePath(SINGLE_DECK_CUTTHROAT);
    expect(path).toEqual([
      'Dealing',
      'Auction',
      'WidowReveal',
      'DeclareTrump',
      'Melding',
      'Bury',
      'TrickPlay',
      'HandScoring',
    ]);
    expect(path).not.toContain('Passing');
  });

  it('produces a path whose consecutive steps are all legal transitions', () => {
    for (const variant of [SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT]) {
      const path = resolveActivePath(variant);
      for (let i = 0; i < path.length - 1; i++) {
        expect(isLegalTransition(path[i]!, path[i + 1]!)).toBe(true);
      }
    }
  });
});
