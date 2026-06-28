## MODIFIED Requirements

### Requirement: Casual grace expiry requests a reclaimable bot takeover

When a disconnected seat's grace window expires in a casual room, the room SHALL mark the seat bot-controlled and emit a bot-takeover request for that seat rather than resolving the match, so the table can complete normally; the returning human SHALL be able to reclaim the seat any time before match end. The bot-controlled seat SHALL be played by the in-process bot brain through the same intent interface a human uses (capabilities `bot-seating`, `bot-decision-policy`), so the match progresses to completion after the human drops. A casual room SHALL NOT forfeit or abort on a single disconnect.

#### Scenario: Casual grace expiry hands the seat to a bot

- **WHEN** a disconnected seat's grace expires in a casual room
- **THEN** the room marks the seat bot-controlled and emits a bot-takeover request
- **AND** the match is not forfeited or aborted

#### Scenario: Returning human reclaims a bot-controlled seat

- **WHEN** the original player reconnects to a bot-controlled seat before match end
- **THEN** the room restores the seat to that human and resyncs its filtered view
- **AND** the seat stops being driven by the bot brain

#### Scenario: The bot brain plays the taken-over seat

- **WHEN** a bot-controlled seat comes on the clock after a takeover
- **THEN** the seat is driven by the bot brain through the human-equivalent intent interface
- **AND** the match continues toward completion rather than waiting on the absent human
