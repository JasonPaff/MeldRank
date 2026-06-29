import { AccountGetMeInputSchema, AccountGetMeOutputSchema } from '@meldrank/shared';
import { protectedProcedure, router } from '../trpc';

/**
 * Account procedures (capability `account-and-reference-api`). `getMe` resolves the
 * authenticated caller over the centralized identity seam (`ctx.playerId`, the internal
 * `players.id`; design D5) and returns the local player view. Onboarding is reported
 * complete (no onboarding flow this change); the display identity is Clerk-derived.
 */
export const accountRouter = router({
  getMe: protectedProcedure
    .input(AccountGetMeInputSchema)
    .output(AccountGetMeOutputSchema)
    .query(({ ctx }) => ({ playerId: ctx.playerId, onboardingComplete: true })),
});
