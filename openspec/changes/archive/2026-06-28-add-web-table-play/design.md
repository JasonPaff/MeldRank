## Context

F0 (scaffold) and F1 (lobby) shipped: `apps/web` has a typed tRPC/TanStack-Query/Zustand
foundation, a configured-but-unconnected Colyseus client (`apps/web/lib/colyseus.tsx`),
and a lobby that runs Quick Play → spawns a bot-filled room → stashes `{ ticket,
activeMatch }` into the session store → navigates to `/table/[roomId]`, which is an F1
stub that joins nothing. Every server seam is built, tested, and deployed: the match
room (`apps/match`) verifies a seat ticket at `onAuth`, binds the reserved seat at
`onJoin`, runs the authoritative engine, drives 3 bots, and persists to Neon at match
complete. The wire contract this slice consumes is frozen:

- **Synced schema** (`RoomMetadata`, auto-replicated): `lifecycle`, `seatToAct`,
  `clockDeadline`, `occupancy[]`, `seatStatus[]` — non-secret presence only.
- **Server→client messages**: `view` (`FilteredView`), `commit` (`{handNonce, commit}`),
  `accept` (`{correlationId, view}`), `reject` (`{correlationId, reason, view}`),
  `rejectContribution` (`{reason}`), `clockState` (`{actingSeat, deadline, seats}`).
- **Client→server messages**: `intent` (`{intent: PlayerIntent, correlationId}`),
  `contribute` (`{clientSeed: hex}`).
- **Join**: `client.joinById(roomId, { ticket })`.

The render contract is two engine/shared types: `FilteredView` (`viewer`, `public:
PublicState`, `own: {hand, buried}`, `handSizes[]`) and `PlayerIntent`
(`bid|pass|declareTrump|playCard|bury`). `PublicState` already carries everything the
table shows — `phase`, `seatToAct`, `auction`, `contract`, `trump`, `revealedWidow`,
`melds`, `currentTrick`, `completedTricks`, `captured`, `scorePad`, `handResult`,
`matchResult`.

This is the Client↔Match Colyseus seam — the last dark integration boundary in the MVP
walking skeleton (SLE-184). See proposal.md for motivation; "Game Client & Table UI —
Design v1" and "Match Runtime — Design v1" (Linear) for the locked surface.

## Goals / Non-Goals

**Goals:**

- Join the spawned room with the lobby's seat ticket and render the authoritative
  per-seat `FilteredView` (own hand, public table state, opponents as card-backs).
- Drive the human intent loop — `bid` / `pass` / `declareTrump` / `playCard` — with
  authoritative `accept`/`reject` reconciliation, so a 1-human + 3-bot Single-Deck
  Partners game plays to completion.
- Send a best-effort per-hand seed contribution so the provably-fair handshake includes
  the human seat.
- Make SLE-184 unit F task 5.2 smokeable: browser → played hand → match row in Neon.

**Non-Goals:**

- Clock countdown UI (capture `clockState`; render the visual in F2b).
- `reconnect()` / resync, reconnection-token persistence, cold-load **ticket** rehydration
  (F2b).
- Optimistic move rendering, card artwork, animations (pessimistic + functional only).
- `bury` intent (Cutthroat-only; Partners never produces one).
- Spectator view, multi-table, real auth (Clerk is unit E).
- Any change to `apps/match`, `apps/api`, or `packages/*`.

## Decisions

### D1 — One render model merging two state channels

Colyseus delivers table state through **two** independent channels: the auto-synced
`RoomMetadata` schema (presence: `lifecycle`, `seatToAct`, `seatStatus`, `occupancy`) and
discrete `onMessage` payloads (`view`/`accept`/`reject` carry the card-bearing
`FilteredView`; `commit`/`clockState` carry handshake/clock data). A small table store
(a Zustand store scoped to the table route, mirroring F0's session-store pattern) holds
the **latest `FilteredView`** plus the **latest synced metadata snapshot** and exposes a
single derived render model to the view components.

- The authoritative `FilteredView` is the source of truth for game content; the synced
  metadata is the source of truth for "whose turn / connection status / lifecycle."
- `view` and `accept.view` and `reject.view` all replace the held `FilteredView`
  wholesale — the server always sends a complete view, never a patch, so the client never
  reconstructs state and there is no client-side reducer over engine events.

_Alternative considered:_ drive everything off the synced schema and derive the rest.
Rejected — the schema deliberately carries no cards (hidden-info boundary), so card
content must come from the per-seat `view` messages regardless.

### D2 — Pessimistic intent submission keyed by `correlationId`

On a human action: generate a `correlationId` (e.g. `crypto.randomUUID()`), `room.send('intent',
{intent, correlationId})`, mark that correlation **pending**, and **disable all action
input** until the matching `accept`/`reject` arrives. `accept` → apply its `view`, clear
pending. `reject` → apply its authoritative `view` (re-sync to truth), surface
`reason`, clear pending. Unmatched correlation ids are ignored.

- No optimistic local mutation: the rendered hand/trick only ever reflects a
  server-confirmed `view`. Simpler and impossible to desync for the skeleton; optimism is
  an F2b polish.
- Input legality is gated by phase + `seatToAct === viewer`; the server remains the
  authority and `reject` is the backstop for any client-side legality gap.

### D3 — Phase→action mapping from `public.phase` + `seatToAct`

The available action is a pure function of `public.phase`, `public.seatToAct`, and the
viewer's seat:

| `public.phase`        | when `seatToAct === viewer`     | intent emitted |
| --------------------- | ------------------------------- | -------------- |
| `Auction`             | bid above current, or pass      | `bid` / `pass` |
| `TrumpDeclaration`\*  | choose a suit                   | `declareTrump` |
| `TrickPlay`           | play a legal card from own hand | `playCard`     |
| other / not your turn | render only, no actions         | —              |

\*phase name read from the engine's `LifecyclePhase`; the mapping is verified against the
engine during implementation. Legal-move enumeration mirrors what the bot brain already
does over a `FilteredView` (`@meldrank/bots`); F2a may render all own-hand cards and lean
on server `reject` for fine-grained legality rather than fully replicating
follow-suit/bury rules client-side. Bid increment/validity likewise leans on `reject`.

### D4 — Best-effort, fire-once seed contribution

On each `commit` message, generate 32 random bytes (`crypto.getRandomValues`), hex-encode,
and `room.send('contribute', {clientSeed})` exactly once for that `handNonce`. Do **not**
block rendering or the intent loop on the contribution or its `rejectContribution`. The
seed-assembly layer (`assembleSeed`) substitutes a deterministic fallback for any absent
seat, so a dropped or late contribution never stalls the deal — it only means the human
seat didn't add entropy to that hand.

### D5 — Warm-handoff join; cold load is an explicit F2a limitation

F2a joins using the `seatTicket` + `activeMatch` the lobby stashed in the session store
(the warm Quick Play → table path — exactly the smoke path). A **hard refresh** loses the
in-memory ticket, and `match.getActive` mints no new ticket, so a cold `/table/[roomId]`
load cannot rejoin in F2a: it renders a clear "return to lobby" affordance rather than a
broken connect. Cold-load ticket re-mint is **F2b/unit E** work (it needs either a
ticket-returning `getActive` or Clerk-authenticated re-issue) and is called out as an Open
Question. This keeps F2a honestly scoped to lighting the seam over the warm path.

### D6 — Connection lifecycle and disposal

Join in an effect on mount (client boundary only, guarded against SSR like the F0 Colyseus
provider); attach `onStateChange`, `onMessage(*)`, `onLeave`, `onError` handlers; leave the
room on unmount. The room drives itself to `Persisted` and **disconnects** the client when
the match completes and the durable write lands — the client treats that server-initiated
close, after a `matchResult` view, as the success terminal state (match complete), not an
error. A pre-completion drop is surfaced as an error state with a back-to-lobby affordance
(graceful reconnect is F2b).

## Risks / Trade-offs

- **[Phase-name / legal-action mismatch with the engine]** → The phase→action table (D3)
  is the one place F2a reaches into engine semantics. Mitigation: read the actual
  `LifecyclePhase` union and `PublicState` during implementation; render permissively and
  let server `reject` (D2) be the authority, so a mapping gap degrades to "rejected move,"
  not a wedged client.
- **[Two-channel races — a `view` arriving before/after a metadata sync]** → Each channel
  owns disjoint fields (D1: content vs. presence), and every `view` is complete, so there
  is no field both channels write; ordering between them cannot corrupt the render model.
- **[Cold-load can't rejoin]** (D5) → Accepted and explicit for F2a: the warm path is the
  smoke path; cold reload shows a back-to-lobby affordance. Tracked as Open Question for
  F2b.
- **[`colyseus.js` browser-globals / SSR]** → Already handled by the F0 provider pattern;
  all room logic stays under the client boundary and runs in effects, never during SSR
  render.
- **[Hidden-info leakage]** → Structurally impossible: `FilteredView` cannot represent
  another seat's cards and the synced schema carries none. The client renders only what
  it is sent.

## Open Questions

- **Cold-load / refresh rejoin (F2b):** does `match.getActive` grow a freshly-minted seat
  ticket, or does rejoin wait for Clerk (unit E) to authenticate a re-issue? Resolve when
  scoping F2b.
- **Card rendering fidelity:** F2a targets functional/legible (text or simple card chips)
  — confirm no visual-design bar must be cleared before the smoke counts as "done."
- **Reconnect grace UX (F2b):** the room already holds the seat open for a grace window
  via `allowReconnection`; F2a drops to back-to-lobby instead. F2b decides the in-table
  reconnect affordance.
