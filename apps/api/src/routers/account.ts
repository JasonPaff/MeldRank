import { AccountGetMeInputSchema, AccountGetMeOutputSchema } from '@meldrank/shared';
import { publicProcedure, router } from '../trpc';

/**
 * Account procedures (capability `account-and-reference-api`). `getMe` resolves the
 * caller over the centralized stub identity (`ctx.playerId`, design D5) and returns the
 * local player view. Onboarding is reported complete in this stubbed slice; unit E
 * swaps the identity source without touching this body.
 */
export const accountRouter = router({
  getMe: publicProcedure
    .input(AccountGetMeInputSchema)
    .output(AccountGetMeOutputSchema)
    .query(({ ctx }) => ({ playerId: ctx.playerId, onboardingComplete: true })),
});
