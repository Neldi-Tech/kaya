// QA — 📱 app mode detection (run: npx tsx qa/appMode.test.ts)
import assert from 'node:assert/strict';

type Store = Record<string, string>;
function fakeBrowser(search: string, referrer: string, store: Store = {}) {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    location: { search },
    sessionStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
    },
  };
  g.document = { referrer };
  return store;
}

(async () => {
  const { isAndroidApp } = await import('../src/lib/appMode');

  // plain browser visit → not the app
  fakeBrowser('', 'https://www.google.com/');
  assert.equal(isAndroidApp(), false);

  // launched by the Android app via the launch URL
  const s1 = fakeBrowser('?source=android-app', '');
  assert.equal(isAndroidApp(), true);
  assert.equal(s1['kaya:appMode'], 'android', 'armed for the session');

  // launched by Chrome's TWA referrer only
  fakeBrowser('', 'android-app://com.ourkaya.app/');
  assert.equal(isAndroidApp(), true);

  // later navigation in the same app session (param gone) stays in app mode
  fakeBrowser('', '', { 'kaya:appMode': 'android' });
  assert.equal(isAndroidApp(), true);

  // no window (server render) → false, never throws
  delete (globalThis as Record<string, unknown>).window;
  assert.equal(isAndroidApp(), false);

  console.log('✓ appMode — browser vs Android app detected correctly');
})();
