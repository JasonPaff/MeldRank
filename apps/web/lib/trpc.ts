'use client';

import type { AppRouter } from '@meldrank/api';

import { createTRPCContext } from '@trpc/tanstack-react-query';

/**
 * The typed tRPC integration for the web client (design D1), built on the
 * TanStack Query proxy — **not** the classic `createTRPCReact` hooks. Bound to
 * the API's exported `AppRouter`, so every procedure path and its input/output
 * resolve end-to-end from the server contract.
 *
 * - `TRPCProvider` mounts the client + shared `QueryClient` into the tree.
 * - `useTRPC()` returns the option proxy; call sites read
 *   `useQuery(trpc.x.queryOptions(input))` / `useMutation(trpc.x.mutationOptions())`.
 * - `useTRPCClient()` returns the raw client for imperative calls.
 *
 * Procedure call sites belong to later slices (F1/F2); F0 only provides the wiring.
 */
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
