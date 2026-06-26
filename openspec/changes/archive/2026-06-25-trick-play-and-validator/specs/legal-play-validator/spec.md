## ADDED Requirements

### Requirement: Legal-play computation

`@meldrank/engine` SHALL expose a pure `LegalPlayValidator(hand, trick, trump, trickRules)` that returns the subset of the seat's hand the seat may legally play into the in-progress `trick`, per "Single-Deck Partners" §7. It SHALL NOT mutate its inputs and SHALL be deterministic. The returned set SHALL always be non-empty when the hand is non-empty (a seat always has at least one legal play). The obligation cascade SHALL be gated by the `trickRules` flags so a variant that relaxes an obligation is served by the same function.

#### Scenario: The leader may play any card

- **WHEN** the legal set is computed for a seat with an empty trick (it leads)
- **THEN** every card in the seat's hand is legal

#### Scenario: Must follow the led suit when able

- **WHEN** the seat holds cards of the led suit and `mustFollowSuit` is set
- **THEN** only cards of the led suit are legal (trumps and off-suit cards are excluded)

#### Scenario: Must trump when void in the led suit

- **WHEN** the seat is void in the led suit but holds trump and `mustTrumpWhenVoid` is set
- **THEN** only trump cards are legal

#### Scenario: Free discard when void in led suit and holding no trump

- **WHEN** the seat is void in the led suit and holds no trump
- **THEN** every card in the seat's hand is legal

### Requirement: Strict must-beat (must-head and over-trump)

When `mustBeat` is set, `LegalPlayValidator` SHALL further restrict the legal set so the seat plays a card that beats the current winning card whenever it is able: when following the led suit, only led-suit cards that outrank the current winner are legal **if any exist** (must-head); when playing trump after the trick is already won by a trump, only trumps that outrank the current winning trump are legal **if any exist** (over-trump). If the seat holds no card that can beat the current winner along the obligated suit, all of that obligated suit's cards remain legal.

#### Scenario: Must head the current winner when able

- **WHEN** the seat is following the led suit, holds a led-suit card higher than the current winning card, and `mustBeat` is set
- **THEN** only led-suit cards higher than the current winning card are legal

#### Scenario: Cannot beat — all led-suit cards remain legal

- **WHEN** the seat is following the led suit but holds no led-suit card higher than the current winning card
- **THEN** all of the seat's led-suit cards are legal (the seat is not forced to beat what it cannot)

#### Scenario: Must over-trump a trumped trick when able

- **WHEN** the trick is currently won by a trump, the seat is void in the led suit, holds a trump higher than that winning trump, and `mustBeat` is set
- **THEN** only trumps higher than the current winning trump are legal
