// QA — a missed Sunday meeting stays visible for 2 days (late-meeting grace)
// (run: NEXT_PUBLIC_FIREBASE_API_KEY=x NEXT_PUBLIC_FIREBASE_PROJECT_ID=x NEXT_PUBLIC_FIREBASE_APP_ID=x npx tsx qa/meetingGrace.test.ts)
import assert from 'node:assert/strict';
import { isCurrentCycle, graceCycleKey, meetingCycleKey, type MeetingSubmission } from '../src/lib/meetingSubmissions';

const SUN = 0;
const at = (iso: string) => new Date(`${iso}T12:00:00`); // local noon
const sub = (over: Partial<MeetingSubmission>): MeetingSubmission => ({
  uid: 'u', name: 'Kid', role: 'kid', gratitudes: ['x'], appreciations: [], goals: [],
  updatedAt: at('2026-10-14').getTime(), ...over,
} as MeetingSubmission);

// 2026-10-18 is a Sunday; Mon 19, Tue 20, Wed 21.
const prepForSunday = sub({ cycleKey: '2026-10-18' });

assert.equal(isCurrentCycle(prepForSunday, SUN, at('2026-10-17')), true, 'Sat before: current');
assert.equal(isCurrentCycle(prepForSunday, SUN, at('2026-10-18')), true, 'Meeting day: current');
assert.equal(isCurrentCycle(prepForSunday, SUN, at('2026-10-19')), true, 'Monday (missed Sunday): still current');
assert.equal(isCurrentCycle(prepForSunday, SUN, at('2026-10-20')), true, 'Tuesday: still current (day 2)');
assert.equal(isCurrentCycle(prepForSunday, SUN, at('2026-10-21')), false, 'Wednesday: grace over → stale (Hold it late restores)');

assert.equal(graceCycleKey(SUN, at('2026-10-18')), null, 'no grace on the meeting day itself');
assert.equal(graceCycleKey(SUN, at('2026-10-19')), '2026-10-18');
assert.equal(graceCycleKey(SUN, at('2026-10-21')), null);
assert.equal(graceCycleKey(undefined, at('2026-10-19')), null, 'no schedule → no grace');

// Next week's prep must never be confused with last week's.
const nextWeek = sub({ cycleKey: '2026-10-25' });
assert.equal(isCurrentCycle(nextWeek, SUN, at('2026-10-19')), true, 'Monday: next Sunday prep is current too');
const twoWeeksAgo = sub({ cycleKey: '2026-10-11' });
assert.equal(isCurrentCycle(twoWeeksAgo, SUN, at('2026-10-19')), false, 'older cycle stays stale');

// Legacy (no cycleKey) prep saved on Friday 16th belongs to the Sunday 18th cycle.
const legacy = sub({ cycleKey: undefined, updatedAt: at('2026-10-16').getTime() });
assert.equal(isCurrentCycle(legacy, SUN, at('2026-10-19')), true, 'legacy Fri prep visible Monday');
assert.equal(isCurrentCycle(legacy, SUN, at('2026-10-22')), false, 'legacy prep stale after grace');

// Saving keys are untouched: on Monday new prep still targets NEXT Sunday.
assert.equal(meetingCycleKey(SUN, at('2026-10-19')), '2026-10-25');

// No schedule → never gated (legacy behaviour).
assert.equal(isCurrentCycle(prepForSunday, undefined, at('2026-12-01')), true);
console.log('✓ meeting grace — Sun prep visible Mon+Tue, stale Wed, save keys unchanged');
