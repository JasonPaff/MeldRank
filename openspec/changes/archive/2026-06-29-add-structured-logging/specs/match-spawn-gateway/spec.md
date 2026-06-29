## ADDED Requirements

### Requirement: Spawn endpoint propagates a trace correlation id

The internal spawn endpoint SHALL accept an optional trace correlation id from the caller via the shared `x-meldrank-trace-id` header and SHALL thread it through room creation so the created room can bind it to its logger. When the header is present the created room's log entries SHALL carry that same `traceId`, so the API's spawn-request logs and the room's lifecycle logs for one table share one id. When the header is absent the endpoint SHALL still create the room normally; binding a trace id is best-effort and SHALL NOT gate spawning.

#### Scenario: Spawn carries the caller's trace id onto the room

- **WHEN** the API calls the internal spawn endpoint with a valid secret and an `x-meldrank-trace-id` header
- **THEN** the room is created and its subsequent log entries carry that `traceId`

#### Scenario: Spawn without a trace id still succeeds

- **WHEN** the internal spawn endpoint is called with a valid secret but no `x-meldrank-trace-id` header
- **THEN** the room is created normally with no trace id bound
