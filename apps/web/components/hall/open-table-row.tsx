'use client';

import type { CasualTable } from '@meldrank/shared';

import { $path } from 'next-typesafe-url';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent } from '@/components/ui/card';

/**
 * One open casual table in the browse list: its variant, a seat-occupancy badge
 * (filled/total, with the bot count when any), and an **Open** affordance that
 * navigates into the table's waiting room **without claiming a seat** (design D8c) —
 * the caller picks a specific seat there.
 */
export function OpenTableRow({ table }: { table: CasualTable }) {
  const router = useRouter();

  const total = table.seats.length;
  const bots = table.seats.filter((seat) => seat.kind === 'bot').length;
  const filled = table.seats.filter((seat) => seat.kind !== 'empty').length;
  const occupancy = bots > 0 ? `${filled}/${total} · ${bots} bot${bots === 1 ? '' : 's'}` : `${filled}/${total}`;

  function open() {
    router.push($path({ route: '/table/pending/[tableId]', routeParams: { tableId: table.id } }));
  }

  return (
    <Card className="py-4">
      <CardContent className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{table.variant.name}</span>
          <Badge variant="secondary">{occupancy}</Badge>
        </div>
        <CardAction className="static self-center">
          <Button onClick={open} size="sm" variant="outline">
            Open
          </Button>
        </CardAction>
      </CardContent>
    </Card>
  );
}
