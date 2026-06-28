## ADDED Requirements

### Requirement: tRPC procedure schemas are the binding contract

`@meldrank/shared` SHALL export a Zod input and output schema for every tRPC procedure this slice introduces (`account.getMe`, `variant.list`, `variant.get`, `casual.createTable`, `casual.listOpenTables`, `casual.joinSeat`, `casual.leaveTable`, `casual.addBot`, `casual.quickPlay`, `match.getActive`). The schemas SHALL be isomorphic (browser-safe: types and Zod only, no server drivers or secrets) so the client and the API import the same definitions for end-to-end types. Procedure behavior is owned by the consuming capability; this capability owns only the wire shape.

#### Scenario: Each procedure has an importable input/output schema

- **WHEN** the API or client references a procedure in the minimal set
- **THEN** a matching Zod input schema and output schema are importable from `@meldrank/shared`
- **AND** the schemas pull in no server-only modules (db/redis clients, secrets)

#### Scenario: Inputs that fail validation are rejected before handler logic

- **WHEN** a procedure is called with an input that violates its Zod input schema
- **THEN** the call is rejected with a validation error and the procedure body does not run

### Requirement: Room-spawn request and response contract

`@meldrank/shared` SHALL export the schema pair for the API↔Match internal spawn seam: a request carrying the frozen variant reference (or snapshot), the per-seat seating assignment (each seat marked human-stub or bot), and the bot count; and a response carrying the room handle the client uses to connect. The contract SHALL be transport-agnostic at the schema level (it describes the payloads, not that they travel over HTTP).

#### Scenario: Spawn request carries variant, seating, and bot count

- **WHEN** the API assembles a spawn request
- **THEN** the request validates against the spawn-request schema with its frozen variant, per-seat seating assignment, and bot count present

#### Scenario: Spawn response carries the room handle

- **WHEN** the match service returns a spawned room
- **THEN** the response validates against the spawn-response schema and carries the room handle (room id) the client connects with

### Requirement: Seat-ticket payload contract

`@meldrank/shared` SHALL define the seat-ticket payload schema — `{ roomId, seat, playerId, variantId, exp }` (with `playerId` a stub identifier in this slice) — and a server-only sign/verify helper that produces and checks an HMAC signature over the payload using a shared secret. The signing helper SHALL be exported only from `@meldrank/shared/server`; the payload schema SHALL be isomorphic.

#### Scenario: A minted ticket verifies with the same secret

- **WHEN** a ticket payload is signed with the shared secret
- **THEN** verifying the signed ticket with the same secret returns the original payload
- **AND** verifying it with a different secret, a tampered payload, or after `exp` fails

#### Scenario: The signing helper is server-only

- **WHEN** the contract surface is imported from the isomorphic root (`@meldrank/shared`)
- **THEN** the seat-ticket payload schema is available but the sign/verify helper is not (it is exported only from `@meldrank/shared/server`)

### Requirement: Ephemeral casual-table state shape

`@meldrank/shared` SHALL export the Zod shape of the ephemeral casual-table record held in Redis — its id, frozen variant, per-seat occupancy (empty | human-stub `playerId` | bot), status (`open` | `spawning` | `live`), and the fields needed to list and re-find it — so the API reads and writes a single validated shape.

#### Scenario: Table record round-trips through the schema

- **WHEN** a casual-table record is serialized to Redis and read back
- **THEN** it parses against the casual-table schema with its variant, per-seat occupancy, and status intact

### Requirement: Shared pagination envelope and error taxonomy

`@meldrank/shared` SHALL export a cursor-pagination envelope (`{ cursor?, limit }` input → `{ items, nextCursor }` output) used by list procedures, and a small typed error taxonomy drawn from `unauthorized | forbidden | not-found | rate-limited | validation | conflict`. Procedures in this slice SHALL surface expected failures using this taxonomy rather than ad-hoc error shapes. This slice SHALL emit only `validation`, `not-found`, and `conflict`; `unauthorized`, `forbidden`, and `rate-limited` remain reserved in the taxonomy for later slices (Clerk identity + rate-limiting). A spawn-gateway failure SHALL surface as a standard internal error, not a typed client-facing code.

#### Scenario: List procedures use the cursor envelope

- **WHEN** a list procedure (e.g. `casual.listOpenTables`) returns results
- **THEN** the output validates against the pagination envelope with `items` and a nullable `nextCursor`

#### Scenario: Expected failures map to the emitted taxonomy

- **WHEN** a procedure rejects on bad input, a missing variant/table, or a seat/spawn-state conflict
- **THEN** the surfaced error is `validation`, `not-found`, or `conflict` respectively, not an untyped/ad-hoc error

#### Scenario: Reserved codes are not emitted this slice

- **WHEN** procedures in this slice run under stubbed identity with no rate-limiting
- **THEN** no `unauthorized`, `forbidden`, or `rate-limited` error is emitted
- **AND** a spawn-gateway failure surfaces as a standard internal error rather than a typed client-facing code
