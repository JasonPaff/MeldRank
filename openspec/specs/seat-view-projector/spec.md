# seat-view-projector

## Purpose

Defines the pure per-seat view projection in `@meldrank/engine` that derives, from the full engine `State` and a viewer identity (a seated player or the spectator), a filtered view containing exactly the information that viewer is entitled to see. It guarantees that public state passes through verbatim while hidden information — other seats' hands, the unrevealed widow, and non-bidder buried piles — is structurally unrepresentable, so realtime clients can be served per-seat without leaking secrets.

## Requirements

### Requirement: Per-seat filtered view derivation

The system SHALL provide a pure function that derives, from the full engine `State` and a viewer identity, a **filtered view** containing exactly the information that viewer is entitled to see. The function MUST NOT mutate the input `State` and MUST be deterministic — identical `(state, viewer)` inputs always produce an equal result. The viewer identity is either a seat index (a seated player) or the spectator identity (no seat).

#### Scenario: Seated player view derived from full state

- **WHEN** the function is called with a full `State` and a valid seat index `s`
- **THEN** it returns a filtered view carrying the viewer's seat index `s`, the full public state, and a single own-region containing that seat's own hand
- **AND** the input `State` is not mutated

#### Scenario: Determinism

- **WHEN** the function is called twice with the same `State` and the same viewer
- **THEN** the two results are deeply equal

#### Scenario: Invalid seat index is rejected

- **WHEN** the function is called with a seat index that is not a dealt seat in the current `State`
- **THEN** the function rejects the input rather than returning a view that fabricates an empty or borrowed hand

### Requirement: Public state passes through verbatim

The filtered view SHALL expose the engine `State`'s public region unchanged — including phase, dealer seat, seat-to-act, live auction standing, recorded contract, declared trump, the revealed widow, laid-down meld, the current and completed tricks, per-seat captures, the hand result, the score pad, hands-made-as-bidder, the match result, and any redeal outcome. The projection MUST NOT add to, remove from, or alter public state for any viewer.

#### Scenario: All public fields are present and equal

- **WHEN** a filtered view is derived for any viewer (seated or spectator)
- **THEN** the view's public region is deeply equal to `state.public`

#### Scenario: Revealed widow is visible to all once revealed

- **WHEN** the lifecycle has passed `WidowReveal` so `state.public.revealedWidow` is populated
- **THEN** every viewer's filtered view shows the revealed widow via the public region

### Requirement: Hidden information is structurally unrepresentable

The filtered-view type SHALL be defined so that another seat's hand and the unrevealed widow **cannot be expressed** in it — there is no field capable of holding them. Exclusion of hidden information MUST be a property of the type, enforced at compile time, not merely a runtime behavior of the projection function.

#### Scenario: No field for other seats' hands

- **WHEN** the filtered-view type is inspected
- **THEN** it has no member that holds another seat's hand contents, and code attempting to read another seat's cards from a filtered view fails to type-check

#### Scenario: Unrevealed widow is never carried

- **WHEN** a filtered view is derived in any phase, including phases before `WidowReveal`
- **THEN** the view carries no representation of `state.private.widow`; the only widow a viewer can observe is the public `revealedWidow` once it has been revealed

### Requirement: Viewer sees only its own hand

A seated viewer's filtered view SHALL contain that seat's own hand exactly as held in `state.private.hands[seat]`, and SHALL NOT contain any other seat's hand contents.

#### Scenario: Own hand matches private state

- **WHEN** a filtered view is derived for seat `s`
- **THEN** the view's own hand is deeply equal to `state.private.hands[s]`

#### Scenario: Other hands absent before any card is played

- **WHEN** a filtered view is derived for seat `s` immediately after the deal, while every seat holds a full hand
- **THEN** the view exposes no other seat's card contents

### Requirement: Bidder sees its own buried pile

In a bury-enabled variant, once the bid winner has buried cards, that bidder's own filtered view SHALL include its own `state.private.buried` pile. No seat other than the bidder SHALL ever see a buried pile, and on the non-bury path the own buried pile SHALL be empty for every viewer.

#### Scenario: Bidder sees own buried cards

- **WHEN** a bury has been applied in a bury-enabled variant and a filtered view is derived for the bidder's seat
- **THEN** the view's own region includes the bidder's buried cards, deeply equal to `state.private.buried`

#### Scenario: Non-bidder never sees buried cards

- **WHEN** a filtered view is derived for any seat that is not the bidder, after a bury has been applied
- **THEN** the view exposes no buried-pile contents

#### Scenario: No buried pile on the non-bury path

- **WHEN** a filtered view is derived in a variant without a Bury phase (e.g. Single-Deck Partners)
- **THEN** the viewer's own buried pile is empty

### Requirement: Opponent hand sizes are visible as counts

The filtered view SHALL expose the number of cards each seat currently holds — counts only, never contents — so a client can render opponents' card backs. Hand sizes are derived from `state.private.hands` and reflect the live count for every dealt seat, including the viewer's own seat.

#### Scenario: Counts reflect every seat's live hand size

- **WHEN** a filtered view is derived at any point in the hand
- **THEN** it reports, per dealt seat, that seat's current card count equal to the length of `state.private.hands[seat]`

#### Scenario: Counts carry no card contents

- **WHEN** the hand-size information in a filtered view is inspected for a seat other than the viewer
- **THEN** it conveys only a number and exposes no rank, suit, or card identity

### Requirement: Spectator view exposes public state only

When the viewer is the spectator identity (no seat), the filtered view SHALL contain the public state and the per-seat hand-size counts, and SHALL NOT contain any own-region — no hand and no buried pile.

#### Scenario: Spectator sees public state and counts

- **WHEN** a filtered view is derived for the spectator identity
- **THEN** the view's public region is deeply equal to `state.public` and it reports each seat's hand-size count
- **AND** the view carries no own hand and no buried pile

#### Scenario: Spectator sees no hidden cards in any phase

- **WHEN** a spectator view is derived in any lifecycle phase
- **THEN** it exposes no seat's hand contents, no unrevealed widow, and no buried-pile contents
