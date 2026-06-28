## ADDED Requirements

### Requirement: A bot occupies a real seat in the room core

The room SHALL support seating an in-process bot as a first-class `SeatAssignment` in the pure `RoomCore` (capability `match-room-lifecycle`), carrying a synthetic connection id and a marker distinguishing it as a bot. A bot seat SHALL count toward seat occupancy and fullness exactly as a human seat does, so a room whose remaining empty seats are filled by bots SHALL reach `Live` and run the per-hand loop. Seating a bot SHALL NOT alter engine `State` beyond the normal seat-filling effects, and the rules/legality layer SHALL NOT distinguish a bot seat from a human seat — the authoritative `validate → apply → advance → broadcast` path is identical for both.

#### Scenario: A bot seat fills the room to Live

- **WHEN** the remaining empty seats of a `Filling` room are filled by bots
- **THEN** the room reports full and advances to `Live`
- **AND** the per-hand loop begins exactly as for an all-human room

#### Scenario: A bot seat is a normal seat assignment

- **WHEN** a bot is seated
- **THEN** the seat appears in the room's seat list with a stable seat index and a synthetic connection id
- **AND** the seat is marked as a bot

#### Scenario: Bot intents pass the same authority guards

- **WHEN** a bot seat submits an intent for its own seat on its turn
- **THEN** the room validates seat ownership, turn order, and engine legality identically to a human intent
- **AND** an out-of-turn or illegal bot intent is rejected without mutating state

### Requirement: Bots are never seated in ranked rooms

The room SHALL refuse to seat a bot in a ranked room. Cold-start seat-fill and disconnect-takeover bot seating SHALL apply only to casual rooms, consistent with the ranked grace-then-forfeit path (capability `match-disconnect-abandonment`).

#### Scenario: Ranked room rejects a bot seat

- **WHEN** a bot seating is requested for a ranked room
- **THEN** the room does not seat a bot
- **AND** the ranked room continues to rely on the forfeit/abort paths for empty or abandoned seats

### Requirement: The adapter drives a bot seat's turn through the bot brain

After any room step, when the seat on the clock is a bot seat the Colyseus adapter SHALL derive that seat's `FilteredView` (capability `seat-view-projector`), invoke the bot brain (capability `bot-decision-policy`) with that view, and submit the returned `PlayerIntent` back through the room's normal intent path on the bot's synthetic connection. The adapter SHALL drive exactly the seat currently on the clock and SHALL NOT act for a bot seat that is not on the clock. Successive bot turns (including an all-bot table) SHALL each be driven this way until the match completes or a human seat is on the clock.

#### Scenario: A bot on the clock plays a legal move

- **WHEN** a step leaves a bot seat on the clock
- **THEN** the adapter derives the bot seat's filtered view, asks the brain for an intent, and submits it on the bot's connection
- **AND** the resulting move advances the match through the normal authoritative path

#### Scenario: Consecutive bot turns are driven to completion

- **WHEN** a bot move leaves another bot seat on the clock
- **THEN** the adapter drives the next bot turn as well
- **AND** an all-bot or mostly-bot table plays the match through to completion without a human acting

#### Scenario: The adapter does not act for a bot off the clock

- **WHEN** a bot seat is not the seat on the clock
- **THEN** the adapter submits no intent for that bot seat

### Requirement: Bot moves use a humanized think delay

The adapter SHALL schedule each bot move after a short, randomized "think" delay (Bots & AI — Design v1 §7) using its existing room clock rather than acting synchronously within the triggering step, so the table renders bot turns at a readable pace. The think delay SHALL be bounded by a configured range. A bot move clock SHALL continue to run while the bot "thinks"; the think delay SHALL be short relative to the move clock so a bot does not time itself out under normal operation.

#### Scenario: A bot move is delayed before submission

- **WHEN** a bot seat comes on the clock
- **THEN** the adapter waits a randomized bounded delay before submitting the bot's intent

#### Scenario: Think delay stays within the move clock

- **WHEN** a bot's think delay elapses
- **THEN** the bot submits its intent before its move clock would expire under normal operation

### Requirement: Casual disconnect-takeover seats a playing bot

When the room emits a casual bot-takeover request for a seat (capability `match-disconnect-abandonment`), the seat SHALL be driven by the bot brain for as long as it remains bot-controlled, so the table completes normally after a human drops. A returning human reclaiming the seat (the existing reconnection path) SHALL stop bot driving for that seat and resume human control. The takeover SHALL reuse the same bot driver and intent interface as cold-start seat-fill — no separate path.

#### Scenario: A bot-controlled seat is played by the brain

- **WHEN** a seat becomes bot-controlled after a casual grace expiry and that seat comes on the clock
- **THEN** the adapter drives the seat through the bot brain exactly as a seat-fill bot
- **AND** the match continues toward completion

#### Scenario: A reclaimed seat stops being bot-driven

- **WHEN** the original human reconnects and reclaims a bot-controlled seat before match end
- **THEN** the adapter stops driving that seat with the brain
- **AND** the human resumes acting for the seat
