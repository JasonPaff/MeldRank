## MODIFIED Requirements

### Requirement: Seat filling and identity

The room SHALL assign each joining connection a stable seat index for the duration of the room, reject joins once all seats are filled, and reject a join that targets an already-occupied seat. A joining human connection SHALL present a **seat ticket** at the room's `onAuth` gate; the room SHALL verify the ticket's signature, expiry, and that its `roomId` matches this room, reject the join when verification fails, and otherwise bind the connection to the seat the ticket reserves. The room SHALL accept the seating assignment supplied at creation by the spawn gateway, which marks each seat human-reserved or bot-filled. Ticket `playerId` is a stubbed identifier in this slice; Clerk-backed identity is still out of scope (unit E swaps only where `playerId` originates and the `onAuth`→identity linkage).

#### Scenario: Join is rejected when the room is full

- **WHEN** a connection attempts to join a room whose seats are all occupied
- **THEN** the room rejects the join
- **AND** the room's existing seat assignments are unchanged

#### Scenario: Each seated connection has a stable seat index

- **WHEN** a connection is seated
- **THEN** it is assigned one seat index that does not change while it remains connected
- **AND** that index is the `viewer` the room uses when projecting that connection's filtered view

#### Scenario: A valid seat ticket binds the connection to its reserved seat

- **WHEN** a human connection joins presenting a ticket whose signature and expiry are valid and whose `roomId` matches this room
- **THEN** the room accepts the join and binds the connection to the seat the ticket reserves

#### Scenario: An invalid or mismatched ticket is rejected at onAuth

- **WHEN** a connection joins with a ticket that is unsigned/tampered, expired, or whose `roomId` does not match this room
- **THEN** the room rejects the join at `onAuth`
- **AND** no seat is assigned to that connection

#### Scenario: Bot seats are filled from the creation seating assignment

- **WHEN** a room is created with a seating assignment marking some seats as bots
- **THEN** those seats are bot-filled at creation and do not await a ticket
- **AND** only the human-reserved seats accept a ticketed join
