importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// IMPORTANT: Replace this config with your values from the Firebase Console (Project Settings > General)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[Service Worker] Background Push caught: ', payload);

  // If the push matches PeerVo incoming call signaling schemas
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

// Capture notification clicks and restore/reopen window focus
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const callerNumber = event.notification.data ? event.notification.data.callerNumber : '';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Focus on an existing open tab
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus().then(() => {
            // Signal directly through client context to run the answer sequence
            client.postMessage({
              type: 'ANSWER_PUSHED_CALL',
              callerNumber: callerNumber
            });
          });
        }
      }
      // 2. Or launch a clean deep-linked tab
      if (clients.openWindow) {
        return clients.openWindow(`/?incoming_caller=${callerNumber}`);
      }
    })
  );
});