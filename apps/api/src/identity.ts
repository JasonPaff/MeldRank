import { verifyToken } from '@clerk/backend';

/**
 * The Clerk Bearer-session identity edge (design D5; capability `auth-identity`). The
 * web client attaches its Clerk session token as `Authorization: Bearer <token>`; this
 * verifies it with `@clerk/backend` against `CLERK_SECRET_KEY` and yields the Clerk user
 * id (plus a best-effort display name from the token claims). A request with no token, or
 * a malformed/expired/invalid one, resolves to `null` — the caller is unauthenticated.
 *
 * This single verifier (with the webhook's resolver) is the only place identity enters
 * the API; it replaced the prior stub seam, leaving every procedure body unchanged.
 */

/** The verified Clerk identity carried into resolution (`auth-identity`, design D1). */
export interface ClerkIdentity {
  /** The Clerk user id (`sub` claim) — the key the internal `players.id` is resolved from. */
  readonly clerkUserId: string;
  /** A Clerk-derived display name; the webhook is authoritative and refreshes the real value. */
  readonly displayName: string;
  /** Optional Clerk avatar/image URL (set by the webhook upsert, not the token edge). */
  readonly avatar?: string | null;
}

/** Verifies a Bearer session token, yielding the Clerk identity or `null` if unauthenticated. */
export interface ClerkAuth {
  verifyBearer(authorization: string | undefined): Promise<ClerkIdentity | null>;
}

/** Pull the `<token>` from a `Bearer <token>` Authorization header value, or `null`. */
export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined) return null;
  const trimmed = token.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Derive a display name from a Clerk session token's claims: `username` → `first_name`
 * (+`last_name`) → a stable id-derived fallback (design D7). Default session tokens carry
 * only `sub`, so this is usually the fallback; the webhook upsert is authoritative and
 * replaces it with the real Clerk profile name.
 */
export function deriveDisplayNameFromClaims(claims: Record<string, unknown>): string {
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const username = str(claims.username);
  if (username !== '') return username;
  const full = [str(claims.first_name), str(claims.last_name)].filter((part) => part !== '').join(' ');
  if (full !== '') return full;
  const sub = str(claims.sub);
  return `Player ${sub.slice(-6) || 'unknown'}`;
}

/**
 * Construct the Clerk Bearer verifier. `authorizedParties` (the allowlisted web origin)
 * restricts the token's `azp` claim, the standard guard against tokens minted for a
 * different front end.
 */
export function createClerkAuth(opts: { secretKey: string; authorizedParties?: string[] }): ClerkAuth {
  const { secretKey, authorizedParties } = opts;
  return {
    async verifyBearer(authorization) {
      const token = bearerToken(authorization);
      if (token === null) return null;
      try {
        const claims = await verifyToken(token, { secretKey, authorizedParties });
        if (typeof claims.sub !== 'string' || claims.sub === '') return null;
        return {
          clerkUserId: claims.sub,
          displayName: deriveDisplayNameFromClaims(claims),
        };
      } catch {
        // A malformed/expired/invalid token is simply an unauthenticated caller.
        return null;
      }
    },
  };
}
