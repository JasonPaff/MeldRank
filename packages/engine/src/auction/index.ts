/**
 * The AuctionManager: turn order from the dealer, bid/pass legality, and
 * termination into a won `Bid` (including dealer-forced-at-minimum) or a redeal
 * outcome. The Auction-phase deterministic timeout resolves to a pass.
 */
export { openAuction, applyBid, applyPass, type AuctionState, type AuctionParams, type AuctionStep } from './auction';
