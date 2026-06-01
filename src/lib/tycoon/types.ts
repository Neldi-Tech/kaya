// Kaya Tycoon — engine types.
//
// Pure data shapes for the game. NOTHING here imports React or any Kaya
// runtime; the engine is a standalone, deterministic, unit-testable module
// (see ./engine.ts). The UI (src/components/games/KayaTycoon.tsx) renders a
// GameState and dispatches the engine's pure actions.
//
// Ported 1:1 from the working prototype (Kaya_Tycoon_Prototype.html).

export type Theme = 'cities' | 'universe';
export type Mode = 'short' | 'long'; // short = Quick Trip · long = Grand Tour
export type Deck = 'adventure' | 'surprise';

/** Property colour-sets, cheapest → most expensive. These are *functional*
 *  game colours (set-collection), not branding — kept as their own hues. */
export type Group =
  | 'brown' | 'lblue' | 'pink' | 'orange'
  | 'red' | 'yellow' | 'green' | 'dblue';

export type TileType =
  | 'start' | 'prop' | 'airport' | 'utility'
  | 'card' | 'tax' | 'jail' | 'parking' | 'gotojail';

/** A board tile's *mechanics only* (BASE), before naming + currency scaling. */
export interface BaseTile {
  type: TileType;
  group?: Group;        // prop
  price?: number;       // prop / airport / utility
  rent?: number[];      // prop: [base, 1h, 2h, 3h, 4h, hotel]
  houseCost?: number;   // prop
  mortgage?: number;    // prop / airport / utility
  amount?: number;      // tax
  deck?: Deck;          // card
}

/** A tile after buildBoard(): named + currency-scaled (prices/rents are ints
 *  in the active currency). Same shape as BaseTile plus a display name. */
export interface Tile extends BaseTile {
  name: string;
}

// ── Country packs (World Cities theme) ───────────────────────────────────
export interface CurrencyDef {
  symbol: string;
  name: string;
  rate: number; // multiplier vs US$ (the base economy)
}

export interface Pack {
  flag: string;
  label: string;
  continent: string;
  currency: CurrencyDef;
  groups: Record<Group, string[]>;
  airports: string[];
  utils: [string, string];   // [power, water]
  tax: [string, string];
}

export type CountryKey = string; // a key of PACKS

// ── Theme rendering (corners + airport/utility emoji) ────────────────────
export interface CornerDef { e: string; l: string; s?: string }
export interface ThemeRender {
  corners: { start: CornerDef; jail: CornerDef; parking: CornerDef; gotojail: CornerDef };
  airportE: string;
  utilE: Record<number, string>;
}

// ── Currency (resolved for a game) ───────────────────────────────────────
export type CurrencyKey = 'usd' | 'kaya' | 'local';

/** A resolved, *serialisable* currency: no closures, so it survives a future
 *  network sync. Conversion is done by conv()/money() in ./currency.ts. */
export interface ResolvedCurrency {
  key: CurrencyKey;
  kind: 'usd' | 'kaya' | 'local';
  symbol: string;
  name: string;
  rate: number; // used only when kind === 'local'
}

/** An offer in the currency picker (setup screen). */
export interface CurrencyOption {
  key: CurrencyKey;
  symbol: string;
  name: string;
  blurb: string;
}

// ── Players ──────────────────────────────────────────────────────────────
export interface Player {
  id: number;
  name: string;
  token: string;   // emoji
  color: string;   // per-player colour
  pos: number;     // tile index 0..39
  cash: number;    // in the active currency (ints)
  props: number[]; // owned tile indices
  jail: boolean;
  jailTurns: number;
  getout: number;  // Get-Out-of-Time-Out cards held
  bankrupt: boolean;
  laps: number;
  doublesCount: number;
}

// ── Setup config ─────────────────────────────────────────────────────────
export interface PlayerSetup { name: string; token: string }

export interface GameConfig {
  mode: Mode;
  theme: Theme;
  country: CountryKey;
  homeCountry: CountryKey;
  currency: CurrencyKey;
  lapLimit: number;     // Quick Trip: laps each before the richest wins
  auctions: boolean;
  players: PlayerSetup[];
}

// ── Live game state ──────────────────────────────────────────────────────
export interface AuctionState {
  tile: number;
  isDouble: boolean;
  active: number[];      // player ids still bidding, in turn order
  idx: number;           // whose turn within `active`
  high: number;          // highest bid so far
  highBidder: number | null;
}

export interface PendingDebt {
  player: number;
  creditor: number | null; // null = the bank
  amount: number;
  toPot: boolean;          // when creditor is null: route the settled amount to the Free-Parking pot
}

/** What the UI must show next (a decision the engine paused for). When null,
 *  it's a player's turn to roll / end. */
export type Prompt =
  | { kind: 'buy'; tile: number; isDouble: boolean }
  | { kind: 'auction' }
  | { kind: 'card'; deck: Deck; cardIdx: number; isDouble: boolean }
  | { kind: 'raiseCash' }
  | { kind: 'win'; winnerId: number | null; reason: string }
  | null;

export interface GameState {
  // setup-derived, static for the game
  mode: Mode;
  theme: Theme;
  country: CountryKey;
  sub: string;            // subtitle, e.g. "🇹🇿 Tanzania Tour"
  startCash: number;
  passGo: number;
  lapLimit: number;
  auctions: boolean;

  // derived from config (rebuildable for a future network layer)
  board: Tile[];
  cur: ResolvedCurrency;
  themeRender: ThemeRender;

  // dynamic
  players: Player[];
  owners: Record<number, number>;     // tileIdx → playerId
  houses: Record<number, number>;     // tileIdx → 0..5 (5 = hotel)
  mortgaged: Record<number, boolean>;
  current: number;                    // index into players
  parkingPot: number;
  rolled: boolean;                    // has the current player rolled this turn?
  lastRoll: number;                   // total of the last dice (for utility rent)
  over: boolean;
  auction: AuctionState | null;
  pendingDebt: PendingDebt | null;
  prompt: Prompt;
}

// ── Engine events (animation/log timeline for the UI) ────────────────────
export type GameEvent =
  | { type: 'log'; html: string }
  | { type: 'dice'; d1: number; d2: number; double: boolean }
  /** Ordered tile indices to hop through (excludes the start position).
   *  `salaryAt` lists step indices where the player crossed START. */
  | { type: 'move'; path: number[]; salaryAt: number[] }
  | { type: 'flash'; emoji: string; text: string }
  | { type: 'confetti' };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/** Injected randomness so games are reproducible in tests. Returns [0, 1). */
export type Rng = () => number;
