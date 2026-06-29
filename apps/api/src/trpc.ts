import { initTRPC, TRPCError } from '@trpc/server';
import type { ApiErrorCode } from '@meldrank/shared';
import type { Logger } from '@meldrank/shared/server';
import type { CasualTableStore } from './lobby/store';
import type { TicketMinter } from './lobby/tickets';
import type { SpawnClient } from './spawn/client';
import type { VariantCatalog } from './variants';

/**
 * The tRPC foundation for `apps/api` (unit D). The router tree (`account`, `variant`,
 * `casual`, `match`) is built on this base; every procedure runs against an
 * {@link ApiContext} carrying the resolved caller identity (the centralized stub seam,
 * design D5) and the constructed dependencies. Expected failures are surfaced through
 * the shared typed taxonomy via {@link apiError}.
 */

/** The constructed, request-independent dependencies shared by every procedure. */
export interface ApiDeps {
  readonly variants: VariantCatalog;
  readonly store: CasualTableStore;
  readonly spawn: SpawnClient;
  readonly tickets: TicketMinter;
  /** The service base logger (capability `structured-logging`, design D3); `buildContext` derives the per-request child. */
  readonly log: Logger;
}

/**
 * The per-request context: the shared deps plus the resolved caller `playerId` and the
 * request's `traceId` (design D4). `log` is the request-bound child carrying `traceId`,
 * narrowing the base logger inherited from {@link ApiDeps}.
 */
export interface ApiContext extends ApiDeps {
  readonly playerId: string;
  readonly traceId: string;
}

const t = initTRPC.context<ApiContext>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * Every procedure logs its failures through the request-bound `ctx.log` (capability
 * `structured-logging`, design D3): a faulted call emits one structured line carrying
 * the procedure `path`, `type`, the tRPC `code`, and the error itself (`{ err }`).
 * Server faults log at `error`; expected client errors (the typed taxonomy) at `warn`.
 * Living on the base procedure means both serving entries and `createCaller` tests get
 * it uniformly, without an adapter-specific hook.
 */
export const publicProcedure = t.procedure.use(async ({ ctx, path, type, next }) => {
  const result = await next();
  if (!result.ok) {
    const fields = { path, type, code: result.error.code, err: result.error };
    if (result.error.code === 'INTERNAL_SERVER_ERROR') {
      ctx.log.error(fields, 'procedure failed');
    } else {
      ctx.log.warn(fields, 'procedure failed');
    }
  }
  return result;
});

/** Map the shared error taxonomy onto tRPC's transport error codes. */
const TAXONOMY_TO_TRPC = {
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  'not-found': 'NOT_FOUND',
  'rate-limited': 'TOO_MANY_REQUESTS',
  validation: 'BAD_REQUEST',
  conflict: 'CONFLICT',
} as const satisfies Record<ApiErrorCode, TRPCError['code']>;

/**
 * A typed API error: a {@link TRPCError} whose transport `code` is mapped from the
 * shared taxonomy, with the originating {@link ApiErrorCode} retained on
 * `apiErrorCode` so callers (and tests) can assert the taxonomy directly. This slice
 * only ever constructs `not-found`, `conflict`, and `validation`.
 */
export class ApiError extends TRPCError {
  readonly apiErrorCode: ApiErrorCode;

  constructor(apiErrorCode: ApiErrorCode, message?: string) {
    super({ code: TAXONOMY_TO_TRPC[apiErrorCode], message: message ?? apiErrorCode });
    this.apiErrorCode = apiErrorCode;
    this.name = 'ApiError';
  }
}

/** Construct a typed API error from a taxonomy code (sugar over `new ApiError`). */
export function apiError(code: ApiErrorCode, message?: string): ApiError {
  return new ApiError(code, message);
}
