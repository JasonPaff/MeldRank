'use client';

import type { AppRouter } from '@meldrank/api';

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
 * The single client boundary for the app (design D2): `app/layout.tsx` stays a
 * Server Component and renders this one `'use client'` tree, nesting
 * nuqs → TanStack Query → tRPC → Zustand → Colyseus around every route. It
 * mounts with zero network I/O — no procedure call, no room join. The
 * `NuqsAdapter` teaches nuqs to read/write search params through the Next App
 * Router.
 *
 * The tRPC `httpBatchLink` targets `NEXT_PUBLIC_API_URL` at its root, which is
 * where the API's standalone tRPC server mounts its procedures (no `/trpc`
 * prefix). The client instance is created once via `useState` so it is stable
 * across re-renders.
 */
export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: env.NEXT_PUBLIC_API_URL })],
    }),
  );

  return (
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
  );
}
