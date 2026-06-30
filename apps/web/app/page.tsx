import { UserButton } from '@clerk/nextjs';

import { CasualHall } from '@/components/hall/casual-hall';

/**
 * The landing route — the casual hall (capability `casual-hall-web`). The page is a
 * thin shell: the sign-out affordance (Clerk's account menu) and the page chrome,
 * with the hall itself (identity, Quick Play / Create Table, Rejoin, and the
 * open-table browse list) owned by {@link CasualHall}.
 */
export default function Home() {
  return (
    <main className="
      flex min-h-screen flex-col items-center justify-center gap-6 p-8
    ">
      {/* Sign-out affordance: Clerk's account menu, which includes Sign out. */}
      <header className="absolute top-4 right-4">
        <UserButton />
      </header>

      <CasualHall />
    </main>
  );
}
