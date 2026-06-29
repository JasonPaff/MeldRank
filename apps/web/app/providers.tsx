'use client';

import type { AppRouter } from '@meldrank/api';

import { ClerkProvider } from '@clerk/nextjs';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { type ReactNode, useState } from 'react';

import { ColyseusProvider } from '@/lib/colyseus';
import { env } from '@/lib/env';
import { getQueryClient } from '@/lib/query-client';
import { SessionStoreProvider } from '@/lib/store';
import { TRPCProvider } from '@/lib/trpc';

/**
 * The Clerk browser singleton mounted by `ClerkProvider`. The tRPC link reads the session
 * token imperatively per request (design D4) — it cannot call `useAuth()` from inside the
 * `useState`-constructed client — so it reaches for `window.Clerk`. Typed minimally to the
 * token accessor this file uses; Clerk's full type isn't augmented onto `Window` here.
 */
declare global {
  interface Window {
    Clerk?: { session?: { getToken(): Promise<null | string> } };
  }
}

/**
 * The single client boundary for the app (design D2): `app/layout.tsx` stays a
 * Server Component and renders this one `'use client'` tree, nesting
 * Clerk → nuqs → TanStack Query → tRPC → Zustand → Colyseus around every route.
 * It mounts with zero application network I/O — no procedure call, no room join.
 * `ClerkProvider` is outermost so the Clerk singleton (`window.Clerk`) exists
 * before the tRPC client reads the session token (design D4). The `NuqsAdapter`
 * teaches nuqs to read/write search params through the Next App Router.
 *
 * The tRPC `httpBatchLink` targets `NEXT_PUBLIC_API_URL` at its root, which is
 * where the API's standalone tRPC server mounts its procedures (no `/trpc`
 * prefix), and attaches the current Clerk session token as an
 * `Authorization: Bearer` header so the cross-origin API can authenticate the
 * caller. The token is read imperatively per request (not via `useAuth()`), so
 * the client — created once via `useState` for stability — never needs
 * rebuilding when the session changes.
 */
export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          async headers() {
            const token = await window.Clerk?.session?.getToken();
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
          url: env.NEXT_PUBLIC_API_URL,
        }),
      ],
    }),
  );

  return (
    <ClerkProvider publishableKey={env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY} signInUrl="/sign-in" signUpUrl="/sign-up">
      <NuqsAdapter>
        <QueryClientProvider client={queryClient}>
          <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
            <SessionStoreProvider>
              <ColyseusProvider>{children}</ColyseusProvider>
            </SessionStoreProvider>
          </TRPCProvider>
          {/* Dev-only query/cache inspector; the component no-ops in production builds. */}
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </NuqsAdapter>
    </ClerkProvider>
  );
}
