/**
 * The isomorphic API contract surface (capability `shared-api-contracts`, unit G):
 * the tRPC procedure input/output schemas, the API↔Match room-spawn request/response
 * pair, the seat-ticket payload, the ephemeral casual-table/seat/bot state shapes,
 * and the cross-cutting cursor-pagination envelope + typed error taxonomy the
 * procedures use. Everything here is browser-safe (Zod + types only); the seat-ticket
 * **sign/verify helper** is server-only and lives in `@meldrank/shared/server`.
 */
export { API_ERROR_CODES, ApiErrorCodeSchema, type ApiErrorCode } from './errors';
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  CursorPaginationInputSchema,
  paginated,
  type CursorPaginationInput,
  type Paginated,
} from './pagination';
export {
  BotDifficultySchema,
  DEFAULT_BOT_DIFFICULTY,
  TableSeatSchema,
  TableStatusSchema,
  CasualTableSchema,
  type BotDifficulty,
  type TableSeat,
  type TableStatus,
  type CasualTable,
} from './table';
export { SeatTicketSchema, SignedSeatTicketSchema, type SeatTicket, type SignedSeatTicket } from './ticket';
export {
  SpawnSeatSchema,
  RoomSpawnRequestSchema,
  RoomSpawnResponseSchema,
  INTERNAL_SPAWN_PATH,
  INTERNAL_SECRET_HEADER,
  type SpawnSeat,
  type RoomSpawnRequest,
  type RoomSpawnResponse,
} from './spawn';
export {
  PlayerViewSchema,
  AccountGetMeInputSchema,
  AccountGetMeOutputSchema,
  VariantViewSchema,
  VariantListInputSchema,
  VariantListOutputSchema,
  VariantGetInputSchema,
  VariantGetOutputSchema,
  CasualActionResultSchema,
  CasualCreateTableInputSchema,
  CasualCreateTableOutputSchema,
  CasualListOpenTablesInputSchema,
  CasualListOpenTablesOutputSchema,
  CasualJoinSeatInputSchema,
  CasualJoinSeatOutputSchema,
  CasualLeaveTableInputSchema,
  CasualLeaveTableOutputSchema,
  CasualAddBotInputSchema,
  CasualAddBotOutputSchema,
  CasualQuickPlayInputSchema,
  CasualQuickPlayOutputSchema,
  ActiveMatchSchema,
  MatchGetActiveInputSchema,
  MatchGetActiveOutputSchema,
  type PlayerView,
  type VariantView,
  type CasualActionResult,
  type CasualQuickPlayOutput,
  type ActiveMatch,
} from './procedures';
