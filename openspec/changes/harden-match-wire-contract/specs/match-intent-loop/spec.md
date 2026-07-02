# match-intent-loop Delta

## ADDED Requirements

### Requirement: Inbound intent messages are schema-validated at the room boundary

Before any authority check or engine call, the room SHALL parse every inbound `intent` message against the shared wire contract's intent message schema (capability `match-wire-contract`). A message that fails parsing SHALL NOT reach `RoomCore` or the engine and SHALL produce a `reject` to the submitter with a machine-readable malformed-message reason — carrying the submitted `correlationId` when one was legible in the raw payload. Schema validation SHALL precede the existing seat- and turn-authority checks.

#### Scenario: Malformed intent payload is rejected without an engine call

- **WHEN** a connection sends an `intent` message whose payload is missing fields, carries mistyped fields, or is not an object
- **THEN** the room rejects it with a malformed-message reason
- **AND** neither `RoomCore` nor the engine `reduce` is invoked

#### Scenario: Legible correlation id is echoed on a malformed reject

- **WHEN** a malformed `intent` payload nonetheless carries a string `correlationId`
- **THEN** the reject sent to the submitter carries that `correlationId` so the client can roll back its optimistic prediction

### Requirement: Client connections cannot submit engine system events

The room SHALL accept from client connections only intents in the player-intent union (`bid`, `pass`, `declareTrump`, `playCard`, `bury`). A client-supplied payload whose discriminant is an engine system event — including `deal` and `timeout` — SHALL be rejected at the wire boundary and SHALL NOT be passed to the engine `reduce` under any lifecycle phase, including while a contribution window is open and `seatToAct` is null. System events SHALL originate only server-side (the seeded deal from the shuffle handshake, the clock-expiry timeout).

#### Scenario: Injected deal event is rejected during the contribution window

- **WHEN** a hand's contribution window is open and a seated connection sends an `intent` message whose payload is `{ type: 'deal', seed: <client-chosen>, … }`
- **THEN** the room rejects the message at the wire boundary
- **AND** the engine state is unchanged and the hand is subsequently dealt only from the handshake-assembled seed

#### Scenario: Injected timeout event is rejected

- **WHEN** a seated connection sends an `intent` message whose payload is `{ type: 'timeout', … }`
- **THEN** the room rejects the message at the wire boundary
- **AND** no seat is charged a timeout and no forced move is applied
