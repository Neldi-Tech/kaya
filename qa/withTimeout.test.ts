// QA — withTimeout never leaves a caller waiting forever
// (run: npx tsx qa/withTimeout.test.ts)
import assert from 'node:assert/strict';
import { withTimeout, TimeoutError } from '../src/lib/withTimeout';

(async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7, 'fast work resolves');
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 50), /boom/, 'errors pass through');
  const hang = new Promise<number>(() => { /* never settles — like a stalled upload */ });
  const t0 = Date.now();
  await assert.rejects(withTimeout(hang, 80, 'upload'), (e: unknown) => e instanceof TimeoutError && (e as TimeoutError).label === 'upload');
  assert.ok(Date.now() - t0 < 1000, 'gives up on time');
  console.log('✓ withTimeout — resolves, rejects, and gives up on a hung promise');
})();
