import { z } from 'zod';

/**
 * The shared cursor-pagination envelope (API Surface & Contracts §pagination):
 * every list procedure takes a `{ cursor?, limit }` input and returns a
 * `{ items, nextCursor }` output, so the client paginates one way across the
 * whole surface. `cursor` is an opaque continuation token (the producer's to
 * interpret); `nextCursor` is `null` on the final page.
 */

/** The default and maximum page sizes for a cursor-paginated list. */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** The input every cursor-paginated list procedure accepts. */
export const CursorPaginationInputSchema = z.object({
  /** Opaque continuation token from a prior page's `nextCursor`; absent for the first page. */
  cursor: z.string().optional(),
  /** Page size, clamped to {@link MAX_PAGE_LIMIT}; defaults to {@link DEFAULT_PAGE_LIMIT}. */
  limit: z.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export type CursorPaginationInput = z.infer<typeof CursorPaginationInputSchema>;

/**
 * Wrap an item schema in the shared pagination envelope: `{ items, nextCursor }`,
 * where `nextCursor` is `null` on the last page. Used to derive a list
 * procedure's output schema from its element schema.
 */
export function paginated<ItemSchema extends z.ZodTypeAny>(item: ItemSchema) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** The shape of a paginated page for an item type `T`. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
