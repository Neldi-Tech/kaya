// Kaya Tycoon — sync helper tests. Run: npx tsx src/lib/tycoon/sync.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame, serialize, hydrate, controlsSeat, activeSeatIndex, LOCAL_SEAT,
} from './index';
import type { GameConfig, GameState, Seat } from './index';

const CONFIG: GameConfig = {
  mode: 'long', theme: 'cities', country: 'usa', homeCountry: 'usa', currency: 'usd',
  lapLimit: 2, auctions: true,
  players: [{ name: 'A', token: '🎩' }, { name: 'B', token: '🐬' }],
};

test('serialize → JSON round-trip → hydrate preserves the live state', () => {
  const g = createGame(CONFIG);
  // build a mid-game state
  g.owners[1] = 0; g.players[0].props.push(1); g.players[0].cash = 1234;
  g.houses[1] = 2; g.current = 1; g.parkingPot = 50; g.lastRoll = 7;
  g.mortgaged[1] = false;
  g.prompt = { kind: 'buy', tile: 6, isDouble: false };

  // mimic Firestore: everything goes through JSON (numeric map keys → strings)
  const wire = JSON.parse(JSON.stringify(serialize(g)));
  const h = hydrate(CONFIG, wire);

  assert.equal(h.players[0].cash, 1234);
  assert.equal(h.players[0].props.includes(1), true);
  assert.equal(h.owners[1], 0, 'numeric-keyed owner survives string-keying');
  assert.equal(h.houses[1], 2);
  assert.equal(h.current, 1);
  assert.equal(h.parkingPot, 50);
  assert.equal(h.lastRoll, 7);
  assert.deepEqual(h.prompt, { kind: 'buy', tile: 6, isDouble: false });

  // derived fields are rebuilt (not synced) and deterministic from config
  assert.equal(h.board.length, 40);
  assert.equal(h.board[39].name, g.board[39].name);
  assert.equal(h.board[1].price, g.board[1].price);
  assert.equal(h.cur.symbol, g.cur.symbol);
  assert.equal(h.themeRender.airportE, g.themeRender.airportE);
});

test('controlsSeat: remote seats by owner, local seats by host', () => {
  const seats: Seat[] = [
    { id: 0, name: 'A', token: '🎩', ownerUid: LOCAL_SEAT },
    { id: 1, name: 'B', token: '🐬', ownerUid: 'uidB' },
  ];
  assert.equal(controlsSeat(seats, 0, 'host', 'host'), true, 'host drives local seat');
  assert.equal(controlsSeat(seats, 0, 'uidB', 'host'), false, 'non-host cannot drive local seat');
  assert.equal(controlsSeat(seats, 1, 'uidB', 'host'), true, 'owner drives their remote seat');
  assert.equal(controlsSeat(seats, 1, 'host', 'host'), false, 'host cannot drive a claimed remote seat');
  assert.equal(controlsSeat(seats, 9, 'host', 'host'), false, 'no such seat');
});

test('activeSeatIndex: current player, or the bidder during an auction', () => {
  const g = createGame(CONFIG);
  g.current = 1;
  assert.equal(activeSeatIndex(g), 1, 'normal turn → current');

  const auctioning: GameState = {
    ...g,
    prompt: { kind: 'auction' },
    auction: { tile: 1, isDouble: false, active: [1, 0], idx: 1, high: 40, highBidder: 1 },
  };
  assert.equal(activeSeatIndex(auctioning), 0, 'auction → active[idx]');
});
