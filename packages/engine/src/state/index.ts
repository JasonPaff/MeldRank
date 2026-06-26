/**
 * The pure `reduce(state, event)` state container: the serializable `State`
 * value with its public/private split, the closed `Event` union, and the
 * phase-guarded, lifecycle-advancing reducer. Wires the `Dealing → Auction`
 * slice in this change.
 */
export { reduce } from './reduce';
export {
  createInitialState,
  getContract,
  type State,
  type PublicState,
  type PrivateState,
  type SeatMeld,
  type SeatCapture,
} from './state';
export {
  EVENT_KINDS,
  type Event,
  type EventKind,
  type SystemEvent,
  type DealEvent,
  type TimeoutEvent,
} from './events';
