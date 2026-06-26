## ADDED Requirements

### Requirement: Automatic widow reveal for widow variants

For a variant that enables `WidowReveal` (widow size greater than zero), upon the auction concluding with a winning contract `reduce` SHALL deterministically reveal the widow without consuming any player intent or any addition to the closed `Event` union: it SHALL move the widow cards into the contract winner's hand, empty the unrevealed widow, record the revealed widow in the public region of `State`, and continue advancing the phase through `WidowReveal` to `DeclareTrump`. Each phase hop SHALL be a legal transition in the foundation's transition table. A variant with no widow SHALL skip this entirely and advance `Auction → DeclareTrump` directly.

#### Scenario: Cutthroat reveals the widow into the bidder's hand

- **WHEN** the auction concludes with a winning contract for `SINGLE_DECK_CUTTHROAT`
- **THEN** the 3 widow cards are added to the contract winner's hand (hand size grows from 15 to 18), the unrevealed widow is emptied, the revealed widow is recorded in public state, and the resting phase is `DeclareTrump`

#### Scenario: Partners has no widow to reveal

- **WHEN** the auction concludes with a winning contract for `SINGLE_DECK_PARTNERS`
- **THEN** no widow reveal occurs, hands are unchanged, and the phase advances directly to `DeclareTrump`

#### Scenario: The reveal preserves the deck as a multiset

- **WHEN** the widow is revealed for a widow variant
- **THEN** the union of all seat hands and the (now empty) widow equals the originally dealt cards as a multiset — no card is lost or duplicated by the reveal

### Requirement: Revealed widow recorded publicly

The engine SHALL record the revealed widow in the **public** region of `State` so the reveal is visible to all seats and reconstructable from a replay fold, reflecting the canonical exposed-widow rule. Before the reveal, the widow SHALL reside only in the private region; the engine SHALL structure this state for per-seat filtering but SHALL NOT perform the filtering (Match Runtime's responsibility).

#### Scenario: The revealed widow is public, the unrevealed widow is private

- **WHEN** a widow-variant state is inspected before and after the reveal
- **THEN** before the reveal the widow is addressable only as private state, and after the reveal the revealed widow is addressable as public state
