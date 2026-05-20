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

const VERSION = 'kaya-sw-v3';

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

// PWA installability bits — kept from the previous /sw.js. A
// registered fetch listener (even one that doesn't respondWith) is
// what makes Chrome treat the app as installable.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Pass-through: no respondWith() means the browser handles it normally.
});
