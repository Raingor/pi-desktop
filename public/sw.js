// ─── pi-web-switch Service Worker ───────────────────────
// Strategy:
//   - HTML navigation: NETWORK-FIRST with `cache: no-store` so Cmd+R always
//     receives the current index.html instead of an HTTP/SW cached shell.
//   - API calls: NETWORK-ONLY. Configuration/auth data must never be restored
//     from a stale service-worker cache.
//   - Static assets: CACHE-FIRST. Vite fingerprints JS/CSS filenames, so a new
//     build receives a new URL and cannot collide with an older asset.
//
// v3 also purges the v1 cache-first HTML shell that can remain registered on
// the same localhost origin and cause a blank page after a normal refresh.

const CACHE_VERSION = "pi-web-switch-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const CACHE_PREFIX = "pi-web-switch-";
const SCOPE_URL = self.registration.scope;
const OFFLINE_INDEX_URL = new URL("./index.html", SCOPE_URL).href;

const PRECACHE_URLS = [
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
].map((path) => new URL(path, SCOPE_URL).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache local configuration, authentication, or usage responses.
  if (url.pathname.includes("/api/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Always revalidate the SPA shell. The cached copy is offline fallback only.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            event.waitUntil(
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(OFFLINE_INDEX_URL, copy))
            );
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(OFFLINE_INDEX_URL);
          return cached ?? new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        })
    );
    return;
  }

  // Fingerprinted build assets are safe to cache by URL.
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy))
          );
        }
        return response;
      })
    );
  }
});
