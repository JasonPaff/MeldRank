# match-wire-contract Delta

## ADDED Requirements

### Requirement: Single shared wire-contract module

`@meldrank/shared` SHALL export a single wire-contract module defining, for every Client↔Match room message, the canonical message name constant and a Zod schema with its inferred payload type: inbound `intent` (correlation id + player intent) and `contribute` (hex-encoded client seed); outbound `view`, `commit`, `accept`, `reject`, `rejectContribution`, and `clockState`; the join options carrying the seat ticket; and the synced room-metadata snapshot shape. The module SHALL also define the closed union of machine-readable reject reasons. The module SHALL be browser-safe (importable from the shared root by `apps/web`) and SHALL NOT depend on `@meldrank/shared/server`, Node built-ins, or Colyseus types.

#### Scenario: Every room message has exactly one definition

- **WHEN** the match service registers a room message handler or sends a room message, or the web client registers a message handler or sends a room message
- **THEN** the message name and payload type are imported from the shared wire-contract module
- **AND** neither app declares a local wire message name literal or payload interface

#### Scenario: Wire module is browser-safe

- **WHEN** `apps/web` imports the wire-contract module in a client component
- **THEN** the import resolves from the shared root export with no server-only or Node-only transitive dependency

### Requirement: Intent wire schema is the player-intent union only

The wire contract's intent schema SHALL accept exactly the five player intents (`bid`, `pass`, `declareTrump`, `playCard`, `bury`) with their locked payload shapes, and SHALL reject any other discriminant — including the engine system events `deal` and `timeout` — and any payload with missing, mistyped, or unknown-shaped required fields.

#### Scenario: Player intents parse

- **WHEN** a payload carrying a well-formed `bid`, `pass`, `declareTrump`, `playCard`, or `bury` intent is parsed against the intent wire schema
- **THEN** parsing succeeds and yields the typed intent

#### Scenario: Engine system events do not parse

- **WHEN** a payload carrying `{ type: 'deal', … }` or `{ type: 'timeout', … }` is parsed against the intent wire schema
- **THEN** parsing fails
- **AND** the payload can never be typed as a `PlayerIntent` through the wire contract

### Requirement: Contribution wire schema validates the client seed

The wire contract's `contribute` schema SHALL require the client seed to be a non-empty, even-length, byte-exact lowercase-or-uppercase hexadecimal string of the handshake's expected seed length, such that decoding a schema-valid contribution can never throw.

#### Scenario: Well-formed contribution parses

- **WHEN** a `contribute` payload carries a hex string of the expected seed byte length
- **THEN** parsing succeeds and the decoded bytes are available to the handshake

#### Scenario: Malformed hex fails parsing, not decoding

- **WHEN** a `contribute` payload carries an empty, odd-length, non-hex, or wrong-length string
- **THEN** schema parsing fails before any decode is attempted
