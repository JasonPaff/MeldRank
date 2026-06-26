import type { Card, DealResult } from '@meldrank/engine';
import { concatBytes, lenPrefixed, u32be, utf8ToBytes } from './encoding';
import { DEAL_TAG, domainHash } from './hash';

/**
 * Canonical encoding of a single card: its rank and suit as length-prefixed
 * UTF-8 (self-describing, so the digest does not depend on any enum-ordering
 * convention) plus its `copyIndex`. The two physical copies of a card stay
 * distinct, so the digest pins the exact physical deal, not just card values.
 */
function encodeCard(card: Card): Uint8Array {
  return concatBytes(lenPrefixed(utf8ToBytes(card.rank)), lenPrefixed(utf8ToBytes(card.suit)), u32be(card.copyIndex));
}

/**
 * Digest of a dealt result — one hand per seat (in seat order) plus the widow —
 * per design D7. `verify` re-runs the real engine `deal` and compares its result
 * against this digest, so the encoding must be canonical and total: every hand's
 * seat index and card count are length-framed, and the widow is appended, so no
 * two distinct deals share a digest and no field boundary is ambiguous.
 */
export function dealtResultDigest(result: DealResult): Uint8Array {
  const parts: Uint8Array[] = [u32be(result.hands.length)];
  for (const hand of result.hands) {
    parts.push(u32be(hand.seatIndex), u32be(hand.cards.length));
    for (const card of hand.cards) {
      parts.push(encodeCard(card));
    }
  }
  parts.push(u32be(result.widow.length));
  for (const card of result.widow) {
    parts.push(encodeCard(card));
  }
  return domainHash(DEAL_TAG, concatBytes(...parts));
}
