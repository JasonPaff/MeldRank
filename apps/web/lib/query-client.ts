import { QueryClient } from '@tanstack/react-query';

/** A fresh TanStack Query client with the project's default options. */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid immediate refetches for data fetched during SSR.
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Return the request-appropriate `QueryClient` (design D2): a brand-new client on
 * the server so cache never leaks across SSR requests, and a single tab-lifetime
 * singleton in the browser so every component shares one async-state cache.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
