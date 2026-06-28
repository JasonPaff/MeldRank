## ADDED Requirements

### Requirement: Authenticated internal spawn endpoint

The match service SHALL expose an internal HTTP endpoint that creates an authoritative room on demand. The endpoint SHALL require a shared internal secret and reject any request whose secret is missing or does not match. The endpoint SHALL never be reachable as a client/game message — it is a service-to-service control route only.

#### Scenario: A request with the valid internal secret is accepted

- **WHEN** the API calls the internal spawn endpoint with the correct internal secret and a valid spawn request
- **THEN** the request is accepted and proceeds to room creation

#### Scenario: A request without the valid secret is rejected

- **WHEN** the internal spawn endpoint is called with a missing or incorrect secret
- **THEN** the request is rejected and no room is created

### Requirement: Spawn request maps to an authoritative room

On a valid spawn request the match service SHALL create one authoritative `match` room via Colyseus `matchMaker.createRoom('match', …)`, configured with the request's frozen variant, its per-seat seating assignment, and its bot count, and SHALL return the room handle (room id) the client connects with. The seating assignment SHALL determine which seats are bot-filled at creation and which are reserved for human tickets.

#### Scenario: A spawn request creates a configured room

- **WHEN** the endpoint receives a valid spawn request for a variant with a seating assignment and bot count
- **THEN** it creates a `match` room with that frozen variant and bot fill
- **AND** it returns the created room's handle in the spawn response

#### Scenario: Bot seats are filled at creation

- **WHEN** the seating assignment marks N seats as bots
- **THEN** the created room is started with N bot seats so only the human-reserved seats await tickets

### Requirement: Spawn failures surface to the caller

When room creation fails, the endpoint SHALL respond with an error rather than a room handle, so the API can roll the table back. The endpoint SHALL NOT return a partially-created or unusable room handle.

#### Scenario: A creation failure returns an error response

- **WHEN** `matchMaker.createRoom` fails for a valid request
- **THEN** the endpoint returns an error response and no room handle
