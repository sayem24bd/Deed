// sw.js — resilient service worker (install won't fail entirely if one asset fails)
// কৌশল:
// - প্রত্যেক ASSETS আইটেম আলাদাভাবে fetch করে cache.put করা হবে
// - ব্যর্থগুলো সাইলেন্টলি লোগ করা হবে (install ফেইল হবে না)
// - data.json → network-first; navigation → network-first fallback to index.html
// - অন্যান্য assets → cache-first then network update

const CACHE_NAME = "dalil-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/fuse.min.js",
  "/data.json",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  // during install, attempt to cache assets but don't fail the install if some fail
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // try to fetch-and-cache each asset individually and gather results
    const results = await Promise.allSettled(ASSETS.map(async (asset) => {
      try {
        // use same-origin credentials for same origin requests
        const reqInit = { cache: "no-cache", credentials: "same-origin" };
        const response = await fetch(asset, reqInit);
        // If cross-origin resource is returned opaque (type === 'opaque'),
        // we allow caching it (some CDNs return opaque). But if it's a failed response, throw.
        if (!response) throw new Error("No response");
        if (!response.ok && response.type !== "opaque") {
          throw new Error("Bad response: " + response.status + " for " + asset);
        }
        // put clone into cache; ignore errors from cache.put but await it
        await cache.put(asset, response.clone());
        return { asset, ok: true };
      } catch (err) {
        // log the asset that failed but don't rethrow
        console.warn("SW install: failed to cache", asset, err && err.message ? err.message : err);
        return { asset, ok: false, error: String(err) };
      }
    }));

    // optional: inspect failures and decide whether to skipWaiting or not
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value && r.value.ok === false));
    if (failed.length) {
      console.warn("SW install: some resources failed to cache:", failed.map(f => f.status === 'fulfilled' ? f.value.asset : "(rejected)"));
      // still complete install so SW can control pages (avoids blocking activation)
    }

    // optionally activate immediately:
    // self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Remove old caches if any
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    // take control of all clients ASAP (optional)
    // await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // try-catch to avoid unhandled exceptions in SW runtime
  try {
    const url = new URL(req.url);

    // Data (data.json) → network-first strategy
    if (url.pathname.endsWith("/data.json")) {
      event.respondWith((async () => {
        try {
          const networkResponse = await fetch(req);
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResponse.clone()).catch(() => {});
            return networkResponse;
          }
        } catch (e) {
          // network failed — try cache
        }
        const cached = await caches.match(req);
        return cached || new Response(null, { status: 503, statusText: "Service Unavailable" });
      })());
      return;
    }

    // Navigation -> try network, fallback to cached index.html
    if (req.mode === "navigate") {
      event.respondWith((async () => {
        try {
          const networkResponse = await fetch(req);
          if (networkResponse && networkResponse.ok) {
            // update cached index.html for future offline
            const cache = await caches.open(CACHE_NAME);
            cache.put("/index.html", networkResponse.clone()).catch(() => {});
            return networkResponse;
          }
        } catch (e) {
          // ignore
        }
        const cachedIndex = await caches.match("/index.html");
        return cachedIndex || new Response("<h1>Offline</h1>", { headers: { "Content-Type": "text/html" }, status: 200 });
      })());
      return;
    }

    // Other assets: cache-first, then network and update cache
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const networkResponse = await fetch(req);
        // only cache successful same-origin/basic responses (but allow opaque if necessary)
        if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
          const cache = await caches.open(CACHE_NAME);
          // clone then put; ignore put errors
          cache.put(req, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch (e) {
        // If both cache and network fail, optionally return a fallback
        if (req.destination === "image") {
          return caches.match("/icons/icon-192.png");
        }
        return new Response(null, { status: 504, statusText: "Gateway Timeout" });
      }
    })());
  } catch (e) {
    // in case URL parsing throws
    // fall back to network
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
  }
});