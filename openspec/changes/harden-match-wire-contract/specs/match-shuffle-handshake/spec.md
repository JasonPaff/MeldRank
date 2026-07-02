# match-shuffle-handshake Delta

## ADDED Requirements

### Requirement: Contribution payloads are schema-validated at the room boundary

The room SHALL parse every inbound `contribute` message against the shared wire contract's contribution schema (capability `match-wire-contract`) before decoding or recording it. A malformed contribution (non-object payload, missing/mistyped/malformed-hex or wrong-length client seed) SHALL yield a `rejectContribution` with a machine-readable reason and SHALL NOT throw inside the message handler, mutate handshake state, or reach the engine. Only the handshake-assembled seed SHALL ever produce a deal: no content of a `contribute` message beyond a schema-valid seat contribution SHALL influence dealing.

#### Scenario: Malformed hex contribution is rejected, not thrown

- **WHEN** a seated connection sends a `contribute` message whose `clientSeed` is not valid hex of the expected length
- **THEN** the room sends that connection a `rejectContribution` with a malformed reason
- **AND** no exception escapes the handler and the hand's recorded contributions are unchanged

#### Scenario: Non-object contribution payload is contained

- **WHEN** a connection sends a `contribute` message whose payload is `null`, a string, or otherwise not the contract shape
- **THEN** the room rejects it at the boundary without decoding
- **AND** the contribution window, deadline, and prior contributions are unaffected
