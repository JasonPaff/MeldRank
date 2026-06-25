import type { VariantDefinition } from '@meldrank/shared';

/**
 * Seats and team membership, per "Game Engine — Abstract Model" §4. A `Seat` is
 * a table position that either belongs to a team or stands alone. Seats and
 * their teams are *derived* from a `VariantDefinition`: partnership variants
 * group seats into teams (Partners: opposite seats partnered); free-for-all
 * variants yield teamless seats (Cutthroat).
 */

/**
 * A table position. `teamId` is the index of the partnership the seat belongs
 * to, or `null` in a free-for-all variant.
 */
export interface Seat {
  readonly index: number;
  readonly teamId: number | null;
}

/**
 * Derive the seats for a variant. The seat count equals the variant's player
 * count; each seat's `teamId` is the index of the partnership containing it, or
 * `null` when the variant has no teams.
 */
export function deriveSeats(variant: VariantDefinition): Seat[] {
  const { playerCount, teams } = variant.seating;
  const teamOf = (index: number): number | null => {
    if (teams.mode === 'free-for-all') {
      return null;
    }
    const teamId = teams.partnerships.findIndex((partnership) => partnership.includes(index));
    return teamId >= 0 ? teamId : null;
  };

  return Array.from({ length: playerCount }, (_, index) => ({ index, teamId: teamOf(index) }));
}
