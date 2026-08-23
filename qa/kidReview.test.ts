// HP2 QA — kid review scoring + window (run: npx tsx qa/kidReview.test.ts)
import assert from 'node:assert/strict';
import { scoreAnswers, starsFor, questionSetFor, reviewWindowOpen, reviewWeekAnchor, fillName, nextWindowOpen } from '../src/lib/kidReviewQuestions';
import { ymdLocal, mondayOf } from '../src/lib/routineFillCore';

assert.equal(scoreAnswers([0,0,0,0]), 100);
assert.equal(scoreAnswers([1,1,1,1]), 70);
assert.equal(scoreAnswers([0,1,1,2]), Math.round((100+70+70+40)/4));
assert.equal(scoreAnswers([3,3,3,3]), 0);
assert.equal(scoreAnswers([0,1,2]), null);
assert.equal(scoreAnswers([0,1,2,4]), null);
assert.equal(starsFor(100), '⭐⭐⭐⭐⭐'); assert.equal(starsFor(70), '⭐⭐⭐⭐'); assert.equal(starsFor(0), '⭐'); assert.equal(starsFor(40), '⭐⭐');
assert.equal(questionSetFor('driver').questions[1].id, 'ontime');
assert.equal(questionSetFor('grandparent').key, 'nanny');
assert.equal(questionSetFor('security').key, 'other');
assert.equal(fillName('Was {name} on time?', 'Donald'), 'Was Donald on time?');

// window: Fri 09:00 UTC → Mon 02:59 UTC
const at = (iso: string) => new Date(iso);
assert.equal(reviewWindowOpen(at('2026-08-21T08:59:00Z')), false); // Fri before
assert.equal(reviewWindowOpen(at('2026-08-21T09:00:00Z')), true);  // Fri open
assert.equal(reviewWindowOpen(at('2026-08-22T12:00:00Z')), true);  // Sat
assert.equal(reviewWindowOpen(at('2026-08-23T23:30:00Z')), true);  // Sun
assert.equal(reviewWindowOpen(at('2026-08-24T02:59:00Z')), true);  // Mon early
assert.equal(reviewWindowOpen(at('2026-08-24T03:00:00Z')), false); // Mon closed
assert.equal(reviewWindowOpen(at('2026-08-25T12:00:00Z')), false); // Tue
// anchor: Monday early morning reviews LAST week
assert.equal(mondayOf(ymdLocal(reviewWeekAnchor(at('2026-08-24T01:00:00Z')))) <= '2026-08-23', true);
assert.equal(nextWindowOpen(at('2026-08-25T12:00:00Z')).toISOString(), '2026-08-28T09:00:00.000Z');
assert.equal(nextWindowOpen(at('2026-08-21T10:00:00Z')).toISOString(), '2026-08-28T09:00:00.000Z');
assert.equal(nextWindowOpen(at('2026-08-21T08:00:00Z')).toISOString(), '2026-08-21T09:00:00.000Z');
console.log('kidReviewQuestions ✓ all assertions passed');
