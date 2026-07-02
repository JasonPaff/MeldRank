# match-room-lifecycle Delta

## ADDED Requirements

### Requirement: Client payloads cannot terminate the room

The room SHALL define an uncaught-exception guard (`onUncaughtException`) so that an unexpected error thrown while handling any client-originated message or timer callback is contained: the error SHALL be logged with the room id and the originating message kind, and the room SHALL remain live and able to process subsequent messages. No client-supplied payload SHALL be able to crash the room or the process. The guard is a backstop — boundary schema validation (capabilities `match-wire-contract`, `match-intent-loop`, `match-shuffle-handshake`) remains the first line of defense, and errors reaching the guard SHALL be treated as defects to fix, not as expected flow.

#### Scenario: Unexpected handler error is contained and logged

- **WHEN** a message handler throws an error that boundary validation did not prevent
- **THEN** the room logs the error with its room context and the message kind
- **AND** the room continues serving the match — other seats' subsequent intents are still processed

#### Scenario: Hostile payload burst does not kill the process

- **WHEN** a connection sends a burst of hostile or malformed payloads across all message types
- **THEN** every payload is either rejected at the boundary or contained by the guard
- **AND** the match service process remains alive and the room's engine state remains consistent
