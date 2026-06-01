// Kaya Tycoon — the pure game engine.
//
// Deterministic and UI-independent: every action is (state, …args) → { state,
// events }. State is treated immutably (each action clones, mutates the clone,
// returns it). `events` is an animation/log timeline the UI plays; tests can
// ignore it and assert on the returned state. Randomness is injected (Rng) so
// games are reproducible. No React, no DOM, no Kaya runtime imports here.
//
// Ported 1:1 from Kaya_Tycoon_Prototype.html. The few intentional fixes to
// prototype edge-case bugs are listed in the README's "Deviations" section.

import type {
  GameConfig, GameState, GameEvent, ActionResult, Player, Tile, ThemeRender,
  Group, Deck, Rng, ResolvedCurrency,
} from './types';
import {
  BASE, PACKS, UNIVERSE, CITY_CORNERS, GROUP_IDX, GROUP_SIZE, AIRPORT_IDX,
  UTIL_IDX, TAX_IDX, START_CASH, PASS_GO, JAIL_FEE, PCOLORS, COLOR_NAME, deck as getDeck,
  type Card,
} from './data';
import { conv, money as fmtMoney, resolveCurrency } from './currency';

// ── small helpers ────────────────────────────────────────────────────────
/** Convert a BASE value into the active currency. */
export function cv(s: GameState, base: number): number { return conv(s.cur, base); }
function money(s: GameState, v: number): string { return fmtMoney(s.cur, v); }
export function currentPlayer(s: GameState): Player { return s.players[s.current]; }

/** A seedable PRNG (mulberry32) for reproducible games + tests. Returns [0,1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, props: [...p.props] })),
    owners: { ...s.owners },
    houses: { ...s.houses },
    mortgaged: { ...s.mortgaged },
    auction: s.auction ? { ...s.auction, active: [...s.auction.active] } : null,
    pendingDebt: s.pendingDebt ? { ...s.pendingDebt } : null,
    // board / cur / themeRender are immutable after createGame → shared by ref
  };
}

const log = (ev: GameEvent[], html: string) => ev.push({ type: 'log', html });
const flash = (ev: GameEvent[], emoji: string, text: string) => ev.push({ type: 'flash', emoji, text });
const confetti = (ev: GameEvent[]) => ev.push({ type: 'confetti' });
const noop = (state: GameState): ActionResult => ({ state, events: [] });

// ── read-only queries (also used by the UI) ──────────────────────────────
export function tilesInGroup(s: GameState, g: Group): number[] {
  const r: number[] = [];
  s.board.forEach((t, i) => { if (t.type === 'prop' && t.group === g) r.push(i); });
  return r;
}
export function countType(s: GameState, ty: 'airport' | 'utility', pid: number): number {
  let c = 0;
  s.board.forEach((t, i) => { if (t.type === ty && s.owners[i] === pid) c += 1; });
  return c;
}
export function calcRent(s: GameState, i: number, mult = 1): number {
  const t = s.board[i];
  const owner = s.owners[i];
  if (t.type === 'prop') {
    const h = s.houses[i] || 0;
    if (h > 0) return t.rent![h];
    const set = tilesInGroup(s, t.group!);
    return set.every((x) => s.owners[x] === owner) ? t.rent![0] * 2 : t.rent![0];
  }
  if (t.type === 'airport') {
    const cnt = countType(s, 'airport', owner!);
    return cv(s, ({ 1: 25, 2: 50, 3: 100, 4: 200 } as Record<number, number>)[cnt] || 0) * mult;
  }
  if (t.type === 'utility') {
    const cnt = countType(s, 'utility', owner!);
    return cv(s, (cnt === 2 ? 10 : 4) * s.lastRoll) * mult;
  }
  return 0;
}
export function netWorth(s: GameState, p: Player): number {
  let nw = p.cash;
  p.props.forEach((i) => {
    if (!s.mortgaged[i]) nw += s.board[i].price || 0;
    nw += (s.houses[i] || 0) * (s.board[i].houseCost || 0);
  });
  return nw;
}
function liquidationValue(s: GameState, p: Player): number {
  let v = 0;
  p.props.forEach((i) => {
    if (!s.mortgaged[i]) v += s.board[i].mortgage || 0;
    v += (s.houses[i] || 0) * Math.floor((s.board[i].houseCost || 0) / 2);
  });
  return v;
}
export function canBuild(s: GameState, i: number): boolean {
  const t = s.board[i];
  if (t.type !== 'prop') return false;
  const set = tilesInGroup(s, t.group!);
  const owner = s.owners[i];
  if (!set.every((x) => s.owners[x] === owner)) return false;
  if (set.some((x) => s.mortgaged[x])) return false;
  const h = s.houses[i] || 0;
  const min = Math.min(...set.map((x) => s.houses[x] || 0));
  return h === min && h < 5;
}
/** True if a building on tile i can be sold under the even-build rule. */
export function canSellHouse(s: GameState, i: number): boolean {
  const t = s.board[i];
  if (t.type !== 'prop' || (s.houses[i] || 0) <= 0) return false;
  const set = tilesInGroup(s, t.group!);
  const max = Math.max(...set.map((x) => s.houses[x] || 0));
  return (s.houses[i] || 0) === max;
}
function noHousesInGroup(s: GameState, i: number): boolean {
  const t = s.board[i];
  if (t.type !== 'prop') return true;
  return tilesInGroup(s, t.group!).every((x) => (s.houses[x] || 0) === 0);
}
export function canMortgage(s: GameState, i: number): boolean {
  if (s.mortgaged[i]) return false;
  const t = s.board[i];
  return t.type !== 'prop' || ((s.houses[i] || 0) === 0 && noHousesInGroup(s, i));
}

// ── card text ────────────────────────────────────────────────────────────
function cardAmt(card: Card): number | undefined {
  const e = card.e;
  return e.collect ?? e.pay ?? e.collectFromEach;
}
export function cardDisplayText(s: GameState, card: Card): string {
  const amt = cardAmt(card);
  if (amt != null && card.x.includes('%')) return card.x.replace('%', money(s, cv(s, amt)));
  return card.x;
}

// ── board construction ───────────────────────────────────────────────────
export function buildBoard(config: GameConfig, cur: ResolvedCurrency): { board: Tile[]; themeRender: ThemeRender } {
  const names: Record<number, string> = {};
  let corners: ThemeRender['corners'];
  let airportE: string;
  const utilE: Record<number, string> = {};

  if (config.theme === 'universe') {
    Object.assign(names, UNIVERSE.names);
    corners = UNIVERSE.corners;
    airportE = UNIVERSE.airportE;
    Object.assign(utilE, UNIVERSE.utilE);
  } else {
    const pk = PACKS[config.country];
    corners = CITY_CORNERS;
    airportE = '✈️';
    (Object.keys(GROUP_IDX) as Group[]).forEach((g) => {
      GROUP_IDX[g].forEach((idx, j) => { names[idx] = pk.groups[g][j]; });
    });
    AIRPORT_IDX.forEach((idx, j) => { names[idx] = pk.airports[j]; });
    UTIL_IDX.forEach((idx, j) => { names[idx] = pk.utils[j]; utilE[idx] = j === 0 ? '⚡' : '💧'; });
    TAX_IDX.forEach((idx, j) => { names[idx] = pk.tax[j]; });
  }

  const cornerName: Record<string, string> = {
    start: corners.start.l, jail: corners.jail.l, parking: corners.parking.l, gotojail: corners.gotojail.l,
  };
  const board: Tile[] = BASE.map((t, i) => {
    const c: Tile = { ...t, name: '' };
    if (c.rent) c.rent = c.rent.slice();
    c.name = names[i] || cornerName[t.type] || (t.type === 'card' ? (t.deck === 'adventure' ? 'Adventure' : 'Surprise') : '');
    return c;
  });
  // scale the economy into the chosen currency (integers)
  board.forEach((t) => {
    if (t.price != null) t.price = conv(cur, t.price);
    if (t.amount != null) t.amount = conv(cur, t.amount);
    if (t.mortgage != null) t.mortgage = conv(cur, t.mortgage);
    if (t.houseCost != null) t.houseCost = conv(cur, t.houseCost);
    if (t.rent) t.rent = t.rent.map((v) => conv(cur, v));
  });
  return { board, themeRender: { corners, airportE, utilE } };
}

export function createGame(config: GameConfig): GameState {
  const cur = resolveCurrency(config);
  const { board, themeRender } = buildBoard(config, cur);
  const startCash = conv(cur, START_CASH);
  const passGo = conv(cur, PASS_GO);
  const players: Player[] = config.players.map((p, i) => ({
    id: i,
    name: (p.name || '').trim() || `Player ${i + 1}`,
    token: p.token,
    color: PCOLORS[i % 6],
    pos: 0, cash: startCash, props: [],
    jail: false, jailTurns: 0, getout: 0, bankrupt: false, laps: 0, doublesCount: 0,
  }));
  const sub = config.theme === 'universe'
    ? '🚀 Kaya Universe'
    : `${PACKS[config.country].flag} ${PACKS[config.country].label} Tour`;
  return {
    mode: config.mode, theme: config.theme, country: config.country, sub,
    startCash, passGo, lapLimit: config.lapLimit, auctions: config.auctions,
    board, cur, themeRender,
    players, owners: {}, houses: {}, mortgaged: {},
    current: 0, parkingPot: 0, rolled: false, lastRoll: 0, over: false,
    auction: null, pendingDebt: null, prompt: null,
  };
}

// ── internal mutators (operate on a cloned state, push events) ────────────
function finishLanding(s: GameState, ev: GameEvent[], isDouble: boolean): void {
  const p = currentPlayer(s);
  if (isDouble && !p.jail && !s.over) {
    log(ev, `🎉 Double — ${p.token} rolls again!`);
    s.rolled = false;
  } else {
    s.rolled = true;
  }
}

function sendToJail(s: GameState, p: Player): void {
  p.pos = 10; p.jail = true; p.jailTurns = 0; p.doublesCount = 0;
}

function checkWin(s: GameState, ev: GameEvent[]): void {
  const alive = s.players.filter((p) => !p.bankrupt);
  if (alive.length <= 1) {
    s.over = true;
    s.prompt = { kind: 'win', winnerId: alive[0] ? alive[0].id : null, reason: 'last tycoon standing 🏆' };
    confetti(ev);
  }
}

function endByRichest(s: GameState, ev: GameEvent[]): void {
  s.over = true;
  const alive = s.players.filter((p) => !p.bankrupt).slice().sort((a, b) => netWorth(s, b) - netWorth(s, a));
  s.prompt = { kind: 'win', winnerId: alive[0] ? alive[0].id : null, reason: 'richest tycoon 💰' };
  confetti(ev);
}

function bankrupt(s: GameState, p: Player, creditorId: number | null, ev: GameEvent[]): void {
  p.bankrupt = true;
  log(ev, `💥 ${p.token} ${p.name} has gone bankrupt!`);
  flash(ev, '💥', 'Bankrupt!');
  const creditor = creditorId != null ? s.players[creditorId] : null;
  p.props.forEach((i) => {
    s.houses[i] = 0;
    if (creditor && !creditor.bankrupt) { s.owners[i] = creditor.id; creditor.props.push(i); }
    else { delete s.owners[i]; delete s.mortgaged[i]; }
  });
  if (creditor && !creditor.bankrupt && p.cash > 0) creditor.cash += p.cash;
  p.cash = 0; p.props = [];
  s.pendingDebt = null; s.prompt = null;
  checkWin(s, ev);
  if (!s.over) finishLanding(s, ev, false);
}

/** Returns paused:true when the flow must wait (raise-cash modal) or has been
 *  fully handled (bankruptcy already finished the landing / ended the game). */
function handleDebt(s: GameState, p: Player, creditorId: number | null, amt: number, toPot: boolean, ev: GameEvent[]): { paused: boolean } {
  const potential = p.cash + liquidationValue(s, p);
  if (s.mode === 'long' && potential >= amt && p.props.length > 0) {
    s.pendingDebt = { player: p.id, creditor: creditorId, amount: amt, toPot };
    s.prompt = { kind: 'raiseCash' };
    return { paused: true };
  }
  bankrupt(s, p, creditorId, ev);
  return { paused: true };
}

function pay(s: GameState, p: Player, amt: number, toPot: boolean, ev: GameEvent[]): { paused: boolean } {
  if (p.cash >= amt) { p.cash -= amt; if (toPot) s.parkingPot += amt; return { paused: false }; }
  return handleDebt(s, p, null, amt, toPot, ev);
}
function transfer(s: GameState, from: Player, to: Player, amt: number, ev: GameEvent[]): { paused: boolean } {
  if (from.cash >= amt) { from.cash -= amt; to.cash += amt; return { paused: false }; }
  return handleDebt(s, from, to.id, amt, false, ev);
}

/** Move `delta` tiles (signed), hopping one at a time; awards salary on each
 *  forward crossing of START. Emits a `move` event for the UI to animate. */
function stepMove(s: GameState, p: Player, delta: number, awardGo: boolean, ev: GameEvent[]): void {
  const dir = delta >= 0 ? 1 : -1;
  let remaining = Math.abs(delta);
  const path: number[] = [];
  const salaryAt: number[] = [];
  let step = 0;
  while (remaining > 0) {
    p.pos = (p.pos + dir + 40) % 40;
    path.push(p.pos);
    if (awardGo && dir > 0 && p.pos === 0) {
      p.cash += s.passGo; p.laps += 1; salaryAt.push(step);
      log(ev, `${p.token} passed ${s.themeRender.corners.start.l} — collect ${money(s, s.passGo)}! 💵`);
    }
    step += 1; remaining -= 1;
  }
  if (path.length) ev.push({ type: 'move', path, salaryAt });
}

function offerBuy(s: GameState, i: number, isDouble: boolean): void {
  s.prompt = { kind: 'buy', tile: i, isDouble };
}

function startAuction(s: GameState, i: number, isDouble: boolean, ev: GameEvent[]): void {
  const bidders = s.players.filter((p) => !p.bankrupt).map((p) => p.id);
  s.auction = { tile: i, isDouble, active: bidders.slice(), idx: 0, high: 0, highBidder: null };
  s.prompt = { kind: 'auction' };
  maybeFinishAuction(s, ev);
}
function maybeFinishAuction(s: GameState, ev: GameEvent[]): void {
  const a = s.auction;
  if (a && a.active.length <= 1) finishAuction(s, ev);
}
function finishAuction(s: GameState, ev: GameEvent[]): void {
  const a = s.auction!;
  const t = s.board[a.tile];
  if (a.highBidder !== null) {
    const w = s.players[a.highBidder];
    w.cash -= a.high; s.owners[a.tile] = w.id; w.props.push(a.tile);
    log(ev, `🔨 ${w.token} won ${t.name} at auction for ${money(s, a.high)}!`);
    flash(ev, '🔨', 'Sold!'); confetti(ev);
  } else {
    log(ev, `No bids — ${t.name} stays unclaimed.`);
  }
  const isD = a.isDouble;
  s.auction = null; s.prompt = null;
  finishLanding(s, ev, isD);
}

function drawCard(s: GameState, d: Deck, isDouble: boolean, ev: GameEvent[], rng: Rng): void {
  const arr = getDeck(d);
  const idx = Math.floor(rng() * arr.length);
  s.prompt = { kind: 'card', deck: d, cardIdx: idx, isDouble };
}

function handleProperty(s: GameState, i: number, isDouble: boolean, ev: GameEvent[]): void {
  const t = s.board[i];
  const p = currentPlayer(s);
  const owner = s.owners[i];
  if (owner === undefined) { offerBuy(s, i, isDouble); return; }
  if (owner === p.id) { log(ev, `${p.token} is on their own ${t.name}. 😎`); finishLanding(s, ev, isDouble); return; }
  if (s.mortgaged[i]) { log(ev, `${t.name} is mortgaged — no rent. 😌`); finishLanding(s, ev, isDouble); return; }
  const rent = calcRent(s, i);
  const op = s.players[owner];
  log(ev, `${p.token} landed on ${op.token} ${t.name} — pays ${money(s, rent)} rent.`);
  flash(ev, '💸', `Rent ${money(s, rent)}`);
  const r = transfer(s, p, op, rent, ev);
  if (!r.paused) finishLanding(s, ev, isDouble);
}

function resolveLanding(s: GameState, i: number, isDouble: boolean, ev: GameEvent[], rng: Rng): void {
  const t = s.board[i];
  const p = currentPlayer(s);
  const C = s.themeRender.corners;
  switch (t.type) {
    case 'start': log(ev, `${p.token} is on ${C.start.l}.`); finishLanding(s, ev, isDouble); break;
    case 'jail': log(ev, `${p.token} is just visiting. 🛑`); finishLanding(s, ev, isDouble); break;
    case 'parking':
      if (s.parkingPot > 0) {
        log(ev, `${p.token} scoops the ${money(s, s.parkingPot)} ${C.parking.l} pot! 💰`);
        flash(ev, '💰', `+${money(s, s.parkingPot)}`); p.cash += s.parkingPot; s.parkingPot = 0; confetti(ev);
      } else { log(ev, `${p.token} takes a rest. ${C.parking.e}`); }
      finishLanding(s, ev, isDouble); break;
    case 'gotojail':
      log(ev, `${p.token} is sent to ${C.gotojail.l.replace('GO TO ', '')}! ${C.gotojail.e}`);
      flash(ev, C.gotojail.e, 'Uh oh!'); sendToJail(s, p); s.rolled = true; break;
    case 'tax': {
      log(ev, `${p.token} pays ${t.name}: ${money(s, t.amount!)}. 💸`);
      flash(ev, '💸', `-${money(s, t.amount!)}`);
      const r = pay(s, p, t.amount!, true, ev);
      if (!r.paused) finishLanding(s, ev, isDouble);
      break;
    }
    case 'card': drawCard(s, t.deck!, isDouble, ev, rng); break;
    case 'prop': case 'airport': case 'utility': handleProperty(s, i, isDouble, ev); break;
    default: finishLanding(s, ev, isDouble);
  }
}

function nearestAirportLand(s: GameState, target: number, isDouble: boolean, ev: GameEvent[]): void {
  const p = currentPlayer(s);
  const owner = s.owners[target];
  if (owner === undefined) { offerBuy(s, target, isDouble); return; }
  if (owner === p.id) { log(ev, 'Your own port. 😎'); finishLanding(s, ev, isDouble); return; }
  const rent = calcRent(s, target, 2);
  log(ev, `Double rent: ${money(s, rent)}.`);
  flash(ev, '💸', `Rent ${money(s, rent)}`);
  const r = transfer(s, p, s.players[owner], rent, ev);
  if (!r.paused) finishLanding(s, ev, isDouble);
}

// ════════════════════════════ PUBLIC ACTIONS ════════════════════════════
export function roll(state: GameState, rng: Rng = Math.random): ActionResult {
  if (state.over || state.rolled || state.prompt) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = currentPlayer(s);
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2;
  const isDouble = d1 === d2;
  ev.push({ type: 'dice', d1, d2, double: isDouble });
  s.lastRoll = total;
  const C = s.themeRender.corners;

  if (p.jail) {
    if (isDouble) {
      log(ev, `${p.token} rolled a double and is FREE! 🎉`); flash(ev, '🔓', 'Free!');
      p.jail = false; p.jailTurns = 0;
      stepMove(s, p, total, true, ev);
      resolveLanding(s, p.pos, false, ev, rng);
    } else {
      p.jailTurns += 1;
      if (p.jailTurns >= 3) {
        const fee = cv(s, JAIL_FEE);
        log(ev, `${p.token} pays ${money(s, fee)} to get out after 3 tries.`);
        const r = pay(s, p, fee, false, ev);
        p.jail = false; p.jailTurns = 0;
        if (!r.paused) { stepMove(s, p, total, true, ev); resolveLanding(s, p.pos, false, ev, rng); }
      } else {
        log(ev, `${p.token} stays put (try ${p.jailTurns}/3).`);
        s.rolled = true;
      }
    }
    return { state: s, events: ev };
  }

  if (isDouble) {
    p.doublesCount += 1;
    if (s.mode === 'long' && p.doublesCount >= 3) {
      log(ev, `${p.token} rolled 3 doubles — off you go for speeding! 🚓`);
      flash(ev, C.gotojail.e, 'Caught!');
      sendToJail(s, p); s.rolled = true;
      return { state: s, events: ev };
    }
  } else {
    p.doublesCount = 0;
  }
  stepMove(s, p, total, true, ev);
  resolveLanding(s, p.pos, isDouble, ev, rng);
  return { state: s, events: ev };
}

export function buyProperty(state: GameState): ActionResult {
  const pr = state.prompt;
  if (!pr || pr.kind !== 'buy') return noop(state);
  const t = state.board[pr.tile];
  if (state.players[state.current].cash < (t.price || 0)) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = currentPlayer(s);
  p.cash -= t.price!; s.owners[pr.tile] = p.id; p.props.push(pr.tile);
  log(ev, `${p.token} bought ${t.name} for ${money(s, t.price!)}! 🏙️`);
  flash(ev, '🎉', 'Bought!'); confetti(ev);
  s.prompt = null;
  finishLanding(s, ev, pr.isDouble);
  return { state: s, events: ev };
}

export function declineBuy(state: GameState): ActionResult {
  const pr = state.prompt;
  if (!pr || pr.kind !== 'buy') return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const { tile, isDouble } = pr;
  s.prompt = null;
  if (s.auctions) {
    startAuction(s, tile, isDouble, ev);
  } else {
    log(ev, `${currentPlayer(s).token} passed on ${s.board[tile].name}.`);
    finishLanding(s, ev, isDouble);
  }
  return { state: s, events: ev };
}

export function bid(state: GameState, amount: number): ActionResult {
  const a = state.auction;
  if (!a) return noop(state);
  if (state.players[a.active[a.idx]].cash < amount) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const au = s.auction!;
  au.high = amount; au.highBidder = au.active[au.idx]; au.idx = (au.idx + 1) % au.active.length;
  maybeFinishAuction(s, ev);
  return { state: s, events: ev };
}

export function passBid(state: GameState): ActionResult {
  const a = state.auction;
  if (!a) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const au = s.auction!;
  au.active.splice(au.idx, 1);
  if (au.idx >= au.active.length) au.idx = 0;
  maybeFinishAuction(s, ev);
  return { state: s, events: ev };
}

export function applyCard(state: GameState, rng: Rng = Math.random): ActionResult {
  const pr = state.prompt;
  if (!pr || pr.kind !== 'card') return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const card = getDeck(pr.deck)[pr.cardIdx];
  const e = card.e;
  const p = currentPlayer(s);
  const isDouble = pr.isDouble;
  s.prompt = null;
  log(ev, `${p.token} drew: ${cardDisplayText(s, card)}`);

  if (e.collect !== undefined) {
    const v = cv(s, e.collect); p.cash += v; flash(ev, '💰', `+${money(s, v)}`); finishLanding(s, ev, isDouble);
  } else if (e.pay !== undefined) {
    const v = cv(s, e.pay); flash(ev, '💸', `-${money(s, v)}`);
    const r = pay(s, p, v, true, ev); if (!r.paused) finishLanding(s, ev, isDouble);
  } else if (e.collectFromEach !== undefined) {
    const v = cv(s, e.collectFromEach);
    s.players.forEach((o) => {
      if (o.id !== p.id && !o.bankrupt) { const give = Math.min(o.cash, v); o.cash -= give; p.cash += give; }
    });
    flash(ev, '🎂', 'Happy Birthday!'); confetti(ev); finishLanding(s, ev, isDouble);
  } else if (e.gotojail !== undefined) {
    sendToJail(s, p); s.rolled = true;
  } else if (e.getoutfree !== undefined) {
    p.getout += 1; flash(ev, '🎟️', 'Saved!'); finishLanding(s, ev, isDouble);
  } else if (e.move !== undefined) {
    const delta = (e.move - p.pos + 40) % 40;
    stepMove(s, p, delta, true, ev); resolveLanding(s, p.pos, isDouble, ev, rng);
  } else if (e.moveBy !== undefined) {
    stepMove(s, p, e.moveBy, false, ev); resolveLanding(s, p.pos, isDouble, ev, rng);
  } else if (e.nearestAirport !== undefined) {
    const airs = AIRPORT_IDX;
    let target = airs.find((x) => x > p.pos);
    if (target === undefined) target = airs[0];
    const delta = (target - p.pos + 40) % 40;
    stepMove(s, p, delta, true, ev); nearestAirportLand(s, target, isDouble, ev);
  } else {
    finishLanding(s, ev, isDouble);
  }
  return { state: s, events: ev };
}

// ── manage (Grand Tour) ───────────────────────────────────────────────────
export function build(state: GameState, i: number): ActionResult {
  if (!canBuild(state, i)) return noop(state);
  const t = state.board[i];
  if (state.players[state.current].cash < (t.houseCost || 0)) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = currentPlayer(s);
  p.cash -= t.houseCost!; s.houses[i] = (s.houses[i] || 0) + 1;
  log(ev, `${p.token} built ${s.houses[i] === 5 ? 'a hotel 🏨' : 'a house 🏠'} on ${t.name}.`);
  flash(ev, s.houses[i] === 5 ? '🏨' : '🏠', 'Built!'); confetti(ev);
  return { state: s, events: ev };
}

export function sellHouse(state: GameState, i: number): ActionResult {
  if (!canSellHouse(state, i)) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = currentPlayer(s);
  const t = s.board[i];
  s.houses[i] -= 1; p.cash += Math.floor((t.houseCost || 0) / 2);
  log(ev, `${p.token} sold a building on ${t.name}.`);
  return { state: s, events: ev };
}

export function mortgage(state: GameState, i: number): ActionResult {
  if (!canMortgage(state, i)) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = currentPlayer(s);
  s.mortgaged[i] = true; p.cash += s.board[i].mortgage || 0;
  log(ev, `${p.token} mortgaged ${s.board[i].name}.`);
  return { state: s, events: ev };
}

export function unmortgage(state: GameState, i: number): ActionResult {
  if (!state.mortgaged[i]) return noop(state);
  const cost = Math.ceil((state.board[i].mortgage || 0) * 1.1);
  if (state.players[state.current].cash < cost) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = currentPlayer(s);
  p.cash -= cost; delete s.mortgaged[i];
  log(ev, `${p.token} lifted the mortgage on ${s.board[i].name}.`);
  return { state: s, events: ev };
}

export function sellToPlayer(state: GameState, i: number, buyerId: number, price: number): ActionResult {
  const seller = state.players[state.current];
  if (!seller.props.includes(i) || (state.houses[i] || 0) > 0) return noop(state);
  const buyer = state.players[buyerId];
  if (!buyer || buyer.bankrupt || buyer.id === seller.id) return noop(state);
  const cost = Math.max(0, Math.floor(price) || 0);
  if (buyer.cash < cost) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const sp = currentPlayer(s);
  const bp = s.players[buyerId];
  bp.cash -= cost; sp.cash += cost;
  sp.props = sp.props.filter((x) => x !== i);
  s.owners[i] = buyerId; bp.props.push(i);
  log(ev, `🤝 ${sp.token} sold ${s.board[i].name} to ${bp.token} for ${money(s, cost)}.`);
  confetti(ev);
  return { state: s, events: ev };
}

// ── raise cash (debt flow) ────────────────────────────────────────────────
export function raiseSellHouse(state: GameState, i: number): ActionResult {
  const d = state.pendingDebt;
  if (!d || (state.houses[i] || 0) <= 0) return noop(state);
  const s = clone(state);
  s.houses[i] -= 1;
  s.players[d.player].cash += Math.floor((s.board[i].houseCost || 0) / 2);
  return { state: s, events: [] };
}
export function raiseMortgage(state: GameState, i: number): ActionResult {
  const d = state.pendingDebt;
  if (!d || state.mortgaged[i]) return noop(state);
  const t = state.board[i];
  if (t.type === 'prop' && !((state.houses[i] || 0) === 0 && noHousesInGroup(state, i))) return noop(state);
  const s = clone(state);
  s.mortgaged[i] = true;
  s.players[d.player].cash += t.mortgage || 0;
  return { state: s, events: [] };
}
export function settleDebt(state: GameState): ActionResult {
  const d = state.pendingDebt;
  if (!d || state.players[d.player].cash < d.amount) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = s.players[d.player];
  p.cash -= d.amount;
  if (d.creditor !== null) s.players[d.creditor].cash += d.amount;
  else if (d.toPot) s.parkingPot += d.amount;
  s.pendingDebt = null; s.prompt = null;
  log(ev, `${p.token} settled up. 😅`);
  finishLanding(s, ev, false);
  return { state: s, events: ev };
}
export function giveUp(state: GameState): ActionResult {
  const d = state.pendingDebt;
  if (!d) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  bankrupt(s, s.players[d.player], d.creditor, ev);
  return { state: s, events: ev };
}

// ── end turn ──────────────────────────────────────────────────────────────
export function endTurn(state: GameState): ActionResult {
  if (!state.rolled || state.over || state.prompt) return noop(state);
  const s = clone(state);
  const ev: GameEvent[] = [];
  let n = s.current;
  for (let k = 0; k < s.players.length; k += 1) {
    n = (n + 1) % s.players.length;
    if (!s.players[n].bankrupt) break;
  }
  s.current = n; s.rolled = false; s.lastRoll = 0; s.players[n].doublesCount = 0;
  if (s.mode === 'short') {
    const allDone = s.players.filter((p) => !p.bankrupt).every((p) => p.laps >= s.lapLimit);
    if (allDone) { endByRichest(s, ev); return { state: s, events: ev }; }
  }
  return { state: s, events: ev };
}

// ── investor coach ─────────────────────────────────────────────────────────
export function investorTips(s: GameState, p: Player): string[] {
  const tips: string[] = [];
  const word = s.theme === 'universe' ? 'planets' : 'cities';
  const groups: Partial<Record<Group, number>> = {};
  p.props.forEach((i) => {
    const t = s.board[i];
    if (t.type === 'prop') groups[t.group!] = (groups[t.group!] || 0) + 1;
  });
  (Object.keys(groups) as Group[]).forEach((g) => {
    const have = groups[g]!;
    const need = GROUP_SIZE[g] - have;
    if (need > 0 && have >= GROUP_SIZE[g] - 1) {
      tips.push(`🎯 You own ${have} of ${GROUP_SIZE[g]} ${COLOR_NAME[g]} ${word}. Grab the last one to double the rent${s.mode === 'long' ? ' and start building houses!' : '!'}`);
    }
  });
  if (s.mode === 'long') {
    (Object.keys(groups) as Group[]).forEach((g) => {
      if (groups[g] === GROUP_SIZE[g]) {
        const set = tilesInGroup(s, g);
        const houses = set.reduce((acc, i) => acc + (s.houses[i] || 0), 0);
        if (houses === 0 && p.cash > cv(s, 200)) {
          tips.push(`🏠 You own all the ${COLOR_NAME[g]} ${word} — build houses to make rent much bigger!`);
        }
      }
    });
  }
  const air = countType(s, 'airport', p.id);
  if (air >= 2) tips.push(`✈️ ${air} ports owned — each extra one doubles your port rent. Collect them all!`);
  if (p.cash < cv(s, 150) && !p.bankrupt) tips.push(`⚠️ Cash is low. Be careful landing on big rents${s.mode === 'long' ? ' — you may need to mortgage.' : '.'}`);
  if (p.cash > cv(s, 600)) tips.push(`💪 Lots of cash! A good time to buy ${word} or ${s.mode === 'long' ? 'build houses' : 'snap up bargains'}.`);
  if (p.props.length === 0) tips.push(`🚀 Start buying ${word} when you land on them — owning property is how you earn rent!`);
  if (!tips.length) tips.push(`📈 Steady going! Keep buying ${word} and try to complete a colour set for double rent.`);
  return tips;
}
