/**
 * The `score/` module: the §5 scoring drivers. `HandScorer` folds each seat's
 * recorded meld and captured counters into per-side hand results, applies the
 * meld-needs-a-trick gate, and evaluates the bidding side's made/set verdict and
 * set penalty against the contract — variant-driven so one function serves both
 * ranked variants. Pure, deterministic, dependency-free. The future `MatchScorer`
 * joins it here.
 */
export { HandScorer, type HandResult } from './score';
