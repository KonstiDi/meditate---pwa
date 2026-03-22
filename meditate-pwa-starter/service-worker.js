// Equipoise - Service Worker
// Offline-first shell + runtime audio caching

const CACHE_NAME = 'equipoise-shell-v1';
const AUDIO_CACHE = 'equipoise-audio-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './privacy.html',
  './sessions.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/Logo A Blue.png',
  './assets/Profile Picture 1.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => {
        if (k !== CACHE_NAME && k !== AUDIO_CACHE) return caches.delete(k);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Shell: cache-first
  if (SHELL_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '')))) {
    event.respondWith(
      caches.match(event.request).then(resp => resp || fetch(event.request))
    );
    return;
  }

  // Audio: cache-first
  if (url.pathname.includes('/audio/')) {
    event.respondWith((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const resp = await fetch(event.request);
      cache.put(event.request, resp.clone());
      return resp;
    })());
    return;
  }

  // Default: network-first with cache fallback
  event.respondWith((async () => {
    try {
      return await fetch(event.request);
    } catch (e) {
      const cached = await caches.match(event.request);
      return cached || Response.error();
    }
  })());
});
