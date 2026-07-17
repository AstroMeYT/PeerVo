const CACHE_NAME = 'peervo-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        // Soft fail if offline / CDN links can't fetch during sw installation
        console.warn('Pre-cache failed; running with network fallback.', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // We do not cache API requests to the Python server
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // If everything fails and it is an HTML request, fallback to root cached index.html
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'INCOMING_CALL') {
    const caller = event.data.caller || 'Unknown Number';
    const isVideo = event.data.isVideo ? 'Video' : 'Audio';

    self.registration.showNotification('PeerVo - Incoming Call', {
      body: `Incoming ${isVideo} call from ${caller}`,
      icon: 'https://placehold.co/128x128/6366f1/ffffff?text=📞',
      vibrate: [200, 100, 200, 100, 200, 100, 400],
      tag: 'incoming-call-notification',
      requireInteraction: true,
      data: { callerNumber: caller }
    });
  }
});

// Handle Notification Interactions
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus on already open instance of the app or launch a new window
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});