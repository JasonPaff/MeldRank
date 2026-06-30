'use client';

import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { useMutation } from '@tanstack/react-query';
import { $path } from 'next-typesafe-url';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/lib/trpc';

/** v1 casual create defaults to Single-Deck Partners; no variant picker yet (design D4). */
const DEFAULT_VARIANT_ID = SINGLE_DECK_PARTNERS.id;

/**
 * Create-table action (spec "Create a casual table"): calls `casual.createTable` on
 * the default variant and, on success, navigates the creator into the waiting room
 * for the returned table (where they are already seated). The button is
 * pending-guarded so it cannot be double-submitted; a failure surfaces a retryable
 * error without navigating.
 */
export function CreateTableButton() {
  const trpc = useTRPC();
  const router = useRouter();
  const create = useMutation(trpc.casual.createTable.mutationOptions());

  function createTable() {
    create.mutate(
      { variantId: DEFAULT_VARIANT_ID },
      {
        onSuccess: (table) => {
          router.push($path({ route: '/table/pending/[tableId]', routeParams: { tableId: table.id } }));
        },
      },
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button disabled={create.isPending} onClick={createTable} variant="secondary">
        {create.isPending ? 'Creating…' : 'Create Table'}
      </Button>
      {create.isError && <p className="text-sm text-destructive">Could not create a table. Please try again.</p>}
    </div>
  );
}
