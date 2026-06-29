import { randomBytes } from 'node:crypto';
import { Room, ServerError, type Client, type Delayed } from 'colyseus';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS, type SeatTicket, type SpawnSeat, type VariantDefinition } from '@meldrank/shared';
import { createLogger, verifySeatTicket, type DatabaseClient, type Logger, type RedisClient } from '@meldrank/shared/server';
import { viewFor } from '@meldrank/engine';
import { brain, type BotContext } from '@meldrank/bots';
import { fromHex, toHex } from '@meldrank/fairness';
import {
  botSeatToDrive,
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
  seatBot,
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

/**
 * The room creation options (capability `match-spawn-gateway`). `variantId`/`seating`/
 * `bots` come from the spawn gateway's `matchMaker.createRoom('match', …)` call;
 * `db`/`redis`/`seatTicketSecret` are injected through the room *definition* defaults
 * in `apps/match/src/index.ts`. When `seating` is present it is authoritative — each
 * `bot` entry is filled at its seat index at creation and each `human` entry is left
 * empty awaiting a ticketed join; `bots` remains the cold-start/test fallback that
 * fills the lowest free seats when no `seating` is given.
 */
export interface MatchCreateOptions {
  readonly variantId?: string;
  readonly db?: DatabaseClient;
  readonly redis?: RedisClient;
  readonly bots?: number;
  readonly seating?: readonly SpawnSeat[];
  /** HMAC secret used to verify seat tickets at {@link MatchRoom.onAuth}. */
  readonly seatTicketSecret?: string;
  /**
   * The cross-service correlation id (capability `structured-logging`, design D4),
   * threaded from the API's `x-meldrank-trace-id` header through the spawn route. Bound
   * onto the room logger in {@link MatchRoom.onCreate} so the room's lifecycle logs
   * share the API's id for that spawn. Absent when no header was supplied — a no-op.
   */
  readonly traceId?: string;
  /**
   * The service base logger (capability `structured-logging`, design D3), injected via
   * the room definition defaults in `apps/match/src/index.ts`. `onCreate` derives the
   * per-room child (`{ roomId, traceId }`) from it. Absent in a bare test harness — the
   * room then falls back to a silent logger so it never logs without a backend wired.
   */
  readonly logger?: Logger;
}

/** The join options a connection presents — carrying the signed seat ticket. */
interface JoinOptions {
  readonly ticket?: string;
}

/** Production entropy for a hand's server seed: 32 fresh CSPRNG bytes. */
const serverSeed: ServerSeedSource = () => new Uint8Array(randomBytes(32));

/** Bounded retry for the durable write on a `persist` effect (design D5, risks). */
const PERSIST_MAX_ATTEMPTS = 3;
const PERSIST_BACKOFF_MS = 250;

/**
 * The humanized bot "think" delay range (design D4; Bots & AI — Design v1 §7): a bot
 * move is scheduled after a randomized delay in `[BOT_THINK_MIN_MS, BOT_THINK_MAX_MS]`
 * so the table renders bot turns at a readable pace. Kept well under the move-clock
 * base allotment (20s) so a bot never times itself out while "thinking".
 */
const BOT_THINK_MIN_MS = 400;
const BOT_THINK_MAX_MS = 1200;

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
   * The HMAC secret seat tickets are verified against at {@link onAuth} (capability
   * `match-spawn-gateway`, design D3), injected via the room definition options.
   * Undefined in a bare test harness; `onAuth` then fails closed (rejects every join).
   */
  private seatTicketSecret?: string;
  /**
   * The per-room structured logger (capability `structured-logging`, design D3/D4): the
   * injected service base logger bound with `{ roomId, traceId }` in {@link onCreate},
   * so every operational event rides those fields without re-interpolating them. Per-
   * event specifics (`seat`, `err`, …) are passed as the structured object at the call
   * site. Set in `onCreate`; a bare test harness with no injected logger gets a silent one.
   */
  private log!: Logger;
  /**
   * The single pending wall-clock timer (design D3): the acting seat's turn expiry or
   * the open contribution window's close. Re-armed from the new state after every
   * step; only ever one is outstanding.
   */
  private deadlineTimer?: Delayed;
  /**
   * The single in-flight bot "think" timer (design D3/D4): at most one bot move is
   * ever scheduled at a time. Cleared and re-armed after every step so a re-entrant
   * step never double-fires a bot, and cleared on a reclaim/dispose.
   */
  private botTimer?: Delayed;

  /**
   * The production clock seam (design D1): Colyseus's monotonic room clock, supplied
   * to every `RoomCore` step so the core's deadline arithmetic is server-authoritative.
   */
  private readonly now: Clock = () => this.clock.currentTime;

  override onCreate(options?: MatchCreateOptions): void {
    const variant = selectVariant(options?.variantId);
    this.core = createRoomCore(variant);
    this.maxClients = variant.seating.playerCount;
    // A room is spawned ahead of any human joining (the API's internal `createRoom`
    // reserves no Colyseus seat, and bots are seated in the core, not as clients), so
    // the room is empty of clients between spawn and the human's `joinById`. Colyseus'
    // default `autoDispose` would reap that empty room before the join lands — the
    // human would hit "room not found". Disable it: this room owns its own lifecycle
    // and disconnects/disposes itself once it reaches `Persisted` (see `run`).
    this.autoDispose = false;
    // The durable backend and the seat-ticket secret are injected through the room
    // definition options (design D5; capability `match-spawn-gateway`).
    this.db = options?.db;
    this.redis = options?.redis;
    this.seatTicketSecret = options?.seatTicketSecret;
    // Per-room child logger (design D3/D4): bind the creation-time identifiers — the
    // Colyseus `roomId` and the spawn-threaded `traceId` (a no-op when absent, design
    // D4). `matchId` is the DB id assigned at persistence; it rides the persist lines
    // where it becomes known. Without an injected base logger (a bare test harness),
    // fall back to a logger silenced at runtime so the room never logs with no backend wired.
    let base = options?.logger;
    if (base === undefined) {
      base = createLogger('match');
      base.level = 'silent';
    }
    this.log = base.child({ roomId: this.roomId, traceId: options?.traceId });

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

    // Seat-fill at creation (capability `bot-seating`, `match-spawn-gateway`). When the
    // spawn gateway supplies a `seating` assignment it is authoritative: each `bot` seat
    // is filled at its index and each `human` seat is left empty awaiting a ticketed
    // join. Without a `seating`, fall back to the cold-start/test `bots` count, filling
    // the lowest free seats. Either way, adopting each via `run()` advances the room to
    // `Live` once full and engages the bot driver through the shared tail.
    const seating = options?.seating;
    if (seating !== undefined) {
      for (let seat = 0; seat < seating.length && seat < variant.seating.playerCount; seat++) {
        if (seating[seat]?.kind === 'bot') {
          this.run(seatBot(this.core, serverSeed, this.now, seat));
        }
      }
    } else {
      const botCount = Math.max(0, Math.min(options?.bots ?? 0, variant.seating.playerCount));
      for (let i = 0; i < botCount; i++) {
        this.run(seatBot(this.core, serverSeed, this.now));
      }
    }
  }

  /**
   * Verify the seat ticket a joining human presents (capability `match-room-lifecycle`,
   * design D3). Checks the HMAC signature, the expiry, and that the ticket's `roomId`
   * matches this room; on success returns the decoded payload (Colyseus attaches it to
   * `client.auth`, where {@link onJoin} reads the reserved seat). Fails closed: a
   * missing secret, a missing/malformed/expired/tampered ticket, or a room mismatch all
   * reject the connection at the gate. The pure `RoomCore` is untouched — verification
   * is adapter-level.
   */
  override onAuth(_client: Client, options?: JoinOptions): SeatTicket {
    const secret = this.seatTicketSecret;
    if (secret === undefined || secret === '') {
      throw new ServerError(401, 'seat-ticket verification unavailable');
    }
    const token = options?.ticket;
    if (typeof token !== 'string') {
      throw new ServerError(401, 'missing seat ticket');
    }
    const payload = verifySeatTicket(token, secret, Date.now());
    if (payload === null || payload.roomId !== this.roomId) {
      throw new ServerError(401, 'invalid seat ticket');
    }
    return payload;
  }

  override onJoin(client: Client): void {
    // Bind to the seat the verified ticket reserves (set on `client.auth` by onAuth),
    // not the lowest free seat — server-authoritative seating (capability
    // `match-room-lifecycle`). A bare test harness with no ticket falls back to the
    // lowest free seat (`undefined` desired seat).
    const reservedSeat = (client.auth as SeatTicket | undefined)?.seat;
    const result = joinRoom(this.core, client.sessionId, serverSeed, this.now, reservedSeat);
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
    this.botTimer?.clear();
    this.botTimer = undefined;
    this.core = disposeRoom(this.core).state;
  }

  /**
   * Adopt a `RoomCore` step: take its next state, emit each effect to its target
   * connection, refresh the presence metadata, re-arm the pending deadline timer from
   * the new state, schedule the next bot move when a bot is on the clock (the single
   * universal driver tail — design D3), and — once the durable write has driven the
   * room to `Persisted` (capability `match-persistence`) — disconnect the room so it
   * disposes.
   */
  private run(step: StepResult): void {
    this.core = step.state;
    for (const effect of step.effects) {
      this.emit(effect);
    }
    this.syncMetadata();
    this.reschedule();
    this.maybeDriveBot();
    if (this.core.lifecycle === 'Persisted') {
      void this.disconnect();
    }
  }

  /**
   * Schedule the next bot move after any step (design D3/D4). When a bot seat is the
   * one the engine expects to act ({@link botSeatToDrive} — `seatToAct`, or the
   * contract winner during `DeclareTrump`/`Bury`), arm a single "think"-delayed timer
   * on the room clock to play it. Cold-start fill, casual takeover, and consecutive
   * bot turns all converge here — there is no separate driver path. A no-op when a
   * human is on the clock, nothing is on the clock, or the match has resolved.
   */
  private maybeDriveBot(): void {
    // Single in-flight bot timer: clear any prior schedule before re-evaluating, so a
    // re-entrant step (a bot move re-entering `run()`) never leaves two timers armed.
    this.botTimer?.clear();
    this.botTimer = undefined;
    const seat = botSeatToDrive(this.core);
    if (seat === null) {
      return;
    }
    const span = BOT_THINK_MAX_MS - BOT_THINK_MIN_MS;
    const delay = BOT_THINK_MIN_MS + Math.floor(Math.random() * (span + 1));
    this.botTimer = this.clock.setTimeout(() => {
      this.botTimer = undefined;
      this.driveBotMove(seat);
    }, delay);
  }

  /**
   * Fire a scheduled bot move (design D3): re-guard that `seat` is still the bot the
   * engine awaits (a reclaim or an intervening step may have moved on), derive its
   * `FilteredView` from the authoritative engine, ask the bot brain for an intent, and
   * submit it on the bot's synthetic connection through the *identical* authoritative
   * path a human intent takes. The resulting `run()` drives any subsequent bot turn to
   * completion. A rejected bot intent is surfaced loudly (it indicates a brain/legality
   * bug) rather than silently retried (task 4.4).
   */
  private driveBotMove(seat: number): void {
    if (botSeatToDrive(this.core) !== seat) {
      return;
    }
    const engine = this.core.engine;
    const assignment = this.core.seats.find((s) => s.seatIndex === seat);
    if (engine === null || assignment === undefined) {
      return;
    }
    const ctx: BotContext = { seat, variant: this.core.variant, difficulty: 'medium', random: Math.random };
    let intent: PlayerIntent;
    try {
      intent = brain(viewFor(engine, seat), ctx);
    } catch (error) {
      this.log.error({ seat, err: error }, 'bot brain failed');
      return;
    }
    const correlationId = `bot:${seat}:${this.clock.currentTime}`;
    const step = submitIntent(this.core, assignment.connectionId, intent, correlationId, serverSeed, this.now);
    if (step.effects.some((effect) => effect.kind === 'reject')) {
      this.log.error({ seat, intent }, 'bot intent rejected');
    }
    this.run(step);
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
    this.log.warn({ seat, timeoutCount }, 'abandonment signal');
  }

  /**
   * Forward the terminal abandonment resolution (design D5/D9). Slice #6 replaces this
   * with the real persistence + result-emission consumer; for now it is logged.
   */
  private onAbandonResolution(reason: ResolutionReason, outcomes: readonly SeatOutcome[]): void {
    this.log.warn({ reason, outcomes: outcomes.map((o) => ({ seat: o.seat, outcome: o.outcome })) }, 'abandonment resolution');
  }

  /**
   * Forward the abandon event to the leaver-penalty layer (capability
   * `match-disconnect-abandonment`). Thresholds/cooldowns are owned by the Anti-Cheat &
   * Moderation doc; this slice only fires the hook, logged until that consumer lands.
   */
  private onAbandonEvent(seat: number, reason: ResolutionReason): void {
    this.log.warn({ seat, reason }, 'abandon event');
  }

  /**
   * Handle a casual bot-takeover request (capability `match-disconnect-abandonment`,
   * `bot-seating`; design D8). The core has already marked the seat `BotControlled`;
   * the seat is now driven by the **same** adapter bot driver as a cold-start
   * seat-fill bot — there is no separate path. The driving itself is engaged by the
   * shared `run()` tail ({@link maybeDriveBot}) once the bot-controlled seat is the one
   * on the clock; a returning human reclaiming the seat (`reconnect`) restores it to
   * `Connected`, after which the tail no longer drives it. This hook is the operational
   * signal that the takeover happened.
   */
  private onBotTakeoverRequested(seat: number): void {
    this.log.warn({ seat }, 'bot takeover: seat now played by the in-process bot brain');
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
      this.log.error('persist skipped: no durable backend wired');
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
        this.log.info({ matchId, attempt }, 'match persisted');
        this.run(markPersisted(this.core));
        return;
      } catch (error) {
        if (attempt >= PERSIST_MAX_ATTEMPTS) {
          this.log.error({ err: error, attempts: PERSIST_MAX_ATTEMPTS }, 'durable write failed; disposing');
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
