/**
 * The MeldDetector: the pure `(hand, trump, meldTable) → { melds, total }` that
 * computes a seat's maximum legal meld set, with cross-class reuse, within-class
 * non-reuse, the run-vs-royal-marriage rule, and double-vs-two-singles.
 */
export { MeldDetector, type MeldResult } from './meld';
