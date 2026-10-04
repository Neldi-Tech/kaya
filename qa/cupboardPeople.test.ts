// Cupboard QA — everyone on "Who was in?" (run: npx tsx qa/cupboardPeople.test.ts)
import assert from 'node:assert/strict';
import { familyPeople, helperOptions } from '../src/lib/sparks/cupboardPeople';

const shelf = {
  members: [
    { id: 'u:elia', name: 'Elia Timotheo', emoji: '🧑', role: 'parent' as const, isMe: true },
    { id: 'u:diana', name: 'Diana Timotheo', emoji: '🧑', role: 'parent' as const, isMe: false },
    { id: 'h:neema', name: 'Neema Joseph', emoji: '🤝', role: 'helper' as const, isMe: false },
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
// helpers: hidden by default, offered in "＋ Add someone", shown once added
assert.ok(!people.some((p) => p.id === 'h:neema'), 'helpers are not listed by default');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assert.deepEqual(helperOptions(shelf as any).map((p) => p.id), ['h:neema'], 'helper offered when adding');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withHelper = familyPeople(shelf as any, [], ['h:neema']);
assert.ok(withHelper.some((p) => p.id === 'h:neema' && p.label === 'Neema'), 'added helper appears');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assert.equal(helperOptions(shelf as any, ['h:neema']).length, 0, 'not offered twice');
// a helper viewing sees themself
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asHelper = familyPeople({ ...shelf, members: shelf.members.map((m) => ({ ...m, isMe: m.id === 'h:neema' })) } as any);
assert.ok(asHelper.some((p) => p.id === 'h:neema' && p.label === 'Neema (you)'));
console.log('✓ cupboardPeople — all assertions passed');
