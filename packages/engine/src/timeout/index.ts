/**
 * The `timeout/` module: the §5 `TimeoutMove`. `TimeoutMove(state)` computes the
 * deterministic Ruling 5 forced move for the seat-to-act when its clock expires —
 * a `pass` where passing is legal, otherwise the lowest-value legal card — or
 * `null` where no forced move is defined. Pure, deterministic, dependency-free;
 * `reduce` applies the returned intent through the normal intent path.
 */
export { TimeoutMove } from './timeout';
