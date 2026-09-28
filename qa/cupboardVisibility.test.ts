// Cupboard QA — 🔞 adults-only + 🛒 shopping-list visibility
// (run: npx tsx qa/cupboardVisibility.test.ts)
import assert from 'node:assert/strict';
import { canSeeAdult, canShop, visibleTo, adultOkForChild } from '../src/lib/sparks/cupboardVisibility';

const parent = { isParent: true, isHelper: false, childId: '' };
const helper = { isParent: false, isHelper: true, childId: '' };
const kid9 = { isParent: false, isHelper: false, childId: 'k1', age: 9 };
const kid17 = { isParent: false, isHelper: false, childId: 'k2', age: 17 };
const kid18 = { isParent: false, isHelper: false, childId: 'k3', age: 18 };
const kidNoBday = { isParent: false, isHelper: false, childId: 'k4' };

const adult = { adultOnly: true };
const listed = { shoppingList: true };
const plain = {};
const adultListed = { adultOnly: true, shoppingList: true };

// 🔞 adults-only
assert.equal(canSeeAdult(parent), true);
assert.equal(canSeeAdult(helper), false, 'helpers never see adult titles');
assert.equal(canSeeAdult(kid9), false);
assert.equal(canSeeAdult(kid17), false, '17 is still a child');
assert.equal(canSeeAdult(kid18), true, 'turning 18 unlocks it');
assert.equal(canSeeAdult(kidNoBday), false, 'no birthday → stays hidden');

// 🛒 shopping list
assert.equal(canShop(parent), true);
assert.equal(canShop(helper), true);
assert.equal(canShop(kid18), false, 'kids never see the shopping list');

// combined item visibility
assert.equal(visibleTo(kid9, plain), true);
assert.equal(visibleTo(kid9, adult), false);
assert.equal(visibleTo(kid18, adult), true);
assert.equal(visibleTo(kid9, listed), false);
assert.equal(visibleTo(helper, listed), true);
assert.equal(visibleTo(helper, adultListed), false, 'helper: listed but adult → hidden');
assert.equal(visibleTo(parent, adultListed), true);
// only a literal `true` flags — defensive against stray values
assert.equal(visibleTo(kid9, { adultOnly: 'true' }), true);

// giving an adults-only title
assert.equal(adultOkForChild(undefined), false);
assert.equal(adultOkForChild(17), false);
assert.equal(adultOkForChild(18), true);

console.log('✓ cupboardVisibility — all assertions passed');
