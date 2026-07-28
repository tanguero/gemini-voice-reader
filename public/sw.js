const CACHE_NAME = 'gemini-reader-v62';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/style.css',
  './src/js/app.js',
  './src/js/audio-player.js',
  './src/js/gemini-tts.js',
  './src/js/library.js',
  './src/js/parser.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Network-First strategy: Always fetch fresh code from server if online, fallback to cache if offline
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('generativelanguage.googleapis.com') || e.request.url.startsWith('blob:') || e.request.url.startsWith('data:')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(e.request))
  );
});
