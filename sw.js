const CACHE_NAME = 'deed-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './data.json',
  './styles.css'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(err => console.warn('Precache failed:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const reqUrl = new URL(event.request.url);

  // navigation fallback -> serve index.html when offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // same-origin: cache-first with background update
  if (reqUrl.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          // Fetch from network in background and update cache (clone response!)
          fetch(event.request)
            .then(resp => {
              if (resp && resp.ok) {
                const respClone = resp.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
              }
            })
            .catch(() => {});
          // Serve from cache
          return cached;
        }
        // Not in cache, fetch from network and cache (clone response!)
        return fetch(event.request).then(resp => {
          if (resp && resp.ok) {
            const respClone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
          }
          return resp;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // cross-origin: network-first, fallback to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
