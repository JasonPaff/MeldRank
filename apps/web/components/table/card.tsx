'use client';

import type { Card } from '@meldrank/engine';
import type { Suit } from '@meldrank/shared';

import { cn } from '@/lib/utils';

/**
 * Functional, legible card rendering (design Open Question — no artwork or
 * animation). A face-up card is a small bordered chip showing rank + suit glyph;
 * face-down opponent cards are featureless backs (the view never carries their
 * identity). Selectable own-hand cards render as buttons so the TrickPlay intent
 * loop can pick a card; non-interactive cards render as static chips.
 */

const SUIT_GLYPH: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

const RED_SUITS = new Set<Suit>(['diamonds', 'hearts']);

const CHIP_CLASS = `
  inline-flex h-12 w-9 items-center justify-center rounded-md border bg-card
  text-sm font-semibold tabular-nums shadow-xs
`;

/** A featureless face-down card; opponents are rendered as `handSizes[i]` of these. */
export function CardBack() {
  return (
    <span
      aria-hidden
      className={cn(
        CHIP_CLASS,
        `
          border-border bg-muted
          bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--color-border)_3px,var(--color-border)_4px)]
        `,
      )}
    />
  );
}

/** A face-up card. Pass `onSelect` to make it a selectable button. */
export function CardChip({ card, disabled, onSelect }: { card: Card; disabled?: boolean; onSelect?: () => void }) {
  const tone = RED_SUITS.has(card.suit) ? 'text-red-600' : 'text-foreground';
  const label = cardLabel(card);
  if (onSelect) {
    return (
      <button
        className={cn(
          CHIP_CLASS,
          tone,
          `
            transition-colors
            enabled:hover:border-ring enabled:hover:bg-accent
            disabled:opacity-50
          `,
        )}
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        {label}
      </button>
    );
  }
  return <span className={cn(CHIP_CLASS, tone)}>{label}</span>;
}

function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_GLYPH[card.suit]}`;
}
