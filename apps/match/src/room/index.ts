/**
 * The pure `RoomCore` (design D2): the room lifecycle machine, the provably-fair
 * shuffle handshake, and the authoritative intent loop — all as pure functions over
 * plain data, free of any transport. The Colyseus `Room` adapter consumes this
 * surface and performs the actual sends.
 */
export {
  createRoomCore,
  joinRoom,
  leaveRoom,
  submitContribution,
  submitIntent,
  expireClock,
  closeContributionWindow,
  pendingDeadline,
  disposeRoom,
  type CreateRoomOptions,
} from './core';
export { chargeElapsed, deadlineFor, grantBase, DEFAULT_CLOCK_CONFIG } from './clock';
export { isLegalRoomTransition, advanceLifecycle, LIFECYCLE_ORDER } from './lifecycle';
export { seatForConnection, isFull, lowestFreeSeat } from './seating';
export type {
  RoomLifecycle,
  RoomCoreState,
  SeatAssignment,
  SeatClock,
  HandshakeContext,
  ServerSeedSource,
  Clock,
  ClockConfig,
  SeatClockSnapshot,
  PendingDeadline,
  Effect,
  StepResult,
  JoinResult,
  JoinOutcome,
  IntentRejectReason,
  ContributionRejectReason,
  JoinRejectReason,
  PlayerIntent,
} from './types';
