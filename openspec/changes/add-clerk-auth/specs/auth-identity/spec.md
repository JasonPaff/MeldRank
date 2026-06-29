## ADDED Requirements

### Requirement: API authenticates the caller from a Clerk Bearer session

The API SHALL authenticate every player-scoped request from a Clerk session token
presented as an `Authorization: Bearer <token>` header, verifying it with the Clerk
backend SDK against the instance's `CLERK_SECRET_KEY`. A request whose token is absent,
malformed, expired, or invalid SHALL be treated as unauthenticated. This verification is
the single identity edge (Auth & Identity; design D5) — it replaces the prior stub seam
without changing any procedure body.

#### Scenario: Valid Bearer token authenticates the caller

- **WHEN** a request arrives carrying a valid Clerk session token in the `Authorization` header
- **THEN** the API resolves the authenticated Clerk user id and proceeds to identity resolution

#### Scenario: Missing or invalid token is unauthenticated

- **WHEN** a request arrives with no `Authorization` header, or a malformed/expired/invalid token
- **THEN** the API treats the caller as unauthenticated

### Requirement: Clerk identity resolves to an internal player id (resolve-or-create)

The API SHALL resolve the authenticated Clerk user to an internal `players.id` UUID and
expose it as `ctx.playerId`. Resolution SHALL be resolve-or-create: if no `players` row
exists for the Clerk user id, the API SHALL create one (`type='human'`, `clerk_user_id`
set, `display_name` derived from Clerk) and return its id. The create SHALL be safe under
concurrent first requests for the same user, yielding a single stable row and the same id
to every caller. `ctx.playerId` and every value derived from it (lobby seats, the seat
ticket's `playerId`) SHALL carry this internal UUID, never the Clerk user id.

#### Scenario: Existing user resolves to the stored player id

- **WHEN** an authenticated request arrives for a Clerk user with an existing `players` row
- **THEN** `ctx.playerId` is that row's `players.id` UUID

#### Scenario: First request lazily creates the player row

- **WHEN** an authenticated request arrives for a Clerk user with no `players` row
- **THEN** the API creates a `human` player row with the Clerk id and a Clerk-derived display name, and `ctx.playerId` is the new row's UUID

#### Scenario: Concurrent first requests converge on one row

- **WHEN** two authenticated requests for the same new Clerk user resolve identity concurrently
- **THEN** exactly one `players` row exists afterward and both requests observe the same `players.id`

### Requirement: Identity resolution is cached

The API SHALL cache the `clerk_user_id` → `players.id` mapping (Redis) so that repeat
authenticated requests resolve identity without a database read on the hot path. A cache
miss SHALL fall through to the database (and resolve-or-create); a cache hit SHALL return
the stored UUID directly.

#### Scenario: Repeat request resolves from cache

- **WHEN** an authenticated request arrives for a Clerk user whose mapping is already cached
- **THEN** identity resolves from the cache without a database read

### Requirement: Unauthenticated player-scoped requests are rejected

Every player-scoped procedure SHALL reject an unauthenticated caller with the typed
`unauthorized` error rather than falling back to a default or anonymous identity. No
request SHALL reach a procedure body with an unresolved or stubbed `playerId`.

#### Scenario: Unauthenticated call is rejected

- **WHEN** an unauthenticated request invokes a player-scoped procedure
- **THEN** it is rejected with the typed `unauthorized` error and no procedure body runs

### Requirement: Clerk webhook syncs player rows

The API SHALL expose a public `POST /api/webhooks/clerk` endpoint that verifies the
`svix` signature against `CLERK_WEBHOOK_SECRET` and, on `user.created` / `user.updated`
events, upserts the corresponding `players` row (creating the `human` row or refreshing
its Clerk-derived `display_name`/`avatar`). The endpoint SHALL be the authoritative sync;
the request-time resolve-or-create is the lazy fallback for the window before a webhook
lands. A request with a missing or invalid signature SHALL be rejected and SHALL NOT
mutate any row. The endpoint SHALL bypass the Bearer-session identity edge (it is not a
player-scoped call).

#### Scenario: Verified user.created upserts a player row

- **WHEN** a `user.created` event arrives with a valid `svix` signature
- **THEN** the API upserts the `human` player row for that Clerk user id

#### Scenario: Unsigned or tampered webhook is rejected

- **WHEN** a webhook request arrives with a missing or invalid `svix` signature
- **THEN** the API rejects it and no `players` row is created or modified

### Requirement: Match service receives identity through the seat ticket only

The match service SHALL remain outside the Clerk authentication path: the resolved
internal `players.id` reaches a room exclusively inside the HMAC-signed seat ticket the
API mints after authenticating the caller, verified at the room's `onAuth`. This change
SHALL NOT add any Clerk dependency to `apps/match`, and SHALL NOT change the seat-ticket
shape or its verification.

#### Scenario: Match binds the seat from the ticket's resolved player id

- **WHEN** a connection joins a room presenting a seat ticket minted for an authenticated caller
- **THEN** the room verifies the HMAC ticket and binds the seat to the ticket's `players.id`, with no Clerk verification in the match service
