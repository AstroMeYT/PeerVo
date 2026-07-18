importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const CACHE_NAME = 'peervo-unified-v7';
const ASSETS_TO_CACHE = [
  './',
  './index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Unified SW] Pre-caching static assets relative to deployment folder');
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
          return caches.match('./index.html');
        }
      });
    })
  );
});

// -------------------------------------------------------------
// Firebase Cloud Messaging Configuration
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
      icon: 'icon.png',
      badge: 'https://raw.githubusercontent.com/lucide-icons/lucide/refs/heads/main/icons/phone.svg',
      vibrate: [300, 150, 300, 150, 300, 150, 600],
      tag: 'incoming-call-notification',
      requireInteraction: true,
      data: { callerNumber: caller, isVideo: payload.data.isVideo === "true" }
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const callerNumber = event.notification.data ? event.notification.data.callerNumber : '';
  const isVideo = event.notification.data ? event.notification.data.isVideo : false;

  // Extract the host subdirectory path dynamically to support BOTH GitHub Pages and Localhost testing
  const basePath = self.location.pathname.substring(0, self.location.pathname.lastIndexOf('/') + 1);
  const targetUrl = new URL(`${basePath}?incoming_caller=${callerNumber}&is_video=${isVideo}`, self.location.origin).href;

  console.log('[Unified SW] Redirecting client destination to:', targetUrl);

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. If an active browser tab is already running, navigate it directly and focus it
      for (const client of windowClients) {
        if ('navigate' in client && 'focus' in client) {
          return client.navigate(targetUrl).then((focusedClient) => {
            if (focusedClient) return focusedClient.focus();
          });
        }
      }

      // 2. If no tab is open, launch a new window natively
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});