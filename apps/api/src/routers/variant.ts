import { VariantGetInputSchema, VariantGetOutputSchema, VariantListInputSchema, VariantListOutputSchema } from '@meldrank/shared';
import { apiError, publicProcedure, router } from '../trpc';

/**
 * Variant reference procedures (capability `account-and-reference-api`): the read-only
 * catalog a casual table is created from. `get` returns a typed `not-found` for an
 * unknown id; both are public projections resolved from `@meldrank/shared`.
 */
export const variantRouter = router({
  list: publicProcedure
    .input(VariantListInputSchema)
    .output(VariantListOutputSchema)
    .query(({ ctx }) => ctx.variants.list()),

  get: publicProcedure
    .input(VariantGetInputSchema)
    .output(VariantGetOutputSchema)
    .query(({ ctx, input }) => {
      const variant = ctx.variants.get(input.id);
      if (variant === null) {
        throw apiError('not-found', `unknown variant: ${input.id}`);
      }
      return variant;
    }),
});
