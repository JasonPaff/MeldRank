/**
 * The durable persistence seam (capability `match-persistence`): the transactional
 * Neon writer for a completed match and the status-only Redis result event. The
 * Colyseus adapter drives these on a `persist` effect; the room core stays pure.
 */
export { persistMatchRecord, buildMatchResultEvent, publishMatchResult } from './writer';
