// Kaya Tycoon — engine unit tests.
// Headless + deterministic (seeded RNG), zero extra dependencies. Run with:
//   npx tsx src/lib/tycoon/engine.test.ts
// (Node's built-in node:test auto-runs registered tests; exit code reflects
// pass/fail.) Mirrors the checks proven in the prototype's headless harness.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame, calcRent, resolveCurrency, availableCurrencies, ensureCurrency,
  niceRound, conv, roll, buyProperty, declineBuy, bid, passBid, applyCard,
  giveUp, settleDebt, raiseMortgage, build, canBuild, endTurn, makeRng,
} from './index';
import {
  BASE, PACKS, AIRPORT_IDX, UTIL_IDX, START_CASH, PASS_GO, JAIL_FEE,
} from './data';
import type { GameConfig, GameState } from './types';

function game(overrides: Partial<GameConfig> = {}): GameState {
  return createGame({
    mode: 'long', theme: 'cities', country: 'usa', homeCountry: 'usa',
    currency: 'usd', lapLimit: 2, auctions: false,
    players: [{ name: 'A', token: '🎩' }, { name: 'B', token: '🐬' }],
    ...overrides,
  });
}

// ── Rent math (USD ×1 → board values == BASE) ────────────────────────────
test('rent: base, full-set double, houses, hotel', () => {
  const s = game();
  // brown set = tiles 1 & 3; BASE[1].rent = [2,10,30,90,160,250]
  s.owners[1] = 0;
  assert.equal(calcRent(s, 1), 2, 'single tile = base rent');
  s.owners[3] = 0;
  assert.equal(calcRent(s, 1), 4, 'full colour set doubles base rent');
  s.houses[1] = 1; assert.equal(calcRent(s, 1), 10, '1 house');
  s.houses[1] = 2; assert.equal(calcRent(s, 1), 30, '2 houses');
  s.houses[1] = 3; assert.equal(calcRent(s, 1), 90, '3 houses');
  s.houses[1] = 4; assert.equal(calcRent(s, 1), 160, '4 houses');
  s.houses[1] = 5; assert.equal(calcRent(s, 1), 250, 'hotel');
});

test('rent: airports scale by count owned', () => {
  const s = game();
  const [a1, a2, a3, a4] = AIRPORT_IDX;
  s.owners[a1] = 0; assert.equal(calcRent(s, a1), 25, '1 airport');
  s.owners[a2] = 0; assert.equal(calcRent(s, a1), 50, '2 airports');
  s.owners[a3] = 0; assert.equal(calcRent(s, a1), 100, '3 airports');
  s.owners[a4] = 0; assert.equal(calcRent(s, a1), 200, '4 airports');
});

test('rent: utilities are dice × 4 (one) or × 10 (both)', () => {
  const s = game();
  const [u1, u2] = UTIL_IDX;
  s.lastRoll = 8;
  s.owners[u1] = 0; assert.equal(calcRent(s, u1), 32, '1 utility = 4× dice');
  s.owners[u2] = 0; assert.equal(calcRent(s, u1), 80, '2 utilities = 10× dice');
});

// ── niceRound integer guarantee across every currency rate ───────────────
test('niceRound: every scaled value is an integer for all 12 packs', () => {
  const bases = new Set<number>();
  BASE.forEach((t) => {
    [t.price, t.amount, t.mortgage, t.houseCost].forEach((v) => { if (v != null) bases.add(v); });
    (t.rent || []).forEach((r) => bases.add(r));
  });
  [START_CASH, PASS_GO, JAIL_FEE, 10, 25, 50, 100, 200].forEach((v) => bases.add(v));

  for (const k of Object.keys(PACKS)) {
    const cur = resolveCurrency({
      mode: 'long', theme: 'cities', country: k, homeCountry: k, currency: 'local',
      lapLimit: 2, auctions: false, players: [{ name: 'A', token: '🎩' }, { name: 'B', token: '🐬' }],
    });
    for (const b of bases) {
      const out = conv(cur, b);
      assert.ok(Number.isInteger(out), `${k} (${cur.symbol}×${cur.rate}): conv(${b}) = ${out} not integer`);
    }
  }
  // explicit ×0.8 (UK) + ×10 (Kaya) edge checks
  assert.ok(Number.isInteger(niceRound(2 * 0.8)), 'tiny ×0.8 stays integer');
  assert.equal(conv({ key: 'kaya', kind: 'kaya', symbol: '🪙 ', name: 'Kaya', rate: 10 }, 1500), 15000);
});

// ── Home-currency availability rule ──────────────────────────────────────
test('home rule: local currency only on the home board', () => {
  // on the home board → local offered first
  const home = availableCurrencies('cities', 'tanzania', 'tanzania');
  assert.equal(home[0].key, 'local');
  assert.deepEqual(home.map((c) => c.key), ['local', 'usd', 'kaya']);

  // away board → no local
  const away = availableCurrencies('cities', 'kenya', 'tanzania');
  assert.deepEqual(away.map((c) => c.key), ['usd', 'kaya']);

  // universe theme → no local even on "home"
  assert.deepEqual(availableCurrencies('universe', 'tanzania', 'tanzania').map((c) => c.key), ['usd', 'kaya']);

  // home currency that's just USD (usa) → no separate local
  assert.deepEqual(availableCurrencies('cities', 'usa', 'usa').map((c) => c.key), ['usd', 'kaya']);

  // requesting local on an away board falls back, and resolves to USD
  assert.equal(ensureCurrency('local', 'cities', 'kenya', 'tanzania'), 'usd');
  const resolvedAway = resolveCurrency({
    mode: 'long', theme: 'cities', country: 'kenya', homeCountry: 'tanzania', currency: 'local',
    lapLimit: 2, auctions: false, players: [{ name: 'A', token: '🎩' }, { name: 'B', token: '🐬' }],
  });
  assert.equal(resolvedAway.kind, 'usd');
});

// ── Auction resolution (ascending + pass-out) ────────────────────────────
test('auction: highest bidder wins and is charged', () => {
  let s = game({ auctions: true });
  s.prompt = { kind: 'buy', tile: 1, isDouble: false }; // brown, price 60
  const bStart = s.players[1].cash;
  s = declineBuy(s).state;
  assert.equal(s.prompt?.kind, 'auction');
  assert.equal(s.auction?.active.length, 2);
  s = bid(s, 40).state;   // p0 → 40
  s = bid(s, 60).state;   // p1 → 60
  s = passBid(s).state;   // p0 passes → only p1 left → auction ends
  assert.equal(s.owners[1], 1, 'high bidder owns the tile');
  assert.equal(s.players[1].cash, bStart - 60, 'high bidder charged their bid');
  assert.equal(s.auction, null);
});

test('auction: nobody bids → tile stays unclaimed', () => {
  let s = game({ auctions: true });
  s.prompt = { kind: 'buy', tile: 1, isDouble: false };
  s = declineBuy(s).state;
  s = passBid(s).state; // one pass (2 players) ends it with no bids
  assert.equal(s.owners[1], undefined);
  assert.equal(s.auction, null);
});

// ── Bankruptcy + asset transfer to the creditor ──────────────────────────
test('bankruptcy: assets transfer to the creditor; game ends', () => {
  let s = game({ mode: 'long' });
  s.owners[39] = 0; s.players[0].props = [39];
  s.owners[1] = 1; s.players[1].props = [1]; s.players[1].cash = 5;
  const p0Before = s.players[0].cash;
  s.pendingDebt = { player: 1, creditor: 0, amount: 99999, toPot: false };
  s.prompt = { kind: 'raiseCash' };
  s = giveUp(s).state;
  assert.ok(s.players[1].bankrupt);
  assert.equal(s.owners[1], 0, 'property transferred to creditor');
  assert.ok(s.players[0].props.includes(1));
  assert.equal(s.players[1].cash, 0);
  assert.equal(s.players[1].props.length, 0);
  assert.equal(s.players[0].cash, p0Before + 5, 'leftover cash goes to creditor');
  assert.ok(s.over);
  assert.equal(s.prompt?.kind, 'win');
  assert.equal(s.prompt && 'winnerId' in s.prompt ? s.prompt.winnerId : -1, 0);
});

test('debt → raise-cash → settle (Grand Tour, to the pot)', () => {
  let s = game({ mode: 'long' });
  s.players[0].cash = 20;            // < the 50 "new shoes" fine
  s.players[0].props = [9]; s.owners[9] = 0; // lblue idx9, mortgage 60
  s.prompt = { kind: 'card', deck: 'surprise', cardIdx: 4, isDouble: false }; // pay 50
  s = applyCard(s).state;
  assert.equal(s.prompt?.kind, 'raiseCash');
  assert.equal(s.pendingDebt?.amount, 50);
  assert.equal(s.pendingDebt?.toPot, true);
  s = raiseMortgage(s, 9).state;
  assert.ok(s.mortgaged[9]);
  const potBefore = s.parkingPot;
  s = settleDebt(s).state;
  assert.equal(s.pendingDebt, null);
  assert.equal(s.parkingPot, potBefore + 50, 'settled fine lands in the Free-Parking pot');
});

test('Quick Trip: unpayable debt with no assets → bankrupt', () => {
  let s = game({ mode: 'short' });
  s.players[0].cash = 10;
  s.players[0].props = [];
  s.prompt = { kind: 'card', deck: 'surprise', cardIdx: 4, isDouble: false }; // pay 50
  s = applyCard(s).state;
  assert.ok(s.players[0].bankrupt);
  assert.ok(s.over);
  assert.equal(s.prompt?.kind, 'win');
});

// ── Both modes reach a winner (deterministic auto-play) ───────────────────
function autoPlay(start: GameState, seed: number, maxSteps: number): GameState {
  const rng = makeRng(seed);
  let s = start;
  for (let i = 0; i < maxSteps && !s.over; i += 1) {
    const pr = s.prompt;
    if (pr) {
      if (pr.kind === 'buy') {
        const price = s.board[pr.tile].price || 0;
        s = (s.players[s.current].cash >= price ? buyProperty(s) : declineBuy(s)).state;
      } else if (pr.kind === 'card') {
        s = applyCard(s, rng).state;
      } else if (pr.kind === 'auction') {
        s = passBid(s).state;
      } else if (pr.kind === 'raiseCash') {
        s = giveUp(s).state;
      } else {
        break; // win
      }
    } else if (!s.rolled) {
      s = roll(s, rng).state;
    } else {
      if (s.mode === 'long') {
        const me = s.players[s.current];
        const bi = me.props.find((idx) => canBuild(s, idx) && me.cash >= (s.board[idx].houseCost || 0));
        if (bi !== undefined) { s = build(s, bi).state; continue; }
      }
      s = endTurn(s).state;
    }
  }
  return s;
}

test('Quick Trip reaches a winner (richest after laps)', () => {
  const s = autoPlay(game({ mode: 'short', lapLimit: 2, auctions: false }), 42, 50000);
  assert.ok(s.over, 'game ended');
  assert.equal(s.prompt?.kind, 'win');
  assert.notEqual(s.prompt && 'winnerId' in s.prompt ? s.prompt.winnerId : null, null);
});

test('Grand Tour reaches a winner (last solvent player)', () => {
  // Pure random 2-player play rarely forms monopolies (salary keeps both
  // solvent forever — true of the genre), so we seed developed monopolies for
  // p0 and let the loop drive the real bankruptcy → checkWin → winner path.
  const s0 = game({ mode: 'long', auctions: false });
  const giveSet = (ids: number[], owner: number, houses: number) => ids.forEach((i) => {
    s0.owners[i] = owner; s0.players[owner].props.push(i); s0.houses[i] = houses;
  });
  giveSet([26, 27, 29], 0, 5); // yellow hotels
  giveSet([31, 32, 34], 0, 5); // green hotels
  giveSet([37, 39], 0, 5);     // navy hotels
  s0.players[1].cash = 300;    // p1 will hit a hotel and can't cover it
  const s = autoPlay(s0, 7, 200000);
  assert.ok(s.over, 'game ended');
  assert.equal(s.prompt?.kind, 'win');
  assert.equal(s.players.filter((p) => !p.bankrupt).length, 1, 'exactly one solvent player');
});
