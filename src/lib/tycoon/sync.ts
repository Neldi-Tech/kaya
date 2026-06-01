// Kaya Tycoon — multi-device sync helpers.
//
// For online play the engine GameState is split into:
//   • config   — the immutable setup (theme/country/currency/mode/players…)
//   • snapshot — the dynamic slice that changes each turn
// `board`, `cur` and `themeRender` are DERIVED from config (rebuilt by
// createGame), so they're never synced — every device reconstructs them
// identically. This keeps the Firestore room doc small and serialisable.

import type { GameState, GameConfig, GameEvent, Prompt, AuctionState, PendingDebt, Player } from './types';
import { createGame } from './engine';

/** The serialisable, dynamic slice of a game (everything that changes in play). */
export interface TycoonSnapshot {
  players: Player[];
  owners: Record<number, number>;
  houses: Record<number, number>;
  mortgaged: Record<number, boolean>;
  current: number;
  parkingPot: number;
  rolled: boolean;
  lastRoll: number;
  over: boolean;
  auction: AuctionState | null;
  pendingDebt: PendingDebt | null;
  prompt: Prompt;
}

export function serialize(s: GameState): TycoonSnapshot {
  return {
    players: s.players,
    owners: s.owners,
    houses: s.houses,
    mortgaged: s.mortgaged,
    current: s.current,
    parkingPot: s.parkingPot,
    rolled: s.rolled,
    lastRoll: s.lastRoll,
    over: s.over,
    auction: s.auction,
    pendingDebt: s.pendingDebt,
    prompt: s.prompt,
  };
}

/** Rebuild a full GameState from config + a synced snapshot. Deterministic:
 *  createGame(config) regenerates board/cur/themeRender identically on every
 *  device, then the snapshot overlays the live dynamic fields. */
export function hydrate(config: GameConfig, snap: TycoonSnapshot): GameState {
  const base = createGame(config);
  return { ...base, ...snap };
}

// ── Unified room model ─────────────────────────────────────────────────────
/** Played on the host's device (pass-and-play), not a remote phone. */
export const LOCAL_SEAT = 'local';

/** A seat = one player in the game. `ownerUid` is the device that controls it
 *  (a remote phone's auth uid) or LOCAL_SEAT (driven by the host device). */
export interface Seat {
  id: number;        // seat index → engine player index
  name: string;
  token: string;     // emoji
  ownerUid: string;  // a player uid, or LOCAL_SEAT
}

/** The shape stored at session.state for a Tycoon room. */
export interface TycoonRoomState {
  config: GameConfig | null; // set in the lobby; non-null once started
  snap: TycoonSnapshot | null;
  events: GameEvent[];       // the last action's events, replayed on every device
  seq: number;               // bumps each action so clients know to play `events`
  seats: Seat[];
  [k: string]: unknown;      // tolerate the generic session.state index type
}

/** Can the device `myUid` act for seat index `seatIdx` right now?
 *  Remote seats are driven by their owner; LOCAL seats by the host device. */
export function controlsSeat(seats: Seat[], seatIdx: number, myUid: string, hostUid: string): boolean {
  const seat = seats[seatIdx];
  if (!seat) return false;
  if (seat.ownerUid === LOCAL_SEAT) return myUid === hostUid;
  return seat.ownerUid === myUid;
}

/** The seat whose input the engine is waiting on: the bidder during an
 *  auction, otherwise the player whose turn it is. */
export function activeSeatIndex(s: GameState): number {
  if (s.auction && s.prompt?.kind === 'auction') {
    return s.auction.active[s.auction.idx] ?? s.current;
  }
  return s.current;
}
