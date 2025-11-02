
// Basic service worker for offline-first shell + runtime audio caching
const CACHE_NAME = 'calmstart-shell-v3';
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './privacy.html',
  './sessions.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => {
      if (k !== CACHE_NAME && !k.startsWith('calmstart-audio')) return caches.delete(k);
    })))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Shell: cache-first
  if (SHELL_ASSETS.includes(url.pathname) || SHELL_ASSETS.includes('.'+url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(resp => resp || fetch(event.request))
    );
    return;
  }
  // Audio: cache-first
  if (url.pathname.includes('/audio/')) {
    event.respondWith((async () => {
      const cache = await caches.open('calmstart-audio-v1');
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const resp = await fetch(event.request);
      cache.put(event.request, resp.clone());
      return resp;
    })());
    return;
  }
  // Default: network-first fallback to cache
  event.respondWith((async () => {
    try {
      const resp = await fetch(event.request);
      return resp;
    } catch (e) {
      const cached = await caches.match(event.request);
      return cached || Response.error();
    }
  })());
});
