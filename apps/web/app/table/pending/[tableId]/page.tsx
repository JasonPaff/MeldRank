'use client';

import { useRouteParams } from 'next-typesafe-url/app';

import { WaitingRoom } from '@/components/hall/waiting-room';

import { Route } from './route-type';

/**
 * The `tableId`-keyed waiting-room route (design D6). A thin shell: it reads the
 * dynamic `tableId` and delegates the whole pre-room experience — the live poll,
 * seat actions, and the hand-off to the play route — to {@link WaitingRoom} and the
 * `use-waiting-room` controller.
 */
export default function PendingTablePage() {
  const { data: routeParams } = useRouteParams(Route.routeParams);
  return <WaitingRoom tableId={routeParams?.tableId} />;
}
