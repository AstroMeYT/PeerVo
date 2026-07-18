const CACHE_NAME = 'peervo-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      // Use standard slice approach to prevent cache lockouts during local wrapper builds
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
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
  // Force active SW takeover immediately on load
  self.clients.claim();
});

// Fetch Network Requests Caching
self.addEventListener('fetch', (event) => {
  // Ignore API calls to allow direct WebRTC routing and push setups
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

// Listen for Web Push Notifications when the tab is completely closed
self.addEventListener('push', (event) => {
  if (event.data) {
    try {
      const payload = event.data.json();
      
      if (payload.type === 'INCOMING_CALL') {
        const caller = payload.caller || 'Unknown Number';
        const isVideo = payload.isVideo ? 'Video' : 'Audio';

        // Custom OS Notification layout
        const promise = self.registration.showNotification('PeerVo - Incoming Call', {
          body: `Incoming ${isVideo} call from ${caller}`,
          icon: 'https://placehold.co/128x128/6366f1/ffffff?text=📞',
          vibrate: [300, 150, 300, 150, 300, 150, 600],
          tag: 'incoming-call-notification',
          requireInteraction: true,
          data: { callerNumber: caller, isVideo: payload.isVideo }
        });

        event.waitUntil(promise);
      }
    } catch (e) {
      console.error('Error parsing incoming push payload:', e);
    }
  }
});

// Handle Notification Clicks to restore/open the app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const callerNumber = event.notification.data ? event.notification.data.callerNumber : '';
  const isVideo = event.notification.data ? event.notification.data.isVideo : false;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Focus on an already open window if available
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'ANSWER_PUSHED_CALL',
            callerNumber: callerNumber,
            isVideo: isVideo
          });
          return client.focus();
        }
      }
      // 2. If no window is open, launch a new window passing deep-link caller parameters
      if (clients.openWindow) {
        return clients.openWindow(`/?incoming_caller=${callerNumber}&is_video=${isVideo}`);
      }
    })
  );
});