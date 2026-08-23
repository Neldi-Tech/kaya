// HP2 QA — routineFillCore unit checks (run: npx tsx qa/routineFill.test.ts)
import assert from 'node:assert/strict';
import { computeRoutineFill, fillCodes, isoWeekKey, mondayOf, addDays, expectedPeriods } from '../src/lib/routineFillCore';

const H = { uid: 'h1', kidIds: ['a', 'b'], expectedFrequency: 'both' as const, workDays: ['mon','tue','wed','thu','fri','sat'], joinedDate: '2026-08-01' };
const r = (date: string, childId: string, period: string, ratedBy = 'h1') => ({ date, childId, period, ratedBy });
const today = '2026-08-23'; // Sunday
const ratings = [
  // Mon 17: all 4 slots
  r('2026-08-17','a','morning'), r('2026-08-17','a','evening'), r('2026-08-17','b','morning'), r('2026-08-17','b','evening'),
  // Tue 18: 3 of 4 → amber
  r('2026-08-18','a','morning'), r('2026-08-18','a','evening'), r('2026-08-18','b','morning'),
  // Wed 19: none → red
  // Thu 20: parent rated (ignored) + helper all
  r('2026-08-20','a','morning','parent'), r('2026-08-20','a','morning'), r('2026-08-20','a','evening'), r('2026-08-20','b','morning'), r('2026-08-20','b','evening'),
  // Fri 21 all, Sat 22 all
  r('2026-08-21','a','morning'), r('2026-08-21','a','evening'), r('2026-08-21','b','morning'), r('2026-08-21','b','evening'),
  r('2026-08-22','a','morning'), r('2026-08-22','a','evening'), r('2026-08-22','b','morning'), r('2026-08-22','b','evening'),
  // Sun 23 (today, off-day)
];
const s = computeRoutineFill(H, ratings, '2026-08-17', '2026-08-23', today);
assert.equal(fillCodes(s.days), 'GARGGGO', 'week codes');
assert.equal(s.green, 4); assert.equal(s.amber, 1); assert.equal(s.red, 1); assert.equal(s.off, 1);
assert.equal(s.expectedSlots, 4 * 6); assert.equal(s.filledSlots, 4+3+0+4+4+4);
assert.equal(s.fillPct, Math.round(19/24*100));

// Elia's rule: 1 kid + both → missed one = amber, missed both = red
const H1 = { uid: 'h1', kidIds: ['a'], expectedFrequency: 'both' as const };
const s1 = computeRoutineFill(H1, [r('2026-08-18','a','morning')], '2026-08-18', '2026-08-19', today);
assert.equal(fillCodes(s1.days), 'AR');

// morning-only helper: one slot → green/red only
const Hm = { uid: 'h1', kidIds: ['a'], expectedFrequency: 'morning' as const };
const sm = computeRoutineFill(Hm, [r('2026-08-18','a','evening'), r('2026-08-19','a','morning')], '2026-08-18', '2026-08-19', today);
assert.equal(fillCodes(sm.days), 'RG');

// flexible: any period counts
const Hf = { uid: 'h1', kidIds: ['a'], expectedFrequency: 'flexible' as const };
const sf = computeRoutineFill(Hf, [r('2026-08-18','a','evening')], '2026-08-18', '2026-08-19', today);
assert.equal(fillCodes(sf.days), 'GR');

// today is live, future is future, before join is na, no kids is na
const Hj = { uid: 'h1', kidIds: ['a'], expectedFrequency: 'both' as const, joinedDate: '2026-08-22' };
const sj = computeRoutineFill(Hj, [], '2026-08-21', '2026-08-24', today);
assert.equal(fillCodes(sj.days), 'NRTF');
assert.equal(sj.fillPct, 0);
const Hk = { uid: 'h1', kidIds: [], expectedFrequency: 'both' as const };
assert.equal(fillCodes(computeRoutineFill(Hk, [], '2026-08-21', '2026-08-22', today).days), 'NN');
assert.equal(computeRoutineFill(Hk, [], '2026-08-21', '2026-08-22', today).fillPct, null);

// week helpers
assert.equal(mondayOf('2026-08-23'), '2026-08-17');
assert.equal(mondayOf('2026-08-17'), '2026-08-17');
assert.equal(addDays('2026-08-31', 1), '2026-09-01');
assert.equal(isoWeekKey('2026-08-17'), '2026-W34');
assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
assert.equal(isoWeekKey('2027-01-01'), '2026-W53');
assert.deepEqual(expectedPeriods('both'), ['morning','evening']);
console.log('routineFillCore ✓ all assertions passed');
