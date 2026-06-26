# auction-manager

## Purpose

Defines the AuctionManager in `@meldrank/engine` that governs the bidding phase of a pinochle hand: turn order, bid legality, passing, and termination. It resolves the auction to a winning `Bid` or a variant-defined all-pass outcome, per the canonical ruleset docs §4 and "Game Engine — Abstract Model" §5.

## Requirements

### Requirement: Turn order opens left of the dealer

The auction SHALL open with the seat to the dealer's left and proceed clockwise, per both canonical ruleset docs §4. Turn SHALL advance only over seats still live in the auction.

#### Scenario: First to act is left of the dealer

- **WHEN** the auction begins with dealer at seat 0 in a 4-seat variant
- **THEN** the seat to act is seat 1, and the clockwise order of action is seats 1, 2, 3, 0

### Requirement: Bid legality

A `bid` SHALL be legal only when the bidding seat is the seat to act, is still live (has not passed), and the value is at least the floor and aligned to the increment grid — where the floor is `highBid + increment` once a bid exists, otherwise `minimumBid`, and a legal value is `minimumBid + k × increment` for a non-negative integer `k`. A legal bid SHALL become the new high bid and advance the turn to the next live seat. An illegal bid SHALL be rejected without changing the auction.

#### Scenario: A bid at the floor is accepted

- **WHEN** the seat to act bids exactly the current floor (e.g. 250 for Partners with no prior bid)
- **THEN** it becomes the high bid and the turn advances to the next live seat

#### Scenario: A bid below the floor is rejected

- **WHEN** the seat to act bids below the floor
- **THEN** the bid is rejected and the auction is unchanged

#### Scenario: A bid off the increment grid is rejected

- **WHEN** the seat to act bids a value that is not `minimumBid + k × increment` (e.g. 255 when minimum is 250 and increment is 10)
- **THEN** the bid is rejected and the auction is unchanged

#### Scenario: An out-of-turn bid is rejected

- **WHEN** a seat that is not the seat to act submits a bid
- **THEN** the bid is rejected and the auction is unchanged

### Requirement: Pass is out for the hand

A `pass` SHALL remove the seat from the live set for the remainder of the auction (pass-out-for-hand); a passed seat SHALL NOT bid again. After a pass, the turn SHALL advance to the next live seat.

#### Scenario: A passed seat cannot re-enter

- **WHEN** a seat passes and later attempts to bid in the same auction
- **THEN** the later bid is rejected because the seat is no longer live

#### Scenario: Turn advances past passed seats

- **WHEN** the seat to act passes
- **THEN** the next live seat (skipping any already-passed seats) becomes the seat to act

### Requirement: Termination with a winner

When exactly one live seat remains after passes, the auction SHALL conclude with that seat as the winner at its current high bid, emitting a won `Bid { seat, value }`.

#### Scenario: Last seat standing wins at the high bid

- **WHEN** one seat has bid 250 and every other seat has passed
- **THEN** the auction concludes with a won `Bid { seat, value: 250 }`

### Requirement: All-pass resolution by variant rule

When every seat passes and no bid was ever placed, the auction SHALL resolve per the variant's `allPassRule`: `dealer-forced-minimum` SHALL conclude with the dealer as winner at `minimumBid` (a won `Bid`); `redeal` SHALL conclude with a `redeal` outcome that carries no contract, signalling the room to re-deal with the same dealer and a fresh seed (a redeal is not an engine lifecycle transition).

#### Scenario: Partners all-pass forces the dealer in at the minimum

- **WHEN** all four seats pass in `SINGLE_DECK_PARTNERS`
- **THEN** the auction concludes with a won `Bid { seat: dealerSeat, value: 250 }`

#### Scenario: Cutthroat all-pass triggers a redeal

- **WHEN** all three seats pass in `SINGLE_DECK_CUTTHROAT`
- **THEN** the auction concludes with a `redeal` outcome and no contract is recorded

### Requirement: Deterministic auction timeout is a pass

Per "Game Engine — Abstract Model" Ruling 5, when a seat's clock expires during the Auction (a `timeout` event for the seat to act), the deterministic forced move SHALL be a `pass`.

#### Scenario: A timeout during the auction passes the seat

- **WHEN** a `timeout` event is reduced for the seat to act during `Auction`
- **THEN** that seat is treated as having passed (removed from the live set) and the turn advances to the next live seat
