// Cupboard QA — everyone on "Who was in?" (run: npx tsx qa/cupboardPeople.test.ts)
import assert from 'node:assert/strict';
import { familyPeople } from '../src/lib/sparks/cupboardPeople';

const shelf = {
  members: [
    { id: 'u:elia', name: 'Elia Timotheo', emoji: '🧑', role: 'parent' as const, isMe: true },
    { id: 'u:diana', name: 'Diana Timotheo', emoji: '🧑', role: 'parent' as const, isMe: false },
  ],
  kids: [{ id: 'k1', name: 'Daniella Blessing', emoji: '💫', age: 9 }],
  settings: { guests: ['Grandma Rose', 'grandma rose', '  '] },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const people = familyPeople(shelf as any, ['Cousin Amani', 'Grandma Rose']);

assert.deepEqual(people.map((p) => p.id), ['u:elia', 'u:diana', 'k1', 'g:Grandma Rose', 'g:Cousin Amani']);
assert.ok(people.some((p) => p.label === 'Diana'), 'Diana (the other parent) is on the list');
assert.equal(people[0].label, 'Elia (you)');
assert.equal(people.find((p) => p.id === 'k1')?.age, 9);
assert.equal(people.filter((p) => p.kind === 'guest').length, 2, 'guests de-duplicated, blanks dropped');
// older server without `members` → children + guests still listed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assert.deepEqual(familyPeople({ kids: shelf.kids, settings: { guests: [] } } as any).map((p) => p.id), ['k1']);
console.log('✓ cupboardPeople — all assertions passed');
