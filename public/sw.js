// Karmify's service worker (registered by components/shared/PwaSetup.tsx in production).
//
// It never stores pages or data: those are private to the signed-in shop and
// change all the time, so they always come from the server. It keeps only:
//   - Next's versioned files (/_next/static: scripts, styles, fonts), which
//     never change once built, so the app starts quickly on a slow connection;
//   - the app icons and the offline page, shown when a page can't be reached.
// Bump VERSION to drop everything stored by an older worker. Do so whenever
// offline.html or the icons change, or phones keep showing the old copies.

const VERSION = "karmify-v1";
const CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];
// Old builds' files pile up across deploys; keep only the most recent ones.
const MAX_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    // Starts each page request while the worker wakes up, so pages aren't slowed down by it.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ENTRIES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // Saves (Server Actions) always go straight to the server.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always from the server; the offline page only when there's no connection.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  // Versioned build files and icons: from the cache once fetched.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
        trim(cache);
      }
      return response;
    })());
  }
  // Everything else (data, images, sign-in) passes through untouched.
});
