## 1. Dependencies & environment

- [x] 1.1 Add the client foundation deps to `apps/web/package.json` at latest stable
      (verify each against the npm registry): `@trpc/client`, `@trpc/tanstack-react-query`,
      `@tanstack/react-query`, `zustand`, `colyseus.js`, plus the Tailwind v4 +
      shadcn(Base UI) toolchain (`tailwindcss`, `@tailwindcss/postcss`,
      `@base-ui-components/react`, and shadcn's required utility deps).
- [x] 1.2 Add `NEXT_PUBLIC_MATCH_URL` to the `@meldrank/shared` web env schema
      (`packages/shared/src/env/web.ts`) with a localhost match-origin default; export stays
      on the isomorphic root, never `@meldrank/shared/server`.
- [x] 1.3 Add `NEXT_PUBLIC_MATCH_URL` to root `.env.example` with a non-secret
      placeholder and confirm `pnpm env:check` agrees.

## 2. Styling baseline (Tailwind v4 + shadcn on Base UI)

- [x] 2.1 Configure Tailwind CSS v4 for Next 16 (PostCSS plugin + a global
      stylesheet) and import the stylesheet in `app/layout.tsx`.
- [x] 2.2 Initialize shadcn/ui against the **Base UI** registry
      (`@base-ui-components/react`), not Radix — `components.json`, the `cn` util, and the
      theme token baseline.
- [x] 2.3 Add one trivial shadcn(Base UI) component (e.g. Button) purely to prove the
      registry resolves and compiles; no feature use.

## 3. tRPC client (TanStack Query proxy)

- [x] 3.1 Create the typed tRPC client module bound to `AppRouter` (imported as a type
      from `@meldrank/api`) using `@trpc/tanstack-react-query` (`createTRPCContext` +
      option proxy); configure `httpBatchLink` to `${NEXT_PUBLIC_API_URL}/trpc` (confirm
      the API's tRPC mount path and adjust if needed).
- [x] 3.2 Verify the proxy is typed end-to-end: a reference to a known procedure path
      typechecks and an unknown path fails typecheck (no runtime call).

## 4. State & realtime providers

- [x] 4.1 Define the Zustand session/table store with a minimal placeholder shape and a
      context-bound provider + typed hook (SSR-safe instance, not a module global).
- [x] 4.2 Create the thin `ColyseusProvider` that constructs a `colyseus.js` `Client`
      from `NEXT_PUBLIC_MATCH_URL` under the client boundary (guarded against SSR) and
      exposes it; no `join`/`create`/`reconnect`.

## 5. Provider tree & shell

- [x] 5.1 Create a single `'use client'` `<Providers>` component nesting
      `QueryClientProvider` (per-request server / singleton client `QueryClient`) → tRPC
      provider → Zustand store provider → Colyseus provider.
- [x] 5.2 Render `<Providers>` around `{children}` in the server-component
      `app/layout.tsx`.
- [x] 5.3 Replace the smoke `app/page.tsx` with a minimal placeholder that proves the
      provider tree mounts (styled with a Tailwind/shadcn element) and performs no tRPC
      call and no room join on render.

## 6. Validation

- [x] 6.1 Run lint, typecheck, and tests via the validate agent across `apps/web`
      (and `packages/shared` for the env change); confirm `next build` and `next dev`
      succeed and the mounted shell issues no network I/O.
