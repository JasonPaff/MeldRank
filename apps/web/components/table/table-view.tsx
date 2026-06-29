'use client';

import type { Card } from '@meldrank/engine';
import type { Suit } from '@meldrank/shared';

import { useState } from 'react';

import type { RenderModel } from '@/lib/table-store';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { TableIntent } from './intents';

import { CardBack, CardChip } from './card';
import { MoveClock, SeatClockBanks } from './clock';

/**
 * Pure table layout (tasks 6.2/6.3): own hand, opponents as `handSizes`
 * card-backs with seat status, the current/completed tricks, contract/trump +
 * auction standing, the running scorepad, and the phase action controls. It
 * renders exclusively from the derived {@link RenderModel} and emits a
 * fully-formed {@link TableIntent} through `submitIntent`; the connection layer
 * (the page) attaches the correlation id and sends it. No artwork, no animation.
 */

const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const SUIT_GLYPH: Record<Suit, string> = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const SEAT_COUNT = 4;

export function TableView({ model, submitIntent }: { model: RenderModel; submitIntent: (intent: TableIntent) => void }) {
  const pub = model.public;
  if (!pub) {
    return <p className="text-sm text-muted-foreground">Waiting for game state…</p>;
  }

  const canPlay = model.availableAction?.kind === 'playCard';
  const viewerSeat = model.viewer;
  const opponents = Array.from({ length: SEAT_COUNT }, (_, seat) => seat).filter((seat) => seat !== viewerSeat);
  // Per-seat clock banks, indexed by seat for O(1) lookup in the seat rows.
  const banksBySeat = new Map(model.seatClocks.map((bank) => [bank.seat, bank]));

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      {/* Opponents — face-down hands with presence + on-clock state. */}
      <section className="flex flex-wrap justify-center gap-6">
        {opponents.map((seat) => (
          <OpponentSeat
            banks={banksBySeat.get(seat)}
            handSize={model.handSizes[seat] ?? 0}
            key={seat}
            onClock={model.onClockSeat === seat}
            seat={seat}
            status={model.seatStatus[seat] ?? 'Empty'}
          />
        ))}
      </section>

      {/* Center — move clock, contract/trump, auction standing, tricks. */}
      <section
        className="
          flex flex-col items-center gap-3 rounded-lg border bg-card/40 p-4
        "
      >
        <MoveClock deadline={model.clockDeadline} />
        <ContractLine contract={pub.contract} phase={pub.phase} trump={pub.trump} />
        <AuctionStanding auction={pub.auction} />
        <CurrentTrick plays={pub.currentTrick.plays} />
        <p className="text-xs text-muted-foreground">
          {pub.completedTricks.length} trick{pub.completedTricks.length === 1 ? '' : 's'} completed
        </p>
      </section>

      {/* Running scorepad. */}
      <ScorePad cumulative={pub.scorePad.cumulative} />

      {/* Own seat — hand + the legal action for this phase. */}
      <section
        className="
          flex flex-col items-center gap-4 rounded-lg border bg-card p-4
        "
      >
        <header className="flex items-center gap-2 text-sm">
          <span className="font-medium">{viewerSeat === null ? 'Spectating' : `You — seat ${viewerSeat}`}</span>
          {viewerSeat !== null && banksBySeat.has(viewerSeat) && <SeatClockBanks banks={banksBySeat.get(viewerSeat)!} />}
          {viewerSeat !== null && model.onClockSeat === viewerSeat && (
            <span
              className="
                rounded-full bg-primary px-2 py-0.5 text-xs
                text-primary-foreground
              "
            >
              Your turn
            </span>
          )}
        </header>

        <div className="flex flex-wrap justify-center gap-2">
          {model.ownHand.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cards in hand.</p>
          ) : (
            model.ownHand.map((card) => (
              <CardChip
                card={card}
                disabled={model.pending}
                key={`${card.rank}-${card.suit}-${card.copyIndex}`}
                onSelect={
                  canPlay && viewerSeat !== null
                    ? () =>
                        submitIntent({
                          card: { copyIndex: card.copyIndex, rank: card.rank, suit: card.suit },
                          seat: viewerSeat,
                          type: 'playCard',
                        })
                    : undefined
                }
              />
            ))
          )}
        </div>

        {model.rejectReason && <p className="text-sm text-destructive">Move rejected: {model.rejectReason}</p>}
        {model.pending && <p className="text-sm text-muted-foreground">Submitting…</p>}

        {model.availableAction && viewerSeat !== null && (
          <ActionControls action={model.availableAction} seat={viewerSeat} submitIntent={submitIntent} />
        )}
      </section>
    </div>
  );
}

function ActionControls({
  action,
  seat,
  submitIntent,
}: {
  action: NonNullable<RenderModel['availableAction']>;
  seat: number;
  submitIntent: (intent: TableIntent) => void;
}) {
  if (action.kind === 'bid') {
    return <BidControls currentHigh={action.currentHigh} seat={seat} submitIntent={submitIntent} />;
  }
  if (action.kind === 'declareTrump') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted-foreground">Declare trump:</p>
        <div className="flex gap-2">
          {SUITS.map((suit) => (
            <Button key={suit} onClick={() => submitIntent({ seat, trump: suit, type: 'declareTrump' })} variant="outline">
              {SUIT_GLYPH[suit]} {suit}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  // playCard — the cards themselves are the controls.
  return <p className="text-sm text-muted-foreground">Select a card from your hand to play.</p>;
}

function AuctionStanding({ auction }: { auction: null | { highBid: null | { seatIndex: number; value: number } } }) {
  if (!auction) return null;
  return (
    <p className="text-xs text-muted-foreground">
      High bid: {auction.highBid ? `${auction.highBid.value} (seat ${auction.highBid.seatIndex})` : 'none yet'}
    </p>
  );
}

function BidControls({
  currentHigh,
  seat,
  submitIntent,
}: {
  currentHigh: null | number;
  seat: number;
  submitIntent: (intent: TableIntent) => void;
}) {
  const minBid = (currentHigh ?? 0) + 1;
  const [value, setValue] = useState(minBid);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <input
        className="
          h-9 w-20 rounded-md border bg-background px-2 text-sm tabular-nums
        "
        min={minBid}
        onChange={(e) => setValue(Number(e.target.value))}
        type="number"
        value={value}
      />
      <Button onClick={() => submitIntent({ seat, type: 'bid', value })}>Bid</Button>
      <Button onClick={() => submitIntent({ seat, type: 'pass' })} variant="outline">
        Pass
      </Button>
    </div>
  );
}

function ContractLine({
  contract,
  phase,
  trump,
}: {
  contract: null | { seatIndex: number; value: number };
  phase: string;
  trump: null | Suit;
}) {
  return (
    <div
      className="
        flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm
      "
    >
      <span className="text-muted-foreground">
        Phase: <span className="font-medium text-foreground">{phase}</span>
      </span>
      <span className="text-muted-foreground">
        Contract: <span className="font-medium text-foreground">{contract ? `${contract.value} (seat ${contract.seatIndex})` : '—'}</span>
      </span>
      <span className="text-muted-foreground">
        Trump: <span className="font-medium text-foreground">{trump ? `${SUIT_GLYPH[trump]} ${trump}` : '—'}</span>
      </span>
    </div>
  );
}

function CurrentTrick({ plays }: { plays: readonly { card: Card; seatIndex: number }[] }) {
  if (plays.length === 0) {
    return <p className="text-sm text-muted-foreground">No cards in the current trick.</p>;
  }
  return (
    <div className="flex flex-wrap items-end justify-center gap-3">
      {plays.map((play) => (
        <div className="flex flex-col items-center gap-1" key={play.seatIndex}>
          <CardChip card={play.card} />
          <span className="text-xs text-muted-foreground">seat {play.seatIndex}</span>
        </div>
      ))}
    </div>
  );
}

function OpponentSeat({
  banks,
  handSize,
  onClock,
  seat,
  status,
}: {
  banks?: RenderModel['seatClocks'][number];
  handSize: number;
  onClock: boolean;
  seat: number;
  status: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-lg border p-3', onClock && `
      border-primary ring-1 ring-primary
    `)}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">Seat {seat}</span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      {banks && <SeatClockBanks banks={banks} />}
      <div className="flex gap-1">
        {Array.from({ length: handSize }, (_, i) => (
          <CardBack key={i} />
        ))}
        {handSize === 0 && <span className="text-xs text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function ScorePad({ cumulative }: { cumulative: Readonly<Record<number, number>> }) {
  const sides = Object.keys(cumulative)
    .map(Number)
    .sort((a, b) => a - b);
  if (sides.length === 0) return null;
  return (
    <section className="flex justify-center gap-6 text-sm">
      {sides.map((side) => (
        <div className="flex flex-col items-center" key={side}>
          <span className="text-muted-foreground">Side {side}</span>
          <span className="font-semibold tabular-nums">{cumulative[side]}</span>
        </div>
      ))}
    </section>
  );
}
