'use client';

import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/lib/trpc';

import { OpenTableRow } from './open-table-row';

/** Browse-list poll cadence: slower than the waiting room (design Open Question). */
const OPEN_TABLES_REFETCH_MS = 5_000;

/**
 * The open-table browse list: polls `casual.listOpenTables` on an interval so newly
 * created tables appear and filled ones drop off without a manual reload (spec
 * "Browse open casual tables"). Renders a loading, retryable-error, or explicit
 * empty state; the create-table and Quick Play entry points live alongside it in the
 * hall, so the empty state stays minimal here.
 */
export function OpenTableList() {
  const trpc = useTRPC();
  const open = useQuery({
    ...trpc.casual.listOpenTables.queryOptions({ limit: 20 }),
    refetchInterval: OPEN_TABLES_REFETCH_MS,
  });

  if (open.isPending) {
    return <p className="text-sm text-muted-foreground">Loading open tables…</p>;
  }

  if (open.isError) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-destructive">Could not load open tables.</p>
        <Button onClick={() => void open.refetch()} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  if (open.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No open tables yet — create one to get started.</p>;
  }

  return (
    <ul className="flex w-full flex-col gap-3">
      {open.data.items.map((table) => (
        <li key={table.id}>
          <OpenTableRow table={table} />
        </li>
      ))}
    </ul>
  );
}
