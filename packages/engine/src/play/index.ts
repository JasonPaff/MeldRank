/**
 * The `play/` module: the two §5 trick drivers and the card-strength comparator
 * they share. `LegalPlayValidator` computes the legal subset of a seat's hand
 * (follow-suit, must-trump-when-void, strict must-beat); `TrickResolver` picks a
 * completed trick's winner and totals its captured counters; `trickStrength`
 * ranks a card within a trick context. All pure, deterministic, dependency-free.
 */
export { LegalPlayValidator } from './legal';
export { TrickResolver, capturedCounters } from './resolve';
export { trickStrength, rankValue } from './strength';
