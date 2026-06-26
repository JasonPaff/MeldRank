/**
 * The `view/` module: the pure per-seat filtered-view projection (design D1).
 * `viewFor` derives, from the full engine `State` and a viewer identity, the
 * `FilteredView` that viewer is entitled to see — the hidden-information boundary
 * the Match Runtime enforces, kept in the engine's pure/tested lane. Pure,
 * deterministic, dependency-free.
 */
export { viewFor, type FilteredView, type OwnRegion } from './view';
