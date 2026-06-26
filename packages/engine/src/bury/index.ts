/**
 * The `bury/` module: the pure bury-validator for the `Bury` phase.
 * `buryableCards` returns the subset of the bidder's hand eligible to be buried
 * under the variant's `no-melded` / `no-trump` / `no-dix` restrictions. Pure,
 * deterministic, dependency-free.
 */
export { buryableCards } from './bury';
