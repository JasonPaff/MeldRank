import { randomBytes } from 'node:crypto';
import { Room, type Client, type Delayed } from 'colyseus';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { fromHex, toHex } from '@meldrank/fairness';
import {
  closeContributionWindow,
  createRoomCore,
  disposeRoom,
  expireClock,
  joinRoom,
  leaveRoom,
  pendingDeadline,
  submitContribution,
  submitIntent,
  type Clock,
  type Effect,
  type PlayerIntent,
  type RoomCoreState,
  type ServerSeedSource,
  type StepResult,
} from '../room';
import { RoomMetadata } from './schema';

/**
 * The Colyseus `Room` adapter (design D2, task 5.2): a **thin shell** over the pure
 * `RoomCore`. It owns nothing about the game — it wires `onJoin`/`onMessage`/
 * `onLeave`/`onDispose` to `RoomCore` functions and translates the returned effects
 * into per-connection `client.send`s. The authoritative engine `State` is never
 * synced through Colyseus schema; only the non-secret presence metadata
 * ({@link RoomMetadata}) is, and every card-bearing payload is a per-recipient
 * `viewFor` message (design D1).
 */

/** A submitted move plus its client-generated correlation id (design D4). */
interface IntentMessage {
  readonly intent: PlayerIntent;
  readonly correlationId: string;
}

/** A seat's `clientSeed` contribution, hex-encoded on the wire. */
interface ContributeMessage {
  readonly clientSeed: string;
}

/** Production entropy for a hand's server seed: 32 fresh CSPRNG bytes. */
const serverSeed: ServerSeedSource = () => new Uint8Array(randomBytes(32));

export class MatchRoom extends Room<{ state: RoomMetadata }> {
  private core!: RoomCoreState;
  /**
   * The single pending wall-clock timer (design D3): the acting seat's turn expiry or
   * the open contribution window's close. Re-armed from the new state after every
   * step; only ever one is outstanding.
   */
  private deadlineTimer?: Delayed;

  /**
   * The production clock seam (design D1): Colyseus's monotonic room clock, supplied
   * to every `RoomCore` step so the core's deadline arithmetic is server-authoritative.
   */
  private readonly now: Clock = () => this.clock.currentTime;

  override onCreate(options?: { variantId?: string }): void {
    const variant = selectVariant(options?.variantId);
    this.core = createRoomCore(variant);
    this.maxClients = variant.seating.playerCount;

    const state = new RoomMetadata();
    state.lifecycle = this.core.lifecycle;
    state.seatToAct = -1;
    state.clockDeadline = -1;
    for (let seat = 0; seat < variant.seating.playerCount; seat++) {
      state.occupancy.push(false);
    }
    this.setState(state);

    this.onMessage('intent', (client: Client, message: IntentMessage) => {
      this.run(submitIntent(this.core, client.sessionId, message.intent, message.correlationId, serverSeed, this.now));
    });
    this.onMessage('contribute', (client: Client, message: ContributeMessage) => {
      this.run(submitContribution(this.core, client.sessionId, fromHex(message.clientSeed), this.now));
    });
  }

  override onJoin(client: Client): void {
    const result = joinRoom(this.core, client.sessionId, serverSeed, this.now);
    if (result.outcome.status === 'rejected') {
      // Throwing in onJoin rejects the connection (Colyseus convention).
      throw new Error(`join rejected: ${result.outcome.reason}`);
    }
    this.run(result);
  }

  override onLeave(client: Client): void {
    this.run(leaveRoom(this.core, client.sessionId));
  }

  override onDispose(): void {
    this.deadlineTimer?.clear();
    this.deadlineTimer = undefined;
    this.core = disposeRoom(this.core).state;
  }

  /**
   * Adopt a `RoomCore` step: take its next state, emit each effect to its target
   * connection, refresh the presence metadata, re-arm the pending deadline timer from
   * the new state, and — once a completed match has run through to the inert
   * `Persisted` transition — disconnect the room so it disposes.
   */
  private run(step: StepResult): void {
    this.core = step.state;
    for (const effect of step.effects) {
      this.emit(effect);
    }
    this.syncMetadata();
    this.reschedule();
    if (this.core.lifecycle === 'Persisted') {
      void this.disconnect();
    }
  }

  /**
   * Re-arm the single pending deadline timer (design D3): clear any prior timer and,
   * if the new state has a pending deadline, schedule its expiry step on the Colyseus
   * clock. An accepted move that changed the deadline cancels-and-reschedules here; a
   * state with nothing on the clock leaves no timer armed.
   */
  private reschedule(): void {
    this.deadlineTimer?.clear();
    this.deadlineTimer = undefined;
    const pending = pendingDeadline(this.core);
    if (pending === null) {
      return;
    }
    const delay = Math.max(0, pending.at - this.clock.currentTime);
    this.deadlineTimer = this.clock.setTimeout(() => {
      this.deadlineTimer = undefined;
      // Recompute against the injected `now`: the core re-guards the deadline, so a
      // slightly-late or slightly-early fire still charges/closes correctly (design D3).
      const step = pending.kind === 'turn' ? expireClock(this.core, this.now, serverSeed) : closeContributionWindow(this.core, this.now);
      this.run(step);
    }, delay);
  }

  /** Translate one effect into a send to its addressed connection (or a server signal). */
  private emit(effect: Effect): void {
    if (effect.kind === 'abandonmentSignal') {
      // Slice #4 wires the real consumer; for now it is a logged/published signal.
      this.onAbandonmentSignal(effect.seat, effect.timeoutCount);
      return;
    }
    const client = this.findClient(effect.connectionId);
    if (client === undefined) {
      return;
    }
    switch (effect.kind) {
      case 'view':
        client.send('view', effect.view);
        break;
      case 'commit':
        client.send('commit', { handNonce: effect.handNonce, commit: toHex(effect.commit) });
        break;
      case 'accept':
        client.send('accept', { correlationId: effect.correlationId, view: effect.view });
        break;
      case 'reject':
        client.send('reject', { correlationId: effect.correlationId, reason: effect.reason, view: effect.view });
        break;
      case 'rejectContribution':
        client.send('rejectContribution', { reason: effect.reason });
        break;
      case 'clockState':
        client.send('clockState', { actingSeat: effect.actingSeat, deadline: effect.deadline, seats: effect.seats });
        break;
    }
  }

  /**
   * Forward a repeated-timeout abandonment signal (design D7). This slice only logs
   * it; the disconnect/reconnect/abandonment slice (#4) replaces this with the real
   * forfeit/substitution consumer.
   */
  private onAbandonmentSignal(seat: number, timeoutCount: number): void {
    console.warn(`[MatchRoom ${this.roomId}] abandonment signal: seat ${seat} reached ${timeoutCount} timeouts`);
  }

  private findClient(connectionId: string): Client | undefined {
    for (const client of this.clients) {
      if (client.sessionId === connectionId) {
        return client;
      }
    }
    return undefined;
  }

  /** Mirror the non-secret room state into the synced presence schema. */
  private syncMetadata(): void {
    this.state.lifecycle = this.core.lifecycle;
    this.state.seatToAct = this.core.engine?.public.seatToAct ?? -1;
    // Surface the on-clock deadline for the lobby/table UI; -1 when nothing is pending.
    this.state.clockDeadline = pendingDeadline(this.core)?.at ?? -1;
    this.state.occupancy.clear();
    for (let seat = 0; seat < this.core.seatCount; seat++) {
      this.state.occupancy.push(this.core.seats.some((assignment) => assignment.seatIndex === seat));
    }
  }
}

/** Resolve the room's variant from the create options (defaults to Partners). */
function selectVariant(variantId?: string): VariantDefinition {
  return variantId === 'single-deck-cutthroat' ? SINGLE_DECK_CUTTHROAT : SINGLE_DECK_PARTNERS;
}
