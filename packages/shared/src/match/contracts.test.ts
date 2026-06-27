import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '../variant/canonical';
import {
  MATCH_RESULT_CHANNEL,
  MatchResultEventSchema,
  REPLAY_FORMAT,
  REPLAY_SCHEMA_VERSION,
  ReplayBlobV1Schema,
  type MatchResultEvent,
  type ReplayBlobV1,
} from './index';

describe('ReplayBlobV1 schema (design D7)', () => {
  const blob: ReplayBlobV1 = {
    format: REPLAY_FORMAT,
    schemaVersion: REPLAY_SCHEMA_VERSION,
    variant: SINGLE_DECK_PARTNERS,
    hands: [
      {
        handNumber: 1,
        bidderSeat: 0,
        contractValue: 250,
        trump: 'spades',
        made: true,
        lines: [
          { side: 0, meld: 40, counters: 25, total: 65 },
          { side: 1, meld: 20, counters: 10, total: 30 },
        ],
        cumulativeBySide: { '0': 65, '1': 30 },
      },
    ],
    intents: [
      { seat: 0, forcedTimeout: false, intent: { type: 'bid', seat: 0, value: 250 } },
      { seat: 1, forcedTimeout: true, intent: null },
    ],
    reveals: [
      {
        handNonce: 0,
        serverSeed: 'aabb',
        commit: 'ccdd',
        contributions: [{ seat: 0, clientSeed: '00ff' }],
      },
    ],
  };

  it('round-trips a fully-populated blob', () => {
    const parsed = ReplayBlobV1Schema.parse(blob);
    expect(parsed).toEqual(blob);
  });

  it('pins the format and schema version', () => {
    expect(REPLAY_FORMAT).toBe('meldrank-replay');
    expect(REPLAY_SCHEMA_VERSION).toBe(1);
    expect(ReplayBlobV1Schema.safeParse({ ...blob, schemaVersion: 2 }).success).toBe(false);
    expect(ReplayBlobV1Schema.safeParse({ ...blob, format: 'other' }).success).toBe(false);
  });

  it('rejects a non-hex seed reveal', () => {
    const bad = { ...blob, reveals: [{ ...blob.reveals[0]!, serverSeed: 'NOTHEX' }] };
    expect(ReplayBlobV1Schema.safeParse(bad).success).toBe(false);
  });
});

describe('MatchResultEvent schema (design D6)', () => {
  const event: MatchResultEvent = {
    matchId: '11111111-1111-1111-1111-111111111111',
    mode: 'casual',
    status: 'complete',
    resolutionReason: 'played_out',
    variantId: null,
    variantVersion: null,
    outcomes: [
      { seat: 0, outcome: 'win' },
      { seat: 1, outcome: 'loss' },
    ],
  };

  it('publishes to the single match.result channel', () => {
    expect(MATCH_RESULT_CHANNEL).toBe('match.result');
  });

  it('round-trips a result event', () => {
    expect(MatchResultEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an outcome outside the durable vocabulary', () => {
    const bad = { ...event, outcomes: [{ seat: 0, outcome: 'opponent_win' }] };
    expect(MatchResultEventSchema.safeParse(bad).success).toBe(false);
  });
});
