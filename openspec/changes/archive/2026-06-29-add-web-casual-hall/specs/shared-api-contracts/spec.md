## MODIFIED Requirements

### Requirement: tRPC procedure schemas are the binding contract

`@meldrank/shared` SHALL export a Zod input and output schema for every tRPC procedure
(`account.getMe`, `variant.list`, `variant.get`, `casual.createTable`,
`casual.listOpenTables`, `casual.joinSeat`, `casual.leaveTable`, `casual.addBot`,
`casual.quickPlay`, `casual.getTable`, `match.getActive`). The schemas SHALL be
isomorphic (browser-safe: types and Zod only, no server drivers or secrets) so the
client and the API import the same definitions for end-to-end types. The
`casual.getTable` input SHALL carry a `tableId` and its output SHALL be the shared
ephemeral casual-table record shape. The `match.getActive` output SHALL carry the
existing room handle and seat and an **optional** signed seat ticket (present only when
a live match is returned), so the additive change does not break callers that tolerate
its absence. Procedure behavior is owned by the consuming capability; this capability
owns only the wire shape.

#### Scenario: Each procedure has an importable input/output schema

- **WHEN** the API or client references a procedure in the set
- **THEN** a matching Zod input schema and output schema are importable from `@meldrank/shared`
- **AND** the schemas pull in no server-only modules (db/redis clients, secrets)

#### Scenario: getTable and the enriched getActive output are typed

- **WHEN** the client references `casual.getTable` or `match.getActive`
- **THEN** `casual.getTable` exposes a `tableId` input schema and a casual-table-record output schema
- **AND** `match.getActive`'s output schema includes an optional signed seat ticket alongside the room handle and seat

#### Scenario: Inputs that fail validation are rejected before handler logic

- **WHEN** a procedure is called with an input that violates its Zod input schema
- **THEN** the call is rejected with a validation error and the procedure body does not run
