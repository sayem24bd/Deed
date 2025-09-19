const CACHE_NAME = "dalil-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/data.json",
  "/manifest.json"
   "/icons/icon-192.png", // এটি যোগ করুন
  "/icons/icon-512.png"  // এটি যোগ করুন
];

// Install event → Cache files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate event → Clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
});

// Fetch event → Offline support
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // যদি ক্যাশে পাওয়া যায়, ক্যাশড রেসপন্স ফেরত দিন
      if (cachedResponse) {
        return cachedResponse;
      }

      // যদি ক্যাশে না পাওয়া যায়, নেটওয়ার্ক থেকে আনার চেষ্টা করুন
      return fetch(event.request).then((networkResponse) => {
        // নেটওয়ার্ক থেকে সফলভাবে ডেটা আনা হলে, সেটি ক্যাশে করুন এবং ফেরত দিন
        // এখানে কিছু শর্ত যোগ করা যেতে পারে, যেমন শুধু GET রিকোয়েস্ট ক্যাশ করা
        // এবং যদি রেসপন্স OK হয় (যেমন, 200)।
        // যদি রেসপন্স স্ট্রিমিং হয় বা একটিবার ব্যবহারের যোগ্য হয়, তাহলে ক্লোন করতে হবে।
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // যদি নেটওয়ার্ক এবং ক্যাশে উভয়ই ব্যর্থ হয়
        if (event.request.destination === "document") {
          // যদি এটি একটি HTML ডকুমেন্ট হয়, তাহলে /index.html ফেরত দিন
          return caches.match("/index.html");
        }
        // অন্য প্রকারের রিকোয়েস্টের জন্য কোনো ফলব্যাক নেই, এটি নেটওয়ার্ক অফলাইন থাকলে ব্যর্থ হবে।
        // আপনি এখানে একটি অফলাইন ইমেজ বা অন্য কোনো ফলব্যাক ফাইল ফেরত দিতে পারেন।
      });
    })
  );
});
