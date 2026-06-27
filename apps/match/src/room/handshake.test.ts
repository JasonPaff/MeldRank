import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { commit } from '@meldrank/fairness';
import { createInitialState } from '@meldrank/engine';
import { assembleAndDeal, openHand } from './handshake';
import { createRoomCore, joinRoom, submitContribution } from './core';
import type { HandshakeContext, ServerSeedSource } from './types';

function fixedSeeder(start = 1): ServerSeedSource {
  let n = start;
  return () => {
    const bytes = new Uint8Array(32);
    bytes[0] = n & 0xff;
    n += 1;
    return bytes;
  };
}

function clientSeed(seat: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 100 + seat;
  return bytes;
}

function fillPartners(seed: ServerSeedSource) {
  let state = createRoomCore(SINGLE_DECK_PARTNERS);
  for (let i = 0; i < SINGLE_DECK_PARTNERS.seating.playerCount; i++) {
    state = joinRoom(state, `conn-${i}`, seed).state;
  }
  return state;
}

describe('pre-deal commit broadcast', () => {
  it('broadcasts the commit before any card is dealt', () => {
    const state = fillPartners(fixedSeeder());
    // Live, commit published, but no deal yet: the engine still holds no cards.
    expect(state.lifecycle).toBe('Live');
    expect(state.handshake).not.toBeNull();
    expect(state.engine!.public.phase).toBe('Dealing');
    expect(state.engine!.private.hands).toHaveLength(0);
  });

  it('reveals only the commitment hash, never the server seed', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS);
    for (let i = 0; i < 3; i++) state = joinRoom(state, `conn-${i}`, seed).state;
    const last = joinRoom(state, 'conn-3', seed);

    const commitEffect = last.effects.find((e) => e.kind === 'commit');
    expect(commitEffect).toBeDefined();
    const handshake = last.state.handshake!;
    const broadcastHash = commitEffect?.kind === 'commit' ? commitEffect.commit : new Uint8Array();
    // The broadcast carries the hash, which is the commitment of the secret seed…
    expect(Array.from(broadcastHash)).toEqual(Array.from(commit(handshake.serverSeed)));
    // …and is not the server seed itself.
    expect(Array.from(handshake.commit)).not.toEqual(Array.from(handshake.serverSeed));
  });
});

describe('contribute-after-commit ordering', () => {
  it('rejects a contribution when no commit window is open', () => {
    const seed = fixedSeeder();
    let state = fillPartners(seed);
    // Drive a full deal so the window closes (handshake cleared)…
    for (let i = 0; i < SINGLE_DECK_PARTNERS.seating.playerCount; i++) {
      state = submitContribution(state, `conn-${i}`, clientSeed(i)).state;
    }
    expect(state.handshake).toBeNull();
    // …a contribution now has no published commit to attach to.
    const result = submitContribution(state, 'conn-0', clientSeed(0));
    expect(result.effects[0]).toMatchObject({ kind: 'rejectContribution', reason: 'no-open-commit' });
  });

  it('records a contribution submitted after the commit', () => {
    const state = fillPartners(fixedSeeder());
    const result = submitContribution(state, 'conn-1', clientSeed(1));
    expect(result.state.handshake!.contributions).toHaveLength(1);
    expect(result.state.handshake!.contributions[0]!.seat).toBe(1);
  });

  it('rejects a second contribution from the same seat', () => {
    let state = fillPartners(fixedSeeder());
    state = submitContribution(state, 'conn-1', clientSeed(1)).state;
    const again = submitContribution(state, 'conn-1', clientSeed(1));
    expect(again.effects[0]).toMatchObject({ kind: 'rejectContribution', reason: 'already-contributed' });
  });

  it('deals once every seated connection has contributed', () => {
    let state = fillPartners(fixedSeeder());
    const count = SINGLE_DECK_PARTNERS.seating.playerCount;
    for (let i = 0; i < count - 1; i++) {
      const step = submitContribution(state, `conn-${i}`, clientSeed(i));
      expect(step.effects).toHaveLength(0); // not yet dealt
      state = step.state;
    }
    const final = submitContribution(state, `conn-${count - 1}`, clientSeed(count - 1));
    expect(final.state.handshake).toBeNull();
    expect(final.state.engine!.public.phase).toBe('Auction');
    expect(final.state.engine!.private.hands).toHaveLength(count);
    // Each seat received its own dealt view.
    expect(final.effects.filter((e) => e.kind === 'view')).toHaveLength(count);
  });
});

describe('seed assembly drives the deal', () => {
  const engine = createInitialState(SINGLE_DECK_PARTNERS);
  const seatCount = SINGLE_DECK_PARTNERS.seating.playerCount;
  const serverSeed = new Uint8Array(32).fill(7);

  function handshakeWith(seats: number[]): HandshakeContext {
    return {
      handNonce: 0,
      serverSeed,
      commit: commit(serverSeed),
      contributions: seats.map((seat) => ({ seat, clientSeed: clientSeed(seat) })),
    };
  }

  it('substitutes the deterministic fallback for absent seats and still deals a full deck', () => {
    // Only seat 0 contributed; seats 1..3 are absent → fallback.
    const dealt = assembleAndDeal(engine, handshakeWith([0]), seatCount);
    const dealtCards = dealt.private.hands.reduce((n, hand) => n + hand.cards.length, 0) + dealt.private.widow.length;
    const deckSize = SINGLE_DECK_PARTNERS.deck.ranks.length * SINGLE_DECK_PARTNERS.deck.suits.length * SINGLE_DECK_PARTNERS.deck.copiesPerCard;
    expect(dealt.private.hands).toHaveLength(seatCount);
    expect(dealtCards).toBe(deckSize);
  });

  it('reproduces the identical deal from the same committed handshake', () => {
    const a = assembleAndDeal(engine, handshakeWith([0, 1, 2, 3]), seatCount);
    const b = assembleAndDeal(engine, handshakeWith([0, 1, 2, 3]), seatCount);
    expect(a.private.hands).toEqual(b.private.hands);
    expect(a.private.widow).toEqual(b.private.widow);
  });

  it('different contributions yield a different deal', () => {
    const a = assembleAndDeal(engine, handshakeWith([0, 1, 2, 3]), seatCount);
    const altered: HandshakeContext = { ...handshakeWith([0, 1, 2, 3]), contributions: [{ seat: 0, clientSeed: new Uint8Array(32).fill(99) }] };
    const b = assembleAndDeal(engine, altered, seatCount);
    expect(a.private.hands).not.toEqual(b.private.hands);
  });
});

describe('next-hand handshake reset', () => {
  it('keeps a fresh Dealing engine for the first hand', () => {
    const engine = createInitialState(SINGLE_DECK_PARTNERS, 0);
    const { engine: opened, handshake } = openHand(engine, 0, new Uint8Array(32).fill(3));
    expect(opened.public.phase).toBe('Dealing');
    expect(opened.public.dealerSeat).toBe(0);
    expect(handshake.handNonce).toBe(0);
  });

  it('rotates the dealer and resets to Dealing when the prior hand has scored', () => {
    const base = createInitialState(SINGLE_DECK_PARTNERS, 2);
    const scored = { ...base, public: { ...base.public, phase: 'HandScoring' as const } };
    const { engine: opened } = openHand(scored, 1, new Uint8Array(32).fill(4));
    expect(opened.public.phase).toBe('Dealing');
    expect(opened.public.dealerSeat).toBe(3); // (2 + 1) % 4
  });
});
