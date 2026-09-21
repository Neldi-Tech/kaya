// Kaya service worker — handles two jobs in one file:
//   1. PWA installability  (install/activate/fetch handlers).
//   2. Background push     (FCM onBackgroundMessage + notificationclick).
//
// Firebase config is hard-coded because:
//   - Service workers can't read process.env; injection at build time
//     adds complexity without benefit.
//   - These values are public client config (visible in every browser
//     request that loads the app) — not secrets.
//
// If the brand or domain changes, update the config here and bump
// VERSION below to force clients off the old worker.

const VERSION = 'kaya-sw-v4'; // v4 — 📴 Kaya Offline (O3): the app opens with no internet

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBLid2gV5kewy4IolxcfwZpxYWjyPN-PAE',
  authDomain: 'kaya-app-b9463.firebaseapp.com',
  projectId: 'kaya-app-b9463',
  storageBucket: 'kaya-app-b9463.firebasestorage.app',
  messagingSenderId: '25192553166',
  appId: '1:25192553166:web:5293eec451ff3ab2ebce9f',
});

const messaging = firebase.messaging();

// Background push handler. Fires when a push arrives and the app is
// closed or in another tab. For foreground pushes, see lib/push.ts.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (payload.notification && payload.notification.title) || data.title || 'Kaya';
  const body = (payload.notification && payload.notification.body) || data.body || '';
  return self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // 2026-05-20 — notification alerting fixes:
    //  • Unique tag per push (fallback to a timestamp) so a new
    //    notification doesn't SILENTLY replace the previous one. The
    //    old constant 'kaya' tag collapsed every alert into one that
    //    updated without sound/vibration — why pushes "didn't work".
    //  • renotify so even a reused tag re-alerts (sound + vibrate)
    //    instead of quietly swapping the text.
    //  • vibrate pattern → a tactile "sign" on Android (web push has
    //    no custom-sound support; the OS plays its default tone, and
    //    vibration is the one alert channel we can actually control).
    tag: data.tag || ('kaya-' + Date.now()),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/', ...data },
  });
});

// When the user taps a notification, focus an existing tab if Kaya is
// already open; otherwise open a new one at the URL the push specified.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = allClients.find((c) => c.url.startsWith(self.location.origin));
    if (existing) {
      await existing.focus();
      if ('navigate' in existing) await existing.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});

// ── 📴 Kaya Offline (O3, approved 22-Sep-2026) ────────────────────
// The app now OPENS with no internet: build assets cache-first (they're
// content-hashed, immutable), page navigations network-first (deploys stay
// fresh online) with cache → friendly offline page as fallbacks. APIs and
// cross-origin (Firebase/Google) requests are never touched — Firestore's
// own offline cache and the photo outbox own that layer.

const SHELL_CACHE = 'kaya-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled([
        cache.add(OFFLINE_URL),
        cache.add('/manifest.json'),
        cache.add('/icon-192.png'),
      ]);
    } catch (e) { /* precache is best-effort */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop older shell caches when SHELL_CACHE's version bumps.
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.indexOf('kaya-shell-') === 0 && k !== SHELL_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   // Firebase/Google — untouched
  if (url.pathname.indexOf('/api/') === 0) return;   // never cache APIs (incl. /api/version)

  // Immutable hashed build assets: cache-first.
  if (url.pathname.indexOf('/_next/static/') === 0) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(SHELL_CACHE); c.put(req, res.clone()); }
      return res;
    })());
    return;
  }

  // Page navigations: network-first so a deploy is picked up immediately
  // when online; offline falls back to the cached page, then the app root,
  // then the friendly offline page.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(SHELL_CACHE); c.put(req, res.clone()); }
        return res;
      } catch (e) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const root = await caches.match('/');
        if (root) return root;
        const off = await caches.match(OFFLINE_URL);
        return off || Response.error();
      }
    })());
    return;
  }

  // Everything else same-origin (fonts, icons, manifest): network-first
  // with cache fallback.
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(SHELL_CACHE); c.put(req, res.clone()); }
      return res;
    } catch (e) {
      const hit = await caches.match(req);
      return hit || Response.error();
    }
  })());
});
