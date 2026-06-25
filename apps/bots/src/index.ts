import { isTrump } from '@meldrank/engine';
import { healthy } from '@meldrank/shared';

/**
 * Bot worker stub. Real bots will drive the Game Engine to play matches; for now
 * this entry starts cleanly, exercises both internal packages (`@meldrank/engine`
 * and `@meldrank/shared`), and exits.
 */
function main(): void {
  const status = healthy('bots');
  console.log(`[bots] worker started: ${status.service} is ${status.ok ? 'ok' : 'down'}`);
  console.log(`[bots] engine reachable: isTrump(hearts, hearts) = ${isTrump('hearts', 'hearts')}`);
}

main();
