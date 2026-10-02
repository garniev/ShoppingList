const CACHE_NAME = "shopping-list-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/script.js",
  "./pwa/manifest.json",
  "./assets/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Always try the network first so deployed changes are detected.
        // no-store also avoids reusing an outdated browser HTTP-cache entry.
        const networkRequest = new Request(event.request, {
          cache: "no-store"
        });
        const networkResponse = await fetch(networkRequest);

        if (
          networkResponse.ok &&
          new URL(event.request.url).origin === self.location.origin
        ) {
          const responseToCache = networkResponse.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request, responseToCache)
            )
          );
        }

        return networkResponse;
      } catch (error) {
        // If offline, use the requested cached resource first.
        const cachedResponse = await caches.match(event.request);

        if (cachedResponse) {
          return cachedResponse;
        }

        // Navigation requests can fall back to the cached application shell.
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }

        return Response.error();
      }
    })()
  );
});