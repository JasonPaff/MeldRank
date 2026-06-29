import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Clerk route protection (capability `web-client-foundation`). The player-scoped surfaces
 * — the lobby (`/`) and the table (`/table/...`) — require an authenticated session; an
 * unauthenticated visitor is redirected to `/sign-in`. The sign-in / sign-up routes are
 * left public (not matched here), so they render without a redirect loop. Identity itself
 * is still enforced server-side at the API edge; this is the client-side gate.
 */
const isProtectedRoute = createRouteMatcher(['/', '/table(.*)']);

export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) await auth.protect();
  },
  { signInUrl: '/sign-in', signUpUrl: '/sign-up' },
);

export const config = {
  // Run on every route except Next internals and static files; always run on API/tRPC routes.
  matcher: ['/((?!_next|.*\\..*).*)', '/', '/(api|trpc)(.*)'],
};
