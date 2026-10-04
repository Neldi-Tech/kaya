// Meeting QA — Learn & Grow quiz is stable across rebuilds
// (run: npx tsx qa/meetingQuiz.test.ts)
//
// Bug (2026-10-04): during a live meeting the screen refreshes its data
// (approvals, a 15 s poll). The quiz was rebuilt with a fresh Math.random
// shuffle each time, so a child's choices jumped, changed or vanished
// mid-answer. The builder is now seeded: same kid + window → identical quiz.
import assert from 'node:assert/strict';
import { buildKidQuiz, seededRandom } from '../src/lib/meetingQuiz';

const names = new Map([['r1', 'Brush teeth'], ['r2', 'Make bed'], ['r3', 'Homework'], ['r4', 'Tidy room']]);
const day = (date: string, bad: string[], exc: string[]) => ({
  childId: 'k1', date, badCount: bad.length, excellentCount: exc.length,
  badRoutineIds: bad, excellentRoutineIds: exc, totalRated: bad.length + exc.length,
});
const scores = [
  day('2026-09-28', ['r1', 'r2'], ['r3']),
  day('2026-09-29', ['r1'], ['r3', 'r4']),
  day('2026-09-30', [], ['r3', 'r2']),
  day('2026-10-01', ['r1', 'r4'], ['r3']),
];

const seed = 'k1|2026-09-28|2026-10-04';
const a = buildKidQuiz('Daniella', scores, names, 3, seed);
// rebuild 20× (what a refreshing meeting screen does) — always identical
for (let i = 0; i < 20; i++) assert.deepEqual(buildKidQuiz('Daniella', scores, names, 3, seed), a);
// …even when the input arrives in a different order
assert.deepEqual(buildKidQuiz('Daniella', scores.slice().reverse(), names, 3, seed), a);

assert.equal(a.length, 3);
assert.deepEqual(a.map((q) => q.kind), ['tricky-routine', 'tough-day', 'strong-routine']);
for (const q of a) {
  assert.equal(q.options.length, 3, 'every question keeps 3 choices');
  assert.equal(new Set(q.options).size, 3, 'choices are distinct');
  assert.ok(q.correctIndex >= 0 && q.correctIndex < 3);
}
assert.equal(a[0].options[a[0].correctIndex], 'Brush teeth', 'trickiest = most Bads');
assert.equal(a[2].options[a[2].correctIndex], 'Homework', 'best = most Excellents');

// seeded RNG is deterministic and in [0,1)
const r1 = seededRandom('x'), r2 = seededRandom('x');
for (let i = 0; i < 50; i++) { const v = r1(); assert.equal(v, r2()); assert.ok(v >= 0 && v < 1); }

console.log('✓ meetingQuiz — stable across rebuilds, answers correct');
