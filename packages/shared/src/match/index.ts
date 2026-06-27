/**
 * Match-record contracts: the durable, versioned replay blob ({@link ReplayBlobV1})
 * the match runtime serializes into `match_replays`, and the status-only
 * {@link MatchResultEvent} it publishes over Redis (the API↔Match contract). Both
 * are isomorphic Zod schemas — no driver, no secret — safe for either side of the
 * wire.
 */
export {
  REPLAY_FORMAT,
  REPLAY_SCHEMA_VERSION,
  ReplayHandLineSchema,
  ReplayHandSummarySchema,
  ReplayIntentEntrySchema,
  ReplaySeedRevealSchema,
  ReplayBlobV1Schema,
  type ReplayHandLine,
  type ReplayHandSummary,
  type ReplayIntentEntry,
  type ReplaySeedReveal,
  type ReplayBlobV1,
} from './replay';

export {
  MATCH_RESULT_CHANNEL,
  MatchSeatOutcomeSchema,
  MatchResultEventSchema,
  type MatchSeatOutcome,
  type MatchResultEvent,
} from './result-event';
