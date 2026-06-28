import { Button } from '@/components/ui/button';

/**
 * F0 placeholder. Renders inside the root provider tree (TanStack Query + tRPC +
 * Zustand + Colyseus from `app/layout.tsx`) and exercises the Tailwind v4 +
 * shadcn(Base UI) baseline via a styled `Button`. It issues no tRPC procedure
 * call and joins no Colyseus room — lobby (F1) and table (F2) own that behavior.
 */
export default function Home() {
  return (
    <main
      className="
        flex min-h-screen flex-col items-center justify-center gap-4 p-8
      "
    >
      <h1 className="text-2xl font-semibold tracking-tight">MeldRank</h1>
      <p className="text-sm text-muted-foreground">Client foundation ready.</p>
      <Button>Get started</Button>
    </main>
  );
}
