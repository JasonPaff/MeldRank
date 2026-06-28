import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS, type VariantView } from '@meldrank/shared';

/**
 * The resolvable Variant Definition catalog (capability `account-and-reference-api`).
 * A casual table is created from one of these; `variant.list`/`variant.get` project
 * them read-only. This slice serves the two frozen canonical variants directly from
 * `@meldrank/shared`; a later slice can resolve a wider, stored catalog behind the
 * same interface.
 */
export interface VariantCatalog {
  /** Every resolvable variant, for `variant.list`. */
  list(): VariantView[];
  /** The single variant for `id`, or `null` when none matches (`variant.get`). */
  get(id: string): VariantView | null;
}

/** The default variant a `quickPlay` table is created on (Single-Deck Partners). */
export const DEFAULT_VARIANT_ID = SINGLE_DECK_PARTNERS.id;

const CANONICAL: readonly VariantView[] = [SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT];

/** The canonical-variant catalog backed by the frozen `@meldrank/shared` fixtures. */
export const variantCatalog: VariantCatalog = {
  list: () => [...CANONICAL],
  get: (id) => CANONICAL.find((variant) => variant.id === id) ?? null,
};
