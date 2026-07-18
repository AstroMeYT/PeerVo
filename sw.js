importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// -------------------------------------------------------------
// PART 1: PWA Static Cache Implementation (Offline persistence)
// -------------------------------------------------------------
const CACHE_NAME = 'peervo-unified-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Unified SW] Pre-caching static assets for offline performance');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Pre-cache failed; running with network fallback.', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Unified SW] Clearing old cached assets', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Ignore API registry requests so signaling doesn't cache stale data
  if (event.request.url.includes('/api/')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// -------------------------------------------------------------
// PART 2: Firebase Cloud Messaging Configuration
// -------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyB4w6GX6iv9qvxZM0kGgwmrnpZg973Bqks",
  authDomain: "peervo-fcm.firebaseapp.com",
  projectId: "peervo-fcm",
  storageBucket: "peervo-fcm.firebasestorage.app",
  messagingSenderId: "549988903087",
  appId: "1:549988903087:web:0210539decb6f78a2f4c5a",
  measurementId: "G-31QC5BZ31D"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[Unified SW] Background Push received:', payload);

  if (payload.data && payload.data.type === 'INCOMING_CALL') {
    const caller = payload.data.caller || 'Unknown Number';
    const isVideo = payload.data.isVideo === "true" ? 'Video' : 'Audio';

    const notificationTitle = 'PeerVo - Incoming Call';
    const notificationOptions = {
      body: `Incoming ${isVideo} Call from ${caller}`,
      icon: 'https://placehold.co/128x128/6366f1/ffffff?text=📞',
      badge: 'https://placehold.co/64x64/6366f1/ffffff?text=📞',
      vibrate: [300, 150, 300, 150, 300, 150, 600],
      tag: 'incoming-call-notification',
      requireInteraction: true,
      data: { callerNumber: caller }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const callerNumber = event.notification.data ? event.notification.data.callerNumber : '';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. If a window is already running, focus and pass signal
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus().then(() => {
            client.postMessage({
              type: 'ANSWER_PUSHED_CALL',
              callerNumber: callerNumber
            });
          });
        }
      }
      // 2. Otherwise open a new window deep-linking caller parameter
      if (clients.openWindow) {
        return clients.openWindow(`/?incoming_caller=${callerNumber}`);
      }
    })
  );
});