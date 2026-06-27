import { randomBytes } from 'node:crypto';
import { Room, type Client, type Delayed } from 'colyseus';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import type { DatabaseClient, RedisClient } from '@meldrank/shared/server';
import { fromHex, toHex } from '@meldrank/fairness';
import {
  closeContributionWindow,
  createRoomCore,
  disposeRoom,
  expireClock,
  expireGrace,
  joinRoom,
  leaveRoom,
  markPersisted,
  pendingDeadline,
  reconnect,
  submitContribution,
  submitIntent,
  type Clock,
  type Effect,
  type MatchRecord,
  type PlayerIntent,
  type ResolutionReason,
  type RoomCoreState,
  type SeatOutcome,
  type ServerSeedSource,
  type StepResult,
} from '../room';
import { buildMatchResultEvent, persistMatchRecord, publishMatchResult } from '../persistence';
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

/** Bounded retry for the durable write on a `persist` effect (design D5, risks). */
const PERSIST_MAX_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = 250;

export class MatchRoom extends Room<{ state: RoomMetadata }> {
  private core!: RoomCoreState;
  /**
   * The durable backend (capability `match-persistence`), injected via the room
   * definition's options from `apps/match/src/index.ts`. Undefined in a bare test
   * harness that constructs the room without a backend; a completed match then logs
   * and disposes rather than persisting.
   */
  private db?: DatabaseClient;
  private redis?: RedisClient;
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

  override onCreate(options?: { variantId?: string; db?: DatabaseClient; redis?: RedisClient }): void {
    const variant = selectVariant(options?.variantId);
    this.core = createRoomCore(variant);
    this.maxClients = variant.seating.playerCount;
    // The durable backend is injected through the room definition options (design D5).
    this.db = options?.db;
    this.redis = options?.redis;

    const state = new RoomMetadata();
    state.lifecycle = this.core.lifecycle;
    state.seatToAct = -1;
    state.clockDeadline = -1;
    for (let seat = 0; seat < variant.seating.playerCount; seat++) {
      state.occupancy.push(false);
      state.seatStatus.push('Empty');
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

  /**
   * Handle a connection drop (task 4.1; capability `match-disconnect-abandonment`).
   * Pre-`Live`, `leaveRoom` frees the seat. While `Live`, `leaveRoom` marks the seat
   * `Disconnected` and stamps its grace deadline (the adapter's timer now also tracks
   * grace), then we hold the seat open with Colyseus `allowReconnection` for the
   * configured grace window: a successful return runs `reconnect` (token-keyed,
   * carrying the new session id) to restore and resync the seat; a rejected/expired
   * reconnection is left to the grace timer, which fires `expireGrace` to resolve it.
   */
  override async onLeave(client: Client): Promise<void> {
    const wasLive = this.core.lifecycle === 'Live';
    // The seat's stable token (the join-time identity) survives the drop — capture it
    // before `leaveRoom` so the reconnected client can reclaim the same seat index.
    const token = this.core.seats.find((seat) => seat.connectionId === client.sessionId)?.token;
    this.run(leaveRoom(this.core, client.sessionId, this.now));

    if (!wasLive || token === undefined) {
      return;
    }

    const graceSeconds = this.core.config.reconnectGraceMs / 1000;
    try {
      const reconnected = await this.allowReconnection(client, graceSeconds);
      this.run(reconnect(this.core, token, reconnected.sessionId, this.now));
    } catch {
      // Reconnection window elapsed or was rejected: the grace timer drives resolution.
    }
  }

  override onDispose(): void {
    this.deadlineTimer?.clear();
    this.deadlineTimer = undefined;
    this.core = disposeRoom(this.core).state;
  }

  /**
   * Adopt a `RoomCore` step: take its next state, emit each effect to its target
   * connection, refresh the presence metadata, re-arm the pending deadline timer from
   * the new state, and — once the durable write has driven the room to `Persisted`
   * (capability `match-persistence`) — disconnect the room so it disposes.
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
      // slightly-late or slightly-early fire still charges/closes/resolves correctly
      // (design D2/D3). Dispatch by the pending deadline's kind — `'grace'` carries the
      // disconnected seat whose reconnection window expired.
      this.run(this.fireDeadline(pending));
    }, delay);
  }

  /** Dispatch a fired pending deadline to its core entrypoint (design D2). */
  private fireDeadline(pending: NonNullable<ReturnType<typeof pendingDeadline>>): StepResult {
    switch (pending.kind) {
      case 'turn':
        return expireClock(this.core, this.now, serverSeed);
      case 'contribution':
        return closeContributionWindow(this.core, this.now);
      case 'grace':
        return expireGrace(this.core, pending.seat!, this.now, serverSeed);
    }
  }

  /** Translate one effect into a send to its addressed connection (or a server signal). */
  private emit(effect: Effect): void {
    // Server-side signals carry no per-connection payload: they are forwarded to their
    // stubbed consumers (slices #5/#6 and the Anti-Cheat & Moderation leaver-penalty
    // layer) rather than sent to a client.
    switch (effect.kind) {
      case 'abandonmentSignal':
        this.onAbandonmentSignal(effect.seat, effect.timeoutCount);
        return;
      case 'abandonResolution':
        this.onAbandonResolution(effect.reason, effect.outcomes);
        return;
      case 'abandonEvent':
        this.onAbandonEvent(effect.seat, effect.reason);
        return;
      case 'botTakeoverRequested':
        this.onBotTakeoverRequested(effect.seat);
        return;
      case 'persist':
        this.onPersist(effect.record);
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
   * Forward a repeated-timeout abandonment signal (design D7). This slice now also
   * resolves the ranked forfeit in the core; this hook remains the signal forwarder for
   * the leaver-penalty layer, logged until that consumer lands.
   */
  private onAbandonmentSignal(seat: number, timeoutCount: number): void {
    console.warn(`[MatchRoom ${this.roomId}] abandonment signal: seat ${seat} reached ${timeoutCount} timeouts`);
  }

  /**
   * Forward the terminal abandonment resolution (design D5/D9). Slice #6 replaces this
   * with the real persistence + result-emission consumer; for now it is logged.
   */
  private onAbandonResolution(reason: ResolutionReason, outcomes: readonly SeatOutcome[]): void {
    const summary = outcomes.map((o) => `${o.seat}:${o.outcome}`).join(', ');
    console.warn(`[MatchRoom ${this.roomId}] abandonment resolution: ${reason} (${summary})`);
  }

  /**
   * Forward the abandon event to the leaver-penalty layer (capability
   * `match-disconnect-abandonment`). Thresholds/cooldowns are owned by the Anti-Cheat &
   * Moderation doc; this slice only fires the hook, logged until that consumer lands.
   */
  private onAbandonEvent(seat: number, reason: ResolutionReason): void {
    console.warn(`[MatchRoom ${this.roomId}] abandon event: seat ${seat} (${reason})`);
  }

  /**
   * Forward a casual bot-takeover request (design D8). Slice #5 (`apps/bots`) replaces
   * this with a real bot worker joining behind the human intent interface; for now it is
   * logged. The seat is already marked `BotControlled` in the core.
   */
  private onBotTakeoverRequested(seat: number): void {
    console.warn(`[MatchRoom ${this.roomId}] bot takeover requested: seat ${seat}`);
  }

  /**
   * Durably persist the completed match (design D5; capability `match-persistence`).
   * The room rests at `Complete`; the adapter writes the record, publishes the result
   * event, and only then drives `Complete → Persisted` (which disposes the room). With
   * no backend wired (a bare test harness), there is nothing to persist — log and
   * dispose so the room never leaks.
   */
  private onPersist(record: MatchRecord): void {
    if (this.db === undefined || this.redis === undefined) {
      console.error(`[MatchRoom ${this.roomId}] persist skipped: no durable backend wired`);
      void this.disconnect();
      return;
    }
    void this.persistWithRetry(this.db, this.redis, record);
  }

  /**
   * Write + publish with bounded backoff (design D5, risks). On a confirmed
   * write+publish, advance the room to `Persisted` (driving disposal via {@link run}).
   * On permanent failure after the retry budget, log and still dispose so the room does
   * not leak — the result is lost rather than the process wedged, and the room stays at
   * `Complete` until that disposal.
   */
  private async persistWithRetry(db: DatabaseClient, redis: RedisClient, record: MatchRecord): Promise<void> {
    for (let attempt = 1; attempt <= PERSIST_MAX_ATTEMPTS; attempt++) {
      try {
        const matchId = await persistMatchRecord(db, record);
        await publishMatchResult(redis, buildMatchResultEvent(record, matchId));
        this.run(markPersisted(this.core));
        return;
      } catch (error) {
        if (attempt >= PERSIST_MAX_ATTEMPTS) {
          console.error(`[MatchRoom ${this.roomId}] durable write failed after ${PERSIST_MAX_ATTEMPTS} attempts; disposing`, error);
          void this.disconnect();
          return;
        }
        await delay(PERSIST_BACKOFF_MS * attempt);
      }
    }
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
    this.state.seatStatus.clear();
    for (let seat = 0; seat < this.core.seatCount; seat++) {
      const assignment = this.core.seats.find((a) => a.seatIndex === seat);
      this.state.occupancy.push(assignment !== undefined);
      // Surface a dropped/bot-held seat to the lobby/table UI (task 4.4); `'Empty'`
      // when the seat is unfilled.
      this.state.seatStatus.push(assignment?.connectionStatus ?? 'Empty');
    }
  }
}

/** Resolve the room's variant from the create options (defaults to Partners). */
function selectVariant(variantId?: string): VariantDefinition {
  return variantId === 'single-deck-cutthroat' ? SINGLE_DECK_CUTTHROAT : SINGLE_DECK_PARTNERS;
}

/** Resolve after `ms`, the inter-attempt backoff for the durable write (design D5). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
